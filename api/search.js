import crypto from 'crypto';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const SYSTEM_PROMPT = `Je bent de zoekassistent van Nederlanders.fr. Je doorzoekt nederlanders.fr en infofrankrijk.com en presenteert GEVONDEN BRONNEN — je geeft zelf geen antwoord op de vraag.

WAT JE BENT:
Een slimme zoekmachine. Je vindt relevante artikelen en forumposts en vat ze bondig samen zodat de lezer kan kiezen wat te lezen.

WAT JE NIET BENT:
Geen adviseur, geen expert, geen AI-assistent. Je trekt GEEN eigen conclusies en combineert GEEN informatie uit verschillende bronnen tot een eigen standpunt.

TWEE SOORTEN BRONNEN — BELANGRIJK ONDERSCHEID:

1. Infofrankrijk.com (type: IF)
   Redactioneel geverifieerde artikelen. Presenteer deze als betrouwbare bron.
   Formulering: "Infofrankrijk beschrijft in dit artikel…", "Volgens dit IF-artikel…"
   Je mag concrete informatie uit IF-artikelen benoemen (bedragen, termijnen, regels) mits je vermeldt dat het uit het IF-artikel komt.

2. Nederlanders.fr forum en leestips (type: forum, leestip)
   Gebruikersbijdragen — ervaringen, vragen, tips van forumleden. Niet geverifieerd.
   Formulering: "Een forumlid deelt zijn ervaring met…", "In deze discussie wordt gevraagd over…"
   Presenteer NOOIT cijfers of regels uit forumposts als feit. Beschrijf alleen WAT er besproken wordt.

STRUCTUUR VAN JE ANTWOORD:

Begin met één inleidende zin:
"Over [onderwerp] vonden we de volgende artikelen en discussies:"

Daarna per gevonden bron een APART BLOK in dit formaat:

BRON|type|titel|url|auteur|datum
SAMENVATTING: [2-3 zinnen]

Regels per blok:
- type = IF, leestip, of forum
- IF-samenvattingen mogen inhoudelijk specifieker zijn ("In dit artikel worden de actuele tarieven en vrijstellingstermijnen voor plus-value toegelicht")
- Forum/leestip-samenvattingen beschrijven de DISCUSSIE, niet de feiten ("Een lid vraagt advies over…", "Verschillende leden delen hun ervaring met…")
- Noem jaartallen en data die IN de bron staan
- Maximaal 3 zinnen per samenvatting

Sorteer: IF-artikelen eerst, dan leestips, dan forumposts. Binnen elke groep: nieuwste eerst.

Sluit af met exact deze twee regels:
"Forumbijdragen zijn persoonlijke ervaringen en niet door de redactie geverifieerd."
"Voor een persoonlijk, geverifieerd antwoord op je vraag kun je terecht bij Café Claude."

FILTERS — STRENG:
- NEGEER alle URLs met "/m/" (mobiele duplicaten)
- NEGEER forumposts ouder dan 5 jaar (vóór ${new Date().getFullYear() - 5})
- IF-artikelen mogen ouder zijn
- Als je weinig vindt, zeg dat. Verzin NOOIT bronnen, titels, auteurs of URLs

ZOEKSTRATEGIE:
Voer minstens 3 zoekopdrachten uit:
1. site:infofrankrijk.com [zoekterm]
2. site:nederlanders.fr [zoekterm] inurl:promoted
3. site:nederlanders.fr [zoekterm] -inurl:/m/

SCHEIDING THREADS:
Na je bronblokken, voeg een sectie toe met het scheidingsteken "---THREADS---" gevolgd door dezelfde bronnen in machineleesbaar formaat:
THREAD|titel|url|auteur|datum|type

BELANGRIJK:
- Gebruik ALLEEN URLs die daadwerkelijk in je zoekresultaten voorkomen
- Verzin NOOIT auteursnamen of profiellinks
- NLFR profielpagina-formaat: https://www.nederlanders.fr/profile/[gebruikersnaam]
- Geef maximaal 8 bronnen, minimaal wat je vindt
- Als je NIETS vindt, zeg: "We hebben geen artikelen of discussies gevonden over dit onderwerp in ons netwerk."`;

