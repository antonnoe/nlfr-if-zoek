import crypto from 'crypto';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const SYSTEM_PROMPT = `Je bent de zoekassistent van Nederlanders.fr. Je krijgt zoekresultaten (titel, snippet, URL) van twee bronnen aangeleverd en presenteert de relevante daarvan. Je zoekt niet zelf en je beantwoordt de vraag niet — je selecteert en vat de gevonden bronnen samen.

TWEE BRONNEN — STRIKT ONDERSCHEIDEN:
1. Infofrankrijk.com (type: if)
   Redactionele dossiers, artikelen en tools. Betrouwbaar. Noem dit NOOIT een "discussie".
   Formulering: "Infofrankrijk beschrijft in dit artikel…", "Volgens dit IF-dossier…". De samenvatting mag concrete informatie bevatten (bedragen, termijnen, regels) mits je vermeldt dat het uit de IF-bron komt.
2. Nederlanders.fr (type: forum)
   Forumbijdragen en discussies van leden. Niet geverifieerd.
   Formulering: "Een forumlid deelt zijn ervaring met…", "In deze bijdrage wordt gevraagd over…". Presenteer NOOIT cijfers of regels uit forumbijdragen als feit; beschrijf WAT er besproken wordt.

UITVOERFORMAAT — HEEL STRIKT:
Geef per relevante bron EXACT één blok in dit formaat, twee regels per blok:

BRON|type|titel|url|auteur|datum
SAMENVATTING: [2-3 zinnen]

Regels voor het formaat:
- Begin de BRON-regel letterlijk met "BRON|" (geen streepjes, sterretjes of opsommingstekens ervoor).
- Velden gescheiden door een verticale streep |, in deze volgorde: type|titel|url|auteur|datum.
- type = "if" voor infofrankrijk.com-URLs, "forum" voor nederlanders.fr-URLs.
- De SAMENVATTING staat op een NIEUWE regel die begint met "SAMENVATTING:".
- Scheid bronblokken met één lege regel. Voeg GEEN andere kopjes, inleiding, afsluiting of "---"-scheidingstekens toe.

INHOUDELIJKE REGELS:
- Gebruik UITSLUITEND de aangeleverde zoekresultaten. Verzin NOOIT bronnen, titels, URLs, auteurs of datums.
- url: alleen een URL die letterlijk in de resultaten voorkomt.
- auteur: alleen invullen als die duidelijk uit het resultaat blijkt; anders LAAT HET VELD LEEG (niets tussen de strepen). Verzin nooit een auteur en gebruik nooit een streepje of "onbekend" als opvulling.
- datum: alleen invullen als die uit het resultaat blijkt; anders LEEG laten.
- Sorteer: IF-bronnen eerst, daarna forumbijdragen.
- Maximaal 8 bronnen. Geef alleen wat echt relevant is — als er niets relevants is, geef helemaal niets terug (geen tekst).`;

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
  // NLFR (NING) wordt dun geïndexeerd; vraag daar meer resultaten op (num 20).
  // Serper rekent per query, niet per resultaat — dit is vrijwel gratis.
  const queries = [
    { q: `${q}${rubriekTerm} site:infofrankrijk.com`, num: 10 },
    { q: `${q}${rubriekTerm} site:nederlanders.fr -inurl:/m/`, num: 20 },
  ];

  const settled = await Promise.allSettled(
    queries.map(async ({ q: query, num }) => {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num, gl: 'fr', hl: 'nl' }),
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

// Type bepalen: IF voor infofrankrijk.com, anders forum (NLFR). Geen "leestip" meer —
// promoted/leestips zijn niet betrouwbaar te onderscheiden, en NLFR = forumbijdragen.
function normalizeType(raw, url) {
  const t = (raw || '').trim().toLowerCase();
  if (url && url.includes('infofrankrijk.com')) return 'if';
  if (url && url.includes('nederlanders.fr')) return 'forum';
  if (t === 'if' || t === 'forum') return t;
  return 'forum';
}

// Lege/placeholder-velden teruggeven als lege string — nooit "—" of "onbekend" tonen.
function cleanField(v) {
  const s = (v || '').trim();
  if (!s || /^[-–—]+$/.test(s) || /^(onbekend|n\/?a|geen|unknown|null)$/i.test(s)) return '';
  return s;
}

// Tolerante parser voor de BRON-blokken die Haiku produceert. Verdraagt streepjes,
// sterretjes en spaties rond de | -tekens. Onbekende regels worden GENEGEERD (nooit
// als ruwe tekst doorgegeven), zodat losse markup nooit op het scherm belandt.
function parseSources(text) {
  if (!text) return [];
  const sources = [];
  let cur = null;
  const inlineSamenv = /SAMENVATTING\s*:/i;
  for (const raw of text.split('\n')) {
    let line = raw.replace(/\*\*/g, '').replace(/^[\s>•*\-–—]+/, '').replace(/[\s\-–—]+$/, '').trim();
    if (!line) continue;

    const bronMatch = /^BRON\s*\|(.*)$/i.exec(line);
    if (bronMatch) {
      if (cur) sources.push(cur);
      const parts = bronMatch[1].split('|').map(s => s.trim());
      const url = parts[2] || '';
      let datum = parts[4] || '';
      let inlineSummary = '';
      if (inlineSamenv.test(datum)) {
        const split = datum.split(inlineSamenv);
        datum = split[0].trim();
        inlineSummary = (split[1] || '').trim();
      }
      cur = {
        type: normalizeType(parts[0], url),
        titel: parts[1] || '',
        url,
        auteur: cleanField(parts[3]),
        datum: cleanField(datum),
        samenvatting: inlineSummary,
      };
      continue;
    }

    const sm = inlineSamenv.exec(line);
    if (sm && line.slice(0, sm.index).trim() === '') {
      if (cur) cur.samenvatting = line.slice(sm.index + sm[0].length).trim();
      continue;
    }

    // Vervolgregel van een samenvatting; losse tekst zonder bron wordt genegeerd.
    if (cur) {
      cur.samenvatting = cur.samenvatting ? `${cur.samenvatting} ${line}` : line;
    }
  }
  if (cur) sources.push(cur);
  return sources;
}

// Lichte verrijking: haal alleen voor de top-N (recency) NLFR-bijdragen het
// reactieaantal (en weergaven) van de NING-pagina. Niet alle treffers — alleen de
// top, om latentie laag te houden. Bij geen data: veld blijft leeg/undefined.
async function enrichTopThreads(threads, topN = 3) {
  const candidates = rankThreads(threads)
    .filter(t => t.url && t.url.includes('nederlanders.fr'))
    .slice(0, topN);
  if (candidates.length === 0) return threads;

  const enriched = new Map();
  await Promise.allSettled(
    candidates.map(async (t) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      try {
        const res = await fetch(t.url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'NLFR-IF-Zoek/1.0' },
        });
        clearTimeout(timer);
        if (!res.ok) return;
        const html = await res.text();

        let replyCount = (html.match(/Reactie van/g) || []).length;
        if (!replyCount) {
          const m = html.match(/(\d+)\s*Reacties?/i);
          if (m) replyCount = parseInt(m[1], 10);
        }
        let views = null;
        const vm = html.match(/Weergaven:\s*([\d.]+)/);
        if (vm) views = parseInt(vm[1].replace(/\./g, ''), 10);

        enriched.set(t.url, { replyCount, views });
      } catch {
        clearTimeout(timer);
      }
    })
  );

  return threads.map(t => (enriched.has(t.url) ? { ...t, ...enriched.get(t.url) } : t));
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

      const userMessage = `Hieronder de zoekresultaten voor: "${q}"${rubriekTag ? `\n(rubriekfilter: "${rubriek}")` : ''}.\n\nPresenteer de relevante bronnen als BRON-blokken volgens je instructies (IF-bronnen eerst, dan forumbijdragen). Gebruik UITSLUITEND de onderstaande URLs — verzin niets, en laat auteur/datum leeg als die er niet bij staan.\n\n${hitsText}`;

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

    const cutoffYear = new Date().getFullYear() - 5;
    const validUrl = (url) => {
      try {
        const u = new URL(url);
        return u.hostname.includes('nederlanders.fr') || u.hostname.includes('infofrankrijk.com');
      } catch { return false; }
    };
    // Tijdfilter (ongewijzigd): forumbijdragen ouder dan cutoffYear vallen af;
    // items zonder herkenbaar jaartal blijven; IF mag ouder zijn.
    const passesTimeFilter = (type, dateStr) => {
      if (type === 'if') return true;
      const m = dateStr && dateStr.match(/(20\d{2})/);
      if (!m) return true;
      return parseInt(m[1], 10) >= cutoffYear;
    };
    const rank = { 'if': 0, 'forum': 1 };

    // BRON-blokken parsen met de tolerante parser; daarna valideren, tijdfilteren,
    // sorteren (IF eerst) en begrenzen op 8. Losse markup belandt nooit in de output.
    const sources = parseSources(fullText)
      .filter(s => s.titel && s.url && validUrl(s.url) && !s.url.includes('/m/'))
      .filter(s => passesTimeFilter(s.type, s.datum))
      .sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9))
      .slice(0, 8);

    // Vaste, correcte intro (terminologie-neutraal) — niet door het model bepaald.
    const narrative = sources.length > 0
      ? `Over "${q}" vonden we het volgende in het netwerk:`
      : '';

    // "Recente bijdragen"-lijst afgeleid van dezelfde gevalideerde bronnen.
    const threads = sources.map(s => ({
      title: s.titel,
      url: s.url,
      author: s.auteur,
      date: s.datum,
      type: s.type,
    }));

    // Lichte verrijking van alleen de top-N NLFR-bijdragen, dan ranken op
    // reactieaantal × recency (IF bovenaan).
    const enrichedThreads = await enrichTopThreads(threads);
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
