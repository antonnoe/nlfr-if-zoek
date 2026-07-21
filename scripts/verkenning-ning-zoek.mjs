#!/usr/bin/env node
/**
 * VERKENNING — proof-of-concept parser voor NING's eigen forumzoek.
 *
 * Doel: gegeven een zoekterm de eerste ~20 forumresultaten van
 *   https://www.nederlanders.fr/main/search/search?q=<term>
 * ophalen en als JSON teruggeven (titel, url, snippet, datum, auteur).
 *
 * BELANGRIJK — dit is verkenning, GEEN productiecode:
 *  - Geen dependencies: puur Node (>=18) fetch + regex, zodat het overal draait
 *    met alleen `node scripts/verkenning-ning-zoek.mjs "<term>"`.
 *  - De HTML-structuur van NING kon vanuit de ontwikkel-sandbox NIET live
 *    geverifieerd worden (egress-policy blokkeert nederlanders.fr; zie
 *    scripts/VERKENNING-NING-ZOEK.md). De selectors hieronder zijn daarom
 *    HYPOTHESEN, gebaseerd op bekende NING-URL-patronen en op de HTML-markers
 *    waar api/search.js (enrichTopThreads) nu al op leunt ("Reactie van",
 *    "Weergaven:", /profile/<naam>). Draai dit script vanaf een omgeving/IP
 *    dat NING toelaat (bv. lokaal, of een Vercel-functie) om ze te ijken.
 *  - Het script parseert defensief met meerdere strategieën en meldt EXPLICIET
 *    wanneer het 0 resultaten vindt, zodat een verkeerde selector nooit stilletjes
 *    "slaagt" met verzonnen data.
 *
 * Gebruik:
 *   node scripts/verkenning-ning-zoek.mjs "septic tank"
 *   node scripts/verkenning-ning-zoek.mjs "carte vitale" --page=2 --max=20
 *   node scripts/verkenning-ning-zoek.mjs "septic tank" --debug   (dumpt ruwe HTML-lengte + sample)
 */

const BASE = 'https://www.nederlanders.fr';
const SEARCH = BASE + '/main/search/search';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// --------------------------- fetch ---------------------------