// Rubriek-tags (komen overeen met NLFR tag-URLs)
const RUBRIEKEN = {
  'Bouw': 'Bouw',
  'Correspondentie': 'Correspondentie',
  'Cursussen': 'Cursussen+en+Opleidingen',
  'Dieren': 'Dieren',
  'Exterieur': 'Exterieur',
  'Geldzaken': 'Geldzaken',
  'Gezondheid/Sport': 'Gezondheid%2C+Sport+en+Spel',
  'Korte verhalen': 'Korte+Verhalen',
  'Woordenlijst': 'Lexicon',
  'MKB': 'Midden-+en+Kleinbedrijf',
  'Migratie': 'Migratie',
  'Onderwijs': 'Onderwijs',
  'Ouderverzorging': 'Ouderverzorging',
  'Overheid en wet': 'Overheid',
  'Overige diensten': 'Overige+Diensten',
  'Telecommunicatie': 'Telecommunicatie',
  'Te koop': 'Te+Koop+Aangeboden',
  'Te koop gevraagd': 'Te+Koop+Gevraagd',
  'Vervoer': 'Vervoer',
  'Verenigingen': 'Verenigingen',
  'Werkaanbod': 'Werk+Aangeboden',
  'Werk algemeen': 'Werk+Algemeen',
  'Werk gevraagd': 'Werk+Gevraagd',
  'Woningbeheer': 'Woningbeheer+en+Huishouding',
  'Huizen aangeboden': 'Woningen+Aangeboden',
  'Wonen algemeen': 'Woningen+Algemeen',
  'Woningen gevraagd': 'Woningen+Gevraagd',
};

