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
 *
 * NING serveert een incomplete TLS-keten (curl error 60). We geven daarom de
 * ontbrekende keten (intermediate + root) mee aan de fetch via een https-agent
 * met ca-optie, zodat de verbinding mét normale TLS-verificatie (zonder -k)
 * slaagt.
 *
 * De keten staat hieronder INLINE (publieke certificaten), zodat hij niet
 * afhankelijk is van file-tracing bij de Vercel-deploy (het losse bestand werd
 * niet mee-gedeployed → ENOENT). Bron van waarheid blijft
 * certs/ning-ca-bundle.pem; .github/workflows/nlfr-bereik-test.yml houdt dat
 * bestand actueel. Werk bij een keten-wijziging beide bij.
 *
 * We BREIDEN de CA-set UIT (tls.rootCertificates + deze twee certs) i.p.v. te
 * vervangen: NING kan aan Node een andere keten serveren (RSA/andere root) dan
 * aan curl (ECDSA/YR2), dus we moeten beide vertrouwensankers behouden.
 */

import https from 'node:https';
import tls from 'node:tls';

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

// --------------------------- CA-bundle (inline) ---------------------------

// Intermediate + root, INLINE opgenomen zodat de deploy niet van file-tracing
// afhangt. Bron: certs/ning-ca-bundle.pem (bijgehouden door
// .github/workflows/nlfr-bereik-test.yml). Publieke certificaten, geen geheimen.
// Intermediate: C = US, O = Let's Encrypt, CN = YR2
// Root:         C = US, O = ISRG, CN = Root YR
const NING_CA = `-----BEGIN CERTIFICATE-----
MIIE2jCCAsKgAwIBAgIQTr0klH4k05SALYSlL9WzGTANBgkqhkiG9w0BAQsFADAu
MQswCQYDVQQGEwJVUzENMAsGA1UEChMESVNSRzEQMA4GA1UEAxMHUm9vdCBZUjAe
Fw0yNTA5MDMwMDAwMDBaFw0yODA5MDIyMzU5NTlaMDMxCzAJBgNVBAYTAlVTMRYw
FAYDVQQKEw1MZXQncyBFbmNyeXB0MQwwCgYDVQQDEwNZUjIwggEiMA0GCSqGSIb3
DQEBAQUAA4IBDwAwggEKAoIBAQDZ0LxwBppqh84luqMerV/eeL/fXQ7mLQQv1Lnp
WKZbyvGpx6wh6AfnslAnF6ewTkcHA+gSOoBvm3Dfm06AuGiF+KRut4fAcowqnAQQ
CW98+QPP/eOv/wug7Iyk4NkOxf2I6g2f55T6nJoOTLFcukeRq80JGQEYan+dPFr9
OGUgQK2hGKgNkW87pappsOAuUJcroYhRt5uUis4qaZireiseu32gzDJNBAiKtsvd
6HX4v25bpkRNcS/B/Gtc9kVbUpD+2PLPxdei3Tim55k4tfAEXwD2qyiPTxrTNq6l
N+AMr5g2c1dNqkOTwjxeV6L5lpP1rGiYvLnRaPlOqyZRPW+5AgMBAAGjge4wgesw
DgYDVR0PAQH/BAQDAgGGMBMGA1UdJQQMMAoGCCsGAQUFBwMBMBIGA1UdEwEB/wQI
MAYBAf8CAQAwHQYDVR0OBBYEFEAVLSZ57TIgnt+ach3WMh+BDIEMMB8GA1UdIwQY
MBaAFN7nW2DQIm1AKH0/DQH+pLVStFGUMDIGCCsGAQUFBwEBBCYwJDAiBggrBgEF
BQcwAoYWaHR0cDovL3lyLmkubGVuY3Iub3JnLzATBgNVHSAEDDAKMAgGBmeBDAEC
ATAnBgNVHR8EIDAeMBygGqAYhhZodHRwOi8veXIuYy5sZW5jci5vcmcvMA0GCSqG
SIb3DQEBCwUAA4ICAQB0ZUQWZ9/Yn9COEpo+JfecMnB0h0vwDm/M66IqXqw3LoaL
mx9lZvRTeDIS67PUeI3yCA2W6PKRD0/FE/G57lOmS+Xy5AaaL00ICGOqjNcCaMWW
8o8nevHOd4i4lqgtznE/28QwlcdJyF8yBiWHpnyjhEpmNWJURgOCOg2xpwRMBCsj
MScqYPtOhBeuYQvSwAEeTML2Ukh6uGuX4E14q65Ja8cdjF5bAldnP1eE4FBaAwsZ
G2fOqqrKV03Y85Nw2btedP1AtliQuJZs/Jo/gXxXdc7LrH3McgnpnbTiAncX7yES
hP6kzQejllqMCIt52HOjxDGWafS7Xw+DKwqmH+Eqy8dcbOuag/1AYlQoKNVK3F5q
Hh6tEDiMqQcLIibGKteE6iHo4A/bIScbzrhXUYuism42ZYzmc48FMVIH3qy4L84E
TdAH2gtxw0PAhvRVXp8HP7wfngpzsN/8xOTpeRSbM4+Qbc56G6+Bifmv6sk1ieQb
NA3wJdl4DDUuQSV8hBgx6zoI1ZSGORprDFux7c6rhc77QZMSRrEgomBeklervEve
86ylWmZ3WWHV6RLMi8xNvjd71r4EPIGgY7BZU/VPBkq+uA7Gb6mbJnFgV43uh3xy
LRFgxIAphIukwTGSMZZR+AI+Qnp0BYTWovHXozOf3H8r6hozEoT02JHn0AeTfA==
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
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
-----END CERTIFICATE-----
`;

