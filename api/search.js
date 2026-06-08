import crypto from 'crypto';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const SYSTEM_PROMPT = `Je bent de zoekassistent van Nederlanders.fr. Je krijgt zoekresultaten van nederlanders.fr en infofrankrijk.com aangeleverd en presenteert de GEVONDEN BRONNEN — je geeft zelf geen antwoord op de vraag, en je zoekt niet zelf.

WAT JE BENT:
Een slimme zoekmachine. Je krijgt een lijst zoekresultaten (titel, snippet, URL) en vat de relevante artikelen en forumposts bondig samen zodat de lezer kan kiezen wat te lezen.

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
- Als je weinig relevants vindt, zeg dat. Verzin NOOIT bronnen, titels, auteurs of URLs — gebruik UITSLUITEND de aangeleverde zoekresultaten

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

// Normaliseer een zoekstring tot een deterministische cache-sleutel.
// "carte vitale aanvragen" en "aanvragen carte vitale" → dezelfde sleutel.
const STOPWORDS = new Set([
  'de', 'het', 'een', 'en', 'van', 'voor', 'op', 'in', 'met', 'aan', 'bij',
  'hoe', 'wat', 'waar', 'wanneer', 'wie', 'is', 'als', 'naar', 'te', 'om',
  'mijn', 'je', 'ik', 'of', 'die', 'dat', 'er', 'over', 'uit', 'tot',
]);
function normalizeQuery(q) {
  return (q || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // accenten strippen
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')                 // leestekens → spatie
    .split(/\s+/)
    .filter(w => w && !STOPWORDS.has(w))
    .sort()
    .join(' ')
    .trim();
}

// Directe Serper-zoek (Google SERP API) — vervangt de agentic web_search-loop.
// Twee parallelle calls (IF + NLFR) zodat beide bronnen gegarandeerd vertegenwoordigd
// zijn ("twee bronnen"); een enkele OR-query scheeft vaak naar één domein.
async function serperSearch(q, rubriekTag) {
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error('SERPER_API_KEY niet geconfigureerd');

  const rubriekTerm = rubriekTag ? ' ' + rubriekTag.replace(/\+/g, ' ') : '';
  const queries = [
    `${q}${rubriekTerm} site:infofrankrijk.com`,
    `${q}${rubriekTerm} site:nederlanders.fr -inurl:/m/`,
  ];

  const settled = await Promise.allSettled(
    queries.map(async (query) => {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num: 10, gl: 'fr', hl: 'nl' }),
      });
      if (!res.ok) return [];
      const data = await res.json().catch(() => ({}));
      return Array.isArray(data.organic) ? data.organic : [];
    })
  );

  const hits = [];
  const seen = new Set();
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    for (const o of r.value) {
      const link = o.link || '';
      if (!link || seen.has(link)) continue;
      if (link.includes('/m/')) continue; // mobiele duplicaten
      seen.add(link);
      hits.push({
        title: (o.title || '').trim(),
        link,
        snippet: (o.snippet || '').trim(),
        date: (o.date || '').trim(),
      });
    }
  }
  return hits;
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
      // Zonder live reactie-data (Serper levert die niet) valt het terug op recency,
      // zodat forumposts toch op datum gesorteerd worden i.p.v. allemaal score 0.
      const base = replies > 0 ? replyScore * recency * 10 : recency;
      const score = isIF ? 1000 : base;
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

  // Genormaliseerde cache-sleutel (v2): varianten van dezelfde vraag delen één entry.
  const cacheKey = `nlfr-if-zoek:cache:v2:${normalizeQuery(q)}${rubriekTag ? ':' + rubriekTag : ''}`;
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

  // Rate-limiter: pas ná een cache-miss, vóór de (dure) Serper/Haiku-call.
  // Cache-hits zijn gratis en tellen niet mee tegen de daglimiet.
  if (sharedRedis) {
    try {
      const ip = (req.headers['x-forwarded-for'] || '')
        .split(',')[0].trim() || req.socket?.remoteAddress || 'onbekend';
      const limiter = isSubscriber ? subscriberLimit : anonLimit;
      const identifier = isSubscriber ? verified.email : ip;
      const { success } = await limiter.limit(identifier);
      if (!success) {
        return res.status(429).json({
          subscriber: isSubscriber,
          message: isSubscriber
            ? 'Je dagelijkse limiet van 15 zoekopdrachten is bereikt. Voor meer kun je terecht bij Café Claude.'
            : 'Je 6 gratis zoekopdrachten voor vandaag zijn op. Word abonnee voor 15 per dag, of stel je vraag aan Café Claude.',
        });
      }
    } catch (e) {
      console.error('Rate limit error:', e); // bij fout: niet blokkeren
    }
  }

  try {
    // 1) Bronnen ophalen via Serper (directe SERP-call, geen agentic loop)
    const hits = await serperSearch(q, rubriekTag);
    const searchCount = 2; // twee bronzoekopdrachten (IF + NLFR)

    let fullText = '';
    let truncated = false;

    // 2) Alleen samenvatten als er treffers zijn — anders geen (dure) Haiku-call
    if (hits.length > 0) {
      const hitsText = hits
        .map((h, i) => `[${i + 1}] ${h.title}\nURL: ${h.link}${h.date ? `\nDatum: ${h.date}` : ''}\nSnippet: ${h.snippet}`)
        .join('\n\n');

      const userMessage = `Hieronder de zoekresultaten voor: "${q}"${rubriekTag ? `\n(rubriekfilter: "${rubriek}")` : ''}.\n\nPresenteer de relevante bronnen volgens je instructies: eerst de BRON-blokken (IF eerst, dan leestips, dan forum), daarna de "---THREADS---"-sectie. Gebruik UITSLUITEND de onderstaande URLs — verzin niets.\n\n${hitsText}`;

      const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2000,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
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
      truncated = data.stop_reason === 'max_tokens';
      const textBlocks = data.content?.filter(b => b.type === 'text') || [];
      fullText = textBlocks.map(b => b.text).join('\n\n');
    }

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

    // Geen live HTML-scrape meer (enrichThreads is vervallen): Serper levert titel,
    // URL en datum, en dat is wat de UI nodig heeft. rankThreads valt terug op recency.
    const rankedThreads = rankThreads(threads);

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
        await sharedRedis.set(cacheKey, JSON.stringify(responseData), { ex: 604800 }); // 7 dagen
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
