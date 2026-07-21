/**
 * TIJDELIJK verkennings-endpoint — verwijderen na route B-besluit.
 *
 * Bewijst of productie-Vercel NING's eigen zoekfunctie server-side kan uitlezen
 * (de ontwikkel-sandbox kon dat niet; productie bereikt nederlanders.fr al via
 * enrichTopThreads in api/search.js). Leest GEEN geheimen, wijzigt niets, en
 * raakt api/search.js noch src/ aan.
 *
 * GET /api/test-ning-zoek?q=<term>&page=<n>
 *
 * De parser hieronder is een compacte port van scripts/verkenning-ning-zoek.mjs,
 * inline gehouden zodat deze functie zelfstandig werkt (geen CLI-side-effects,
 * geen cross-map-bundling).
 */

const BASE = 'https://www.nederlanders.fr';
const SEARCH = BASE + '/main/search/search';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// NING content-URL-patronen (individuele bijdragen).
const CONTENT_URL_RE =
  /\/(profiles\/blogs?\/|forum\/topics\/|profiles\/blog\/show|photo\/|video\/|group\/|page\/)/i;

// Herkenbare resultaatmarkers op de NING-zoekview (contentpatronen + NL UI-strings).
const RESULT_MARKERS = ['/profiles/blogs/', '/profiles/blog/', 'Blogbericht', 'toegevoegd door'];

// --------------------------- parse-helpers (port) ---------------------------

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

function extractDate(block) {
  const text = stripTags(block);
  const nlDate = text.match(
    /\b(\d{1,2}\s+(?:jan|feb|maart|mrt|apr|mei|jun|jul|aug|sep|okt|nov|dec)[a-z.]*\s+20\d{2})\b/i
  );
  if (nlDate) return nlDate[1];
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const year = text.match(/\b(20\d{2})\b/);
  return year ? year[1] : '';
}

function extractAuthor(block) {
  const prof = block.match(/href="[^"]*\/(?:profile|profiles\/[^"/]+)\/([^"/?#]+)"[^>]*>([^<]+)</i);
  if (prof && stripTags(prof[2])) return stripTags(prof[2]);
  const txt = stripTags(block);
  const door = txt.match(/\b(?:toegevoegd door|door|van|Reactie van)\s+([A-Z][\w'’-]+(?:\s+[A-Z][\w'’-]+)?)/);
  if (door) return door[1].trim();
  return '';
}

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
          });
        }
      }
    } catch { /* geen geldige JSON-LD */ }
  }
  return out;
}

function parseDomHeuristic(html) {
  const out = [];
  const seen = new Set();
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
    if (!title || title.length < 4) continue;
    const url = absolutize(an.href);
    if (seen.has(url)) continue;
    seen.add(url);
    const nextIdx = (anchors[i + 1] && anchors[i + 1].index) || (an.index + 1400);
    const block = html.slice(an.index, Math.min(nextIdx, an.index + 1400));
    const snippet = stripTags(block.replace(an.raw, ' ')).slice(0, 300);
    out.push({ titel: title, url, snippet, datum: extractDate(block), auteur: extractAuthor(block) });
  }
  return out;
}

function parseResults(html, max = 10) {
  let items = parseJsonLd(html);
  let via = 'json-ld';
  if (items.length === 0) {
    items = parseDomHeuristic(html);
    via = 'dom';
  }
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

// --------------------------- fetch met timeout ---------------------------

async function fetchText(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'nl,nl-NL;q=0.9,en;q=0.6',
      },
    });
    const body = await res.text();
    return { status: res.status, ok: res.ok, length: body.length, body, finalUrl: res.url || url };
  } finally {
    clearTimeout(timer);
  }
}

// --------------------------- handler ---------------------------

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    if (req.method && req.method !== 'GET') {
      return res.status(405).json({ error: 'Alleen GET toegestaan', stap: 'method' });
    }

    // Query-parameters (werkt met Vercel's req.query en met een kale URL).
    let q = '';
    let page = '';
    if (req.query && typeof req.query === 'object') {
      q = (req.query.q || '').toString();
      page = (req.query.page || '').toString();
    } else {
      const u = new URL(req.url, 'http://localhost');
      q = u.searchParams.get('q') || '';
      page = u.searchParams.get('page') || '';
    }
    q = q.trim();
    if (!q) {
      return res.status(400).json({ error: 'Parameter q is verplicht', stap: 'validatie' });
    }
    const pageNum = page ? parseInt(page, 10) : null;

    const report = {
      note: 'TIJDELIJK verkennings-endpoint — verwijderen na route B-besluit.',
      query: q,
      page: pageNum || 1,
    };

    // --- Stap 1: HTML-zoekpagina ophalen ---
    const params = new URLSearchParams({ q });
    if (pageNum && pageNum > 1) params.set('page', String(pageNum));
    const searchUrl = `${SEARCH}?${params.toString()}`;
    report.searchUrl = searchUrl;

    try {
      const r = await fetchText(searchUrl, 5000);
      report.search = {
        status: r.status,
        ok: r.ok,
        length: r.length,
        finalUrl: r.finalUrl,
      };

      if (r.ok && r.body) {
        // Welke markers zitten in de HTML?
        const markersFound = {};
        for (const mk of RESULT_MARKERS) markersFound[mk] = r.body.includes(mk);
        report.search.markers = markersFound;
        report.search.hasRecognizableResult = Object.values(markersFound).some(Boolean);

        // Fragment (max 3000 tekens) rond het eerste herkenbare resultaat.
        let firstIdx = -1;
        for (const mk of RESULT_MARKERS) {
          const idx = r.body.indexOf(mk);
          if (idx !== -1 && (firstIdx === -1 || idx < firstIdx)) firstIdx = idx;
        }
        if (firstIdx !== -1) {
          const start = Math.max(0, firstIdx - 500);
          report.search.fragment = r.body.slice(start, start + 3000);
        } else {
          report.search.fragment = null;
        }

        // Parser toepassen (bruikbaar?).
        try {
          const parsed = parseResults(r.body, 10);
          report.search.parser = parsed.via;
          report.search.parsedCount = parsed.items.length;
          report.search.parsed = parsed.items;
          report.search.parserUsable = parsed.items.length > 0;
        } catch (e) {
          report.search.parserError = e && e.message ? e.message : String(e);
          report.search.parserUsable = false;
        }
      } else {
        report.search.hint =
          'Non-200 of lege body — NING blokkeert datacenter-IP\'s/bots mogelijk met 403/CAPTCHA.';
      }
    } catch (e) {
      const aborted = e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));
      report.search = {
        error: aborted ? 'Timeout (>5s)' : (e && e.message ? e.message : String(e)),
        stap: 'fetch-search',
      };
    }

    // --- Stap 2: één RSS/feed-variant proberen ---
    const feedUrl = `${SEARCH}?${new URLSearchParams({ q }).toString()}&format=rss`;
    report.feedUrl = feedUrl;
    try {
      const rf = await fetchText(feedUrl, 5000);
      const head = (rf.body || '').slice(0, 500);
      report.feed = {
        status: rf.status,
        ok: rf.ok,
        length: rf.length,
        looksLikeFeed: /<rss|<feed|<\?xml/i.test(head),
        first500: head,
      };
    } catch (e) {
      const aborted = e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));
      report.feed = {
        error: aborted ? 'Timeout (>5s)' : (e && e.message ? e.message : String(e)),
        stap: 'fetch-feed',
      };
    }

    return res.status(200).json(report);
  } catch (err) {
    return res.status(500).json({
      error: err && err.message ? err.message : String(err),
      stap: 'onbekend',
    });
  }
}