// Verifieer HMAC-token van Infofrankrijk WP-snippet
function verifyToken(token, secret) {
  if (!token || !secret) return null;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const payload = JSON.parse(decoded);
    const { email, timestamp, signature } = payload;
    if (!email || !timestamp || !signature) return null;

    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${email}:${timestamp}`)
      .digest('hex');

    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

    return { email, timestamp };
  } catch {
    return null;
  }
}

// Gedeelde Redis instantie + rate limiters
let sharedRedis = null;
let subscriberLimit = null;
let anonLimit = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  sharedRedis = Redis.fromEnv();
  subscriberLimit = new Ratelimit({
    redis: sharedRedis,
    limiter: Ratelimit.fixedWindow(15, '1 d'),
    prefix: 'nlfr-if-zoek:sub',
    analytics: false,
  });
  anonLimit = new Ratelimit({
    redis: sharedRedis,
    limiter: Ratelimit.fixedWindow(6, '1 d'),
    prefix: 'nlfr-if-zoek:anon',
    analytics: false,
  });
}

async function enrichThreads(threads) {
  const nlfrThreads = threads
    .filter(t => t.url && t.url.includes('nederlanders.fr'))
    .slice(0, 5);

  if (nlfrThreads.length === 0) return threads;

  const results = await Promise.allSettled(
    nlfrThreads.map(async (t) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        const res = await fetch(t.url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'NLFR-IF-Zoek/1.0' },
        });
        if (!res.ok) { clearTimeout(timeout); return t; }
        const html = await res.text();
        clearTimeout(timeout);

        const viewsMatch = html.match(/Weergaven:\s*([\d.]+)/);
        let views = null;
        if (viewsMatch) {
          views = parseInt(viewsMatch[1].replace(/\./g, ''), 10);
        }

        const replyMatches = html.match(/Reactie van/g);
        const replyCount = replyMatches ? replyMatches.length : 0;

        const authorMatch = html.match(/Door\s+(?:<[^>]*>)*\s*<a\s+href="https?:\/\/www\.nederlanders\.fr\/profile\/([^"]+)"[^>]*>([^<]+)<\/a>/i);
        const authorId = authorMatch ? authorMatch[1].trim() : (t.author || '');
        const authorDisplay = authorMatch ? authorMatch[2].trim() : (t.author || '');

        const dateMatch = html.match(/geplaatst op\s+(.+?)\s*(?:om\s|$|\n|<)/i);
        const date = dateMatch ? dateMatch[1].trim() : (t.date || '');

        const titleLower = (t.title || '').toLowerCase();
        const isQuestion = titleLower.includes('?') ||
          /^(hoe|wat|waar|wanneer|wie|kan|moet|mag|is het|heeft|hebben|welke|waarom)/.test(titleLower);

        return {
          ...t,
          views,
          replyCount,
          author: authorId,
          authorDisplay,
          date,
          isQuestion,
        };
      } catch (e) {
        clearTimeout(timeout);
        return {
          ...t,
          views: null,
          replyCount: null,
          authorDisplay: t.author || '',
          isQuestion: (t.title || '').includes('?'),
        };
      }
    })
  );

  const enrichedMap = new Map();
  results.forEach(r => {
    if (r.status === 'fulfilled' && r.value?.url) {
      enrichedMap.set(r.value.url, r.value);
    }
  });

  return threads.map(t =>
    enrichedMap.has(t.url)
      ? enrichedMap.get(t.url)
      : {
          ...t,
          views: null,
          replyCount: null,
          authorDisplay: t.author || '',
          isQuestion: (t.title || '').includes('?'),
        }
  );
}

function rankThreads(threads) {
  const now = new Date();
  const currentYear = now.getFullYear();
  return threads
    .map(t => {
      const yearMatch = (t.date || '').match(/(20\d{2})/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
      let recency = 0.5;
      if (year) {
        const age = currentYear - year;
        if (age === 0) recency = 1.0;
        else if (age === 1) recency = 0.85;
        else if (age === 2) recency = 0.7;
        else if (age === 3) recency = 0.55;
        else if (age === 4) recency = 0.4;
        else recency = 0.3;
      }
      const replies = t.replyCount ?? 0;
      const replyScore = replies > 0 ? Math.log2(replies + 1) : 0;
      const isIF = t.type === 'if' || (t.url && t.url.includes('infofrankrijk.com'));
      const score = isIF ? 1000 : (replyScore * recency * 10);
      return { ...t, _score: score };
    })
    .sort((a, b) => b._score - a._score)
    .map(({ _score, ...rest }) => rest);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key niet geconfigureerd' });

  const { query, token, rubriek } = req.body || {};
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ error: 'Geen zoekvraag opgegeven' });
  }
  const q = query.trim();
  const rubriekTag = rubriek && RUBRIEKEN[rubriek] ? RUBRIEKEN[rubriek] : null;

  // Token validatie
  const ssoSecret = process.env.INFOFRANKRIJK_SSO_SECRET;
  const verified = token ? verifyToken(token, ssoSecret) : null;
  const isSubscriber = !!verified;

  const cacheKey = `nlfr-if-zoek:cache:${q.toLowerCase()}${rubriekTag ? ':' + rubriekTag : ''}`;
  if (sharedRedis) {
    try {
      const cached = await sharedRedis.get(cacheKey);
      if (cached) {
        const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
        return res.status(200).json({
          ...parsed,
          cached: true,
          subscriber: isSubscriber,
        });
      }
    } catch (e) {
      console.error('Cache read error:', e);
    }
  }

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [
          {
            role: 'user',
            content: `Zoek informatie over: "${q}"${rubriekTag ? `\n\nFILTER: beperk NLFR-resultaten tot rubriek "${rubriek}" (tag=${rubriekTag}).` : ''}\n\nVoer minstens 3 zoekopdrachten uit:\n1. site:infofrankrijk.com ${q}\n2. site:nederlanders.fr ${q} inurl:promoted (door redactie uitgelichte leestips)\n3. site:nederlanders.fr ${q} -inurl:/m/${rubriekTag ? ` inurl:tag=${rubriekTag}` : ''}\n\nNegeer URLs met "/m/" (mobiele duplicaten) en forumposts ouder dan ${new Date().getFullYear() - 5}. Begin het antwoord met Infofrankrijk-context, daarna leestips/forumstemmen. In de THREADS-sectie: markeer elk item met type (IF/leestip/forum) en sorteer in die volgorde.`,
          },
        ],
      }),
    });

    if (!apiRes.ok) {
      const errBody = await apiRes.json().catch(() => ({}));
      console.error('Anthropic API error:', apiRes.status, errBody);
      return res.status(apiRes.status).json({
        error: errBody?.error?.message || `Anthropic API fout (${apiRes.status})`,
      });
    }

    const data = await apiRes.json();
    const searchCount = data.content?.filter(b => b.type === 'web_search_tool_result')?.length || 0;
    const truncated = data.stop_reason === 'max_tokens';
    const textBlocks = data.content?.filter(b => b.type === 'text') || [];
    const fullText = textBlocks.map(b => b.text).join('\n\n');

    const threadMarker = '---THREADS---';
    const markerIndex = fullText.indexOf(threadMarker);

    const preThreads = markerIndex !== -1 ? fullText.slice(0, markerIndex) : fullText;
    const postThreads = markerIndex !== -1 ? fullText.slice(markerIndex + threadMarker.length) : '';

    const normalizeType = (raw, url) => {
      let t = (raw || '').trim().toLowerCase();
      if (t !== 'if' && t !== 'leestip' && t !== 'forum') {
        if (url && url.includes('infofrankrijk.com')) t = 'if';
        else if (url && (url.includes('/profiles/blogs/') || url.includes('/profiles/blog/'))) t = 'leestip';
        else t = 'forum';
      }
      return t;
    };
    const cutoffYear = new Date().getFullYear() - 5;
    const validUrl = (url) => {
      try {
        const u = new URL(url);
        return u.hostname.includes('nederlanders.fr') || u.hostname.includes('infofrankrijk.com');
      } catch { return false; }
    };
    const validSource = (s) => {
      if (!s.titel || !s.url) return false;
      if (!validUrl(s.url)) return false;
      if (s.url.includes('/m/')) return false;
      if (s.type === 'if') return true;
      const m = s.date && s.date.match(/(20\d{2})/);
      if (!m) return true;
      return parseInt(m[1], 10) >= cutoffYear;
    };
    const rank = { 'if': 0, 'leestip': 1, 'forum': 2 };

    // BRON-blokken parsen: meer-line per bron, gescheiden door blanco regels of nieuwe BRON|
    let narrative = '';
    let sources = [];
    if (preThreads.trim()) {
      const lines = preThreads.split('\n');
      const introLines = [];
      let introDone = false;
      let current = null;
      const closingPatterns = [
        /^Forumbijdragen zijn persoonlijke ervaringen/i,
        /^Voor een persoonlijk, geverifieerd antwoord/i,
      ];
      for (const rawLine of lines) {
        const line = rawLine.replace(/\*\*/g, '').trimEnd();
        if (closingPatterns.some(p => p.test(line.trim()))) continue;
        if (line.startsWith('BRON|')) {
          if (current) sources.push(current);
          const parts = line.split('|');
          const url = (parts[3] || '').trim();
          current = {
            type: normalizeType(parts[1], url),
            titel: (parts[2] || '').trim(),
            url,
            auteur: (parts[4] || '').trim(),
            datum: (parts[5] || '').trim(),
            samenvatting: '',
          };
          introDone = true;
        } else if (current) {
          const m = line.match(/^SAMENVATTING:\s*(.*)$/i);
          if (m) {
            current.samenvatting = m[1].trim();
          } else if (line.trim()) {
            current.samenvatting = current.samenvatting
              ? current.samenvatting + ' ' + line.trim()
              : line.trim();
          }
        } else if (!introDone && line.trim()) {
          introLines.push(line.trim());
        }
      }
      if (current) sources.push(current);

      sources = sources
        .filter(validSource)
        .sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9));

      narrative = introLines.join(' ').trim();
    }

    // THREADS-sectie: bestaande logica
    let threads = [];
    if (postThreads.trim()) {
      threads = postThreads
        .split('\n')
        .filter(line => line.startsWith('THREAD|'))
        .map(line => {
          const parts = line.split('|');
          const url = parts[2] || '';
          return {
            title: parts[1] || '',
            url,
            author: parts[3] || '',
            date: parts[4] || '',
            type: normalizeType(parts[5], url),
          };
        })
        .filter(t => t.title && t.url && validUrl(t.url))
        .filter(t => !t.url.includes('/m/'))
        .filter(t => {
          if (t.type === 'if') return true;
          const m = t.date && t.date.match(/(20\d{2})/);
          if (!m) return true;
          return parseInt(m[1], 10) >= cutoffYear;
        });
      threads.sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9));
    }

    const enrichedThreads = await enrichThreads(threads);
    const rankedThreads = rankThreads(enrichedThreads);

    const responseData = {
      narrative,
      sources,
      threads: rankedThreads,
      searchCount,
      truncated,
      rubriek: rubriek || null,
    };

    if (sharedRedis) {
      try {
        await sharedRedis.set(cacheKey, JSON.stringify(responseData), { ex: 86400 });
      } catch (e) {
        console.error('Cache write error:', e);
      }
    }

    return res.status(200).json({
      ...responseData,
      cached: false,
      subscriber: isSubscriber,
    });
  } catch (err) {
    console.error('Search handler error:', err);
    return res.status(500).json({ error: 'Interne serverfout' });
  }
}