// De twee inline certificaten los, zodat we ze bij tls.rootCertificates kunnen
// voegen (uitbreiden, niet vervangen).
const NING_CA_CERTS =
  NING_CA.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];
// Systeem-roots + onze inline certs. Zo blijft elke keten die NING mogelijk
// serveert (RSA naar een standaardroot, óf ECDSA/YR2) verifieerbaar.
const CA_SET = [...tls.rootCertificates, ...NING_CA_CERTS];
const caStatus = {
  loaded: true,
  source: 'inline',
  count: NING_CA_CERTS.length,
};

// --------------------------- fetch met timeout ---------------------------

// Node https-agent met ca-optie i.p.v. global fetch, zodat we de aangevulde
// keten kunnen meegeven. Volgt redirects; geeft dezelfde vorm terug als voorheen.
function fetchText(url, timeoutMs = 5000, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const doReq = (targetUrl, redirectsLeft) => {
      let u;
      try {
        u = new URL(targetUrl);
      } catch (e) {
        return reject(e);
      }
      const opts = {
        method: 'GET',
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        servername: u.hostname,
        headers: {
          'User-Agent': BROWSER_UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'nl,nl-NL;q=0.9,en;q=0.6',
        },
      };
      opts.ca = CA_SET; // systeem-roots + inline certs (uitbreiden, niet vervangen)

      const req = https.request(opts, (res) => {
        const status = res.statusCode || 0;
        const loc = res.headers.location;
        if (status >= 300 && status < 400 && loc && redirectsLeft > 0) {
          res.resume(); // body legen
          let next;
          try {
            next = new URL(loc, targetUrl).toString();
          } catch (e) {
            return reject(e);
          }
          return doReq(next, redirectsLeft - 1);
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { data += d; });
        res.on('end', () => resolve({
          status,
          ok: status >= 200 && status < 300,
          length: data.length,
          body: data,
          finalUrl: targetUrl,
        }));
      });
      req.setTimeout(timeoutMs, () => { req.destroy(new Error(`Timeout (>${timeoutMs}ms)`)); });
      req.on('error', reject);
      req.end();
    };
    doReq(url, maxRedirects);
  });
}

// --------------------------- keten-diagnose ---------------------------

// Best-effort: open een aparte TLS-verbinding (verificatie UIT, alleen om te
// kijken) en rapporteer de keten die de server werkelijk aanbiedt — subject +
// issuer + sleuteltype per certificaat. Zo zien we zwart-op-wit welke keten
// NING aan Vercel/Node serveert.
function probeChain(hostname, port = 443, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const fmtDN = (o) => (o ? Object.entries(o).map(([k, v]) => `${k}=${v}`).join(', ') : '');
    const keyType = (c) => {
      if (c.nistCurve || c.asn1Curve) return `EC ${c.nistCurve || c.asn1Curve}`;
      if (c.bits) return `RSA ${c.bits}`;
      return undefined;
    };
    try {
      const socket = tls.connect(
        { host: hostname, port, servername: hostname, rejectUnauthorized: false, ALPNProtocols: ['http/1.1'] },
        () => {
          try {
            const chain = [];
            const seen = new Set();
            let cert = socket.getPeerCertificate(true);
            while (cert && cert.subject && cert.fingerprint256 && !seen.has(cert.fingerprint256)) {
              seen.add(cert.fingerprint256);
              chain.push({
                subject: fmtDN(cert.subject),
                issuer: fmtDN(cert.issuer),
                keyType: keyType(cert),
                valid_to: cert.valid_to,
              });
              if (!cert.issuerCertificate || cert.issuerCertificate === cert) break;
              cert = cert.issuerCertificate;
            }
            done({
              authorizedByDefault: socket.authorized,
              authorizationError: socket.authorizationError ? String(socket.authorizationError) : null,
              certsPresented: chain.length,
              chain,
            });
          } catch (e) {
            done({ error: e && e.message ? e.message : String(e) });
          } finally {
            socket.end();
          }
        }
      );
      socket.setTimeout(timeoutMs, () => { socket.destroy(); done({ error: `Timeout (>${timeoutMs}ms)` }); });
      socket.on('error', (e) => done({ error: e && e.message ? e.message : String(e), code: e && e.code }));
    } catch (e) {
      done({ error: e && e.message ? e.message : String(e) });
    }
  });
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
      caBundle: { loaded: caStatus.loaded, source: caStatus.source, count: caStatus.count },
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
        code: e && e.code ? e.code : undefined,
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
        code: e && e.code ? e.code : undefined,
        stap: 'fetch-feed',
      };
    }

    // --- Keten-diagnose: welke keten serveert NING werkelijk aan Node? ---
    try {
      report.chainInfo = await probeChain('www.nederlanders.fr', 443, 5000);
    } catch (e) {
      report.chainInfo = { error: e && e.message ? e.message : String(e) };
    }

    return res.status(200).json(report);
  } catch (err) {
    return res.status(500).json({
      error: err && err.message ? err.message : String(err),
      stap: 'onbekend',
    });
  }
}
