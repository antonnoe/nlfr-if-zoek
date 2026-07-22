/**
 * NING-forumzoek als extra bronleverancier voor /api/search.
 *
 * Haalt de zoekpagina van nederlanders.fr op via de gedeelde ningFetch (agent
 * met aangevulde CA-keten) en parseert de echte resultaatblokken. Gekalibreerd
 * op echte HTML (zie scripts/samples/*.html).
 *
 * Structuur van een treffer (bron van waarheid: scripts/samples):
 *   <dl class="result">
 *     <dt>Blogbericht: <a href="/xn/detail/…:BlogPost:…">Titel</a></dt>   (post)
 *     <dt>Opmerking over: <a href="/xn/detail/…:Comment:…">Titel</a></dt> (reactie)
 *     <dd><p>…snippet…</p></dd>            (of <em> bij een reactie)
 *     <dd><small>Op 6 Januari 2018 om 0.51 toegevoegd door
 *                <a href="/profile/Roel277">Roel</a></small></dd>
 *   </dl>
 * Alleen blokken met dit dt-patroon zijn echte treffers; navigatie- en
 * paginalinks vallen daar buiten en worden dus niet meegenomen.
 *
 * Bestandsnaam begint met "_" zodat Vercel dit niet als route deployt.
 */

import { ningFetch } from './_ning-agent.js';

const BASE = 'https://www.nederlanders.fr';
const SEARCH = BASE + '/main/search/search';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function stripTags(s) {
  return (s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&hellip;/g, '…')
    .replace(/&eacute;/g, 'é').replace(/&egrave;/g, 'è').replace(/&agrave;/g, 'à')
    .replace(/&ccedil;/g, 'ç').replace(/&euml;/g, 'ë').replace(/&iuml;/g, 'ï')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ''; } })
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function absolutize(href) {
  if (!href) return '';
  if (href.startsWith('http')) return href;
  if (href.startsWith('//')) return 'https:' + href;
  if (href.startsWith('/')) return BASE + href;
  return BASE + '/' + href;
}

/**
 * Parse de zoekpagina-HTML naar treffers. Puur op de result-blokken; alles
 * zonder het "Blogbericht:"/"Opmerking over:"-dt-patroon wordt genegeerd.
 * Geëxporteerd zodat tests er direct op kunnen draaien (scripts/samples).
 */
export function parseNingSearch(html, max = 20) {
  const results = [];
  const seen = new Set();
  const blocks = html.match(/<dl\s+class="result">[\s\S]*?<\/dl>/gi) || [];

  for (const block of blocks) {
    // dt: soort (post/reactie) + url + titel. Zonder deze match is het geen treffer.
    const dt = block.match(
      /<dt>\s*(Blogbericht|Opmerking over)\s*:\s*<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i
    );
    if (!dt) continue;

    const kind = /Blogbericht/i.test(dt[1]) ? 'post' : 'comment';
    const url = absolutize(dt[2]);
    const titel = stripTags(dt[3]);
    if (!titel || !url || seen.has(url)) continue;

    // datum (met jaartal) + auteur (+ screennaam) uit de <small>-metaregel. We
    // ankeren op <small> zodat een lowercase "op" in het snippet niet meetelt.
    let datum = '';
    let auteur = '';
    let auteurId = '';
    const meta = block.match(
      /<small[^>]*>\s*Op\s+([^<]*?)\s+om\s+[\d.:]+\s+toegevoegd door\s*<a[^>]*href="\/profile\/([^"?#]+)[^"]*"[^>]*>([^<]+)<\/a>/i
    );
    if (meta) {
      datum = meta[1].replace(/\s+/g, ' ').trim();
      auteurId = meta[2].trim();
      auteur = stripTags(meta[3]);
    }

    // snippet = eerste <dd> die niet de metaregel ("toegevoegd door") is.
    let snippet = '';
    const dds = block.match(/<dd>([\s\S]*?)<\/dd>/gi) || [];
    for (const dd of dds) {
      if (/toegevoegd door/i.test(dd)) continue;
      const txt = stripTags(dd);
      if (txt) { snippet = txt; break; }
    }

    seen.add(url);
    results.push({ titel, url, snippet, datum, auteur, auteurId, kind });
    if (results.length >= max) break;
  }
  return results;
}

/**
 * ningSearch(q): haalt maximaal ~20 forumtreffers op. Faalt NOOIT hard —
 * bij elke fout/timeout een lege array, zodat de bestaande flow nooit blokkeert.
 * Geeft terug: { titel, url, snippet, datum (met jaartal), auteur, auteurId
 * (screennaam, voor goudlijst-match), kind: 'post'|'comment' }.
 */
export async function ningSearch(q, { timeoutMs = 3000, max = 20 } = {}) {
  const term = (q || '').trim();
  if (!term) return [];
  const url = `${SEARCH}?q=${encodeURIComponent(term)}`;
  try {
    const r = await ningFetch(url, {
      timeoutMs,
      headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'nl,nl-NL;q=0.9,en;q=0.6' },
    });
    if (!r.ok || !r.body) return [];
    return parseNingSearch(r.body, max);
  } catch {
    return [];
  }
}