async function fetchSearchHtml(term, page = 1) {
  const params = new URLSearchParams({ q: term });
  // NING-paginering is niet bevestigd; we proberen ?page=N (meest voorkomende
  // Ning-conventie). Pas dit aan zodra de live-HTML de echte parameter toont.
  if (page && page > 1) params.set('page', String(page));
  const url = `${SEARCH}?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': BROWSER_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'nl,nl-NL;q=0.9,en;q=0.6',
    },
    redirect: 'follow',
  });
  const html = await res.text();
  return { url, status: res.status, ok: res.ok, html };
}

// --------------------------- helpers ---------------------------

const stripTags = (s) =>
  (s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

const absolutize = (href) => {
  if (!href) return '';
  if (href.startsWith('http')) return href;
  if (href.startsWith('//')) return 'https:' + href;
  if (href.startsWith('/')) return BASE + href;
  return BASE + '/' + href;
};

// NING content-URL-patronen (individuele bijdragen), afgeleid uit het menu-bestand
// en App.jsx. Een resultaat-anchor dat hier op matcht behandelen we als forumtreffer.
const CONTENT_URL_RE =
  /\/(profiles\/blogs?\/|forum\/topics\/|profiles\/blog\/show|photo\/|video\/|group\/|page\/)/i;

// Datum: NING toont Nederlandse datums; we normaliseren tot een herkenbaar jaar
// (20xx) zodat het bestaande 5-jaar-tijdfilter in api/search.js kan blijven werken.
function extractDate(block) {
  const text = stripTags(block);
  // "12 maart 2023", "3 jan. 2024", "2022"
  const nlDate = text.match(
    /\b(\d{1,2}\s+(?:jan|feb|maart|mrt|apr|mei|jun|jul|aug|sep|okt|nov|dec)[a-z.]*\s+20\d{2})\b/i
  );
  if (nlDate) return nlDate[1];
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const year = text.match(/\b(20\d{2})\b/);
  return year ? year[1] : '';
}

// Auteur: NING linkt auteurs via /profile/<screennaam> of /main/authorization/...
// en toont soms "door <naam>" of "Reactie van <naam>".
function extractAuthor(block) {
  const prof = block.match(/href="[^"]*\/(?:profile|profiles\/[^"/]+)\/([^"/?#]+)"[^>]*>([^<]+)</i);
  if (prof && stripTags(prof[2])) return stripTags(prof[2]);
  const txt = stripTags(block);
  const door = txt.match(/\b(?:door|van|Reactie van)\s+([A-Z][\w'’-]+(?:\s+[A-Z][\w'’-]+)?)/);
  if (door) return door[1].trim();
  return '';
}

// --------------------------- parsers ---------------------------

// Strategie A — JSON-LD (als NING gestructureerde data meelevert, is dat het robuustst).
function parseJsonLd(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const data = JSON.parse(m[1].trim());
      const items = Array.isArray(data) ? data : (data['@graph'] || [data]);
      for (const it of items) {
        const list = it.itemListElement || (it['@type'] === 'ItemList' ? it.itemListElement : null);
        const arr = list || (it.url || it.headline ? [it] : []);
        for (const node of arr) {
          const n = node.item || node;
          const url = n.url || n['@id'] || '';
          const title = n.name || n.headline || '';
          if (!url || !title) continue;
          out.push({
            titel: stripTags(String(title)),
            url: absolutize(String(url)),
            snippet: stripTags(String(n.description || n.abstract || '')),
            datum: String(n.datePublished || n.dateCreated || '').slice(0, 10),
            auteur: stripTags(String((n.author && (n.author.name || n.author)) || '')),
            _via: 'json-ld',
          });
        }
      }
    } catch { /* geen geldige JSON-LD; volgende blok */ }
  }
  return out;
}

// Strategie B — DOM-heuristiek. NING-zoekresultaten renderen als een lijst van
// blokken met een titel-anchor naar een content-URL. We splitsen de HTML op
// content-anchors en reconstrueren rond elk anchor een resultaatblok.
function parseDomHeuristic(html) {
  const out = [];
  const seen = new Set();

  // Alle anchors met href + zichtbare tekst.
  const anchorRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const anchors = [];
  let a;
  while ((a = anchorRe.exec(html))) {
    anchors.push({ href: a[1], text: stripTags(a[2]), index: a.index, raw: a[0] });
  }

  for (let i = 0; i < anchors.length; i++) {
    const an = anchors[i];
    if (!CONTENT_URL_RE.test(an.href)) continue;
    const title = an.text;
    if (!title || title.length < 4) continue; // sla lege / icon-only anchors over
    const url = absolutize(an.href);
    if (seen.has(url)) continue;
    seen.add(url);

    // Contextvenster: van dit anchor tot ~1200 tekens verder (of tot het volgende
    // content-anchor), waar snippet/datum/auteur doorgaans in staan.
    const nextIdx = (anchors[i + 1] && anchors[i + 1].index) || (an.index + 1400);
    const block = html.slice(an.index, Math.min(nextIdx, an.index + 1400));

    const snippet = stripTags(block.replace(an.raw, ' ')).slice(0, 300);

    out.push({
      titel: title,
      url,
      snippet,
      datum: extractDate(block),
      auteur: extractAuthor(block),
      _via: 'dom',
    });
  }
  return out;
}

function parseResults(html, max) {
  // Voorkeur: JSON-LD; anders DOM-heuristiek.
  let items = parseJsonLd(html);
  let via = 'json-ld';
  if (items.length === 0) {
    items = parseDomHeuristic(html);
    via = 'dom';
  }
  // Dedup op URL, forum/IF-content houden, begrenzen.
  const seen = new Set();
  const clean = [];
  for (const it of items) {
    if (!it.url || seen.has(it.url)) continue;
    seen.add(it.url);
    clean.push({
      titel: it.titel,
      url: it.url,
      snippet: it.snippet || '',
      datum: it.datum || '',
      auteur: it.auteur || '',
    });
    if (clean.length >= max) break;
  }
  return { via, items: clean };
}

// --------------------------- runner ---------------------------

function parseArgs(argv) {
  const args = { term: '', page: 1, max: 20, debug: false };
  for (const a of argv) {
    if (a.startsWith('--page=')) args.page = parseInt(a.slice(7), 10) || 1;
    else if (a.startsWith('--max=')) args.max = parseInt(a.slice(6), 10) || 20;
    else if (a === '--debug') args.debug = true;
    else if (!a.startsWith('--')) args.term = args.term ? args.term + ' ' + a : a;
  }
  return args;
}

async function run(term, page, max, debug) {
  const started = Date.now();
  let fetched;
  try {
    fetched = await fetchSearchHtml(term, page);
  } catch (err) {
    return {
      ok: false,
      term, page,
      error: `NETWERK: ${err && err.message ? err.message : String(err)}`,
      hint: 'Vanuit deze sandbox blokkeert de egress-policy nederlanders.fr (403 CONNECT). ' +
            'Draai dit script vanaf een omgeving/IP dat NING toelaat.',
      results: [],
    };
  }

  if (debug) {
    console.error(`[debug] ${fetched.url}`);
    console.error(`[debug] status=${fetched.status} htmlLength=${fetched.html.length}`);
    console.error(`[debug] sample: ${fetched.html.slice(0, 400).replace(/\s+/g, ' ')}`);
  }

  if (!fetched.ok) {
    return {
      ok: false,
      term, page, url: fetched.url, status: fetched.status,
      error: `HTTP ${fetched.status} — geen bruikbare respons (NING blokkeert bots vaak met 403).`,
      results: [],
    };
  }

  const { via, items } = parseResults(fetched.html, max);
  return {
    ok: items.length > 0,
    term, page, url: fetched.url, status: fetched.status,
    parser: via,
    count: items.length,
    tookMs: Date.now() - started,
    note: items.length === 0
      ? 'ZERO_RESULTS — respons opgehaald maar geen resultaten herkend. Waarschijnlijk ' +
        'moeten de selectors op de echte live-HTML geijkt worden (zie .md).'
      : undefined,
    results: items,
  };
}

async function main() {
  const { term, page, max, debug } = parseArgs(process.argv.slice(2));
  if (!term) {
    console.error('Gebruik: node scripts/verkenning-ning-zoek.mjs "<zoekterm>" [--page=N] [--max=20] [--debug]');
    process.exit(2);
  }
  const result = await run(term, page, max, debug);
  console.log(JSON.stringify(result, null, 2));
  // Exit-code 0 ook bij ZERO_RESULTS: het is verkenning, geen CI-gate.
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
