/**
 * Tier-weging voor forumbronnen (Serper-/IF-gedrag blijft ongewijzigd).
 *
 * Bronnen van waarheid (gekalibreerd op scripts/samples):
 *  - Goudlijst  : /profiles/friend/listFeatured — leden in
 *                 <div class="member_item_detail"><h5><a href="/profile/<id>">Naam</a>.
 *  - Promoted   : /profiles/blog/list?promoted=1 (2 pagina's) — posts als
 *                 <a href="…/profiles/blogs/<slug>" _snid="NNN:BlogPost:NNN">Titel</a>.
 *                 Het _snid is exact hetzelfde object-id dat NING's zoek als
 *                 permalink geeft (/xn/detail/NNN:BlogPost:NNN) → exacte match.
 *
 * Alle fetches zijn best-effort: bij fout een lege lijst (= geen boost), nooit
 * blokkerend. Module-niveau cache: 24u bij succes, kort (10 min) bij fout zodat
 * een transiënte storing zichzelf herstelt zonder elke request te vertragen.
 */

import { ningFetch } from './_ning-agent.js';
import {
  shortestHoudbaarheid,
  houdbaarheidRecency,
  isDatumwaarschuwing,
  isDateTag,
  DEFAULT_HOUDBAARHEID,
} from './_houdbaarheid.js';

const BASE = 'https://www.nederlanders.fr';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, 'Accept-Language': 'nl,nl-NL;q=0.9,en;q=0.6' };

const OK_TTL = 24 * 60 * 60 * 1000; // 24u
const FAIL_TTL = 10 * 60 * 1000;    // 10 min

// ---------- normalisatie ----------
export function normName(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}
export function normTitle(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function stripTags(s) {
  return (s || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
}

// NING object-id uit een permalink halen: /xn/detail/NNN:BlogPost:NNN → dat id.
export function blogObjectId(url) {
  const m = (url || '').match(/\/xn\/detail\/([^/?#]+)/);
  return m ? m[1] : null;
}

// ---------- Goudlijst ----------
let _gold = { at: 0, ok: false, data: null };

// Pure parser (geëxporteerd voor tests op scripts/samples/leden-featured.html):
// leden staan als member_item_detail > h5 > a href="/profile/<id>">Naam</a>.
export function parseGoldList(html) {
  const set = new Set();
  const re = /class="member_item_detail"[\s\S]*?<h5>\s*<a\s+href="\/profile\/([^"?#]+)[^"]*"[^>]*>([^<]+)<\/a>/gi;
  let m;
  while ((m = re.exec(html || ''))) {
    const sn = normName(m[1]);
    const disp = normName(stripTags(m[2]));
    if (sn) set.add(sn);
    if (disp) set.add(disp);
  }
  return set;
}

export async function getGoldList() {
  const now = Date.now();
  const ttl = _gold.ok ? OK_TTL : FAIL_TTL;
  if (_gold.data && now - _gold.at < ttl) return _gold.data;
  try {
    const r = await ningFetch(`${BASE}/profiles/friend/listFeatured`, { timeoutMs: 3000, headers: HEADERS });
    if (!r.ok || !r.body) throw new Error('listFeatured ' + r.status);
    const set = parseGoldList(r.body);
    _gold = { at: now, ok: set.size > 0, data: set };
    return set;
  } catch {
    _gold = { at: now, ok: false, data: new Set() };
    return _gold.data;
  }
}

// ---------- Promoted-lijst ----------
let _promoted = { at: 0, ok: false, data: null };

// Pure parser (geëxporteerd voor tests op scripts/samples/promoted-*.html):
// posts als <a href="…/profiles/blogs/<slug>" _snid="NNN:BlogPost:NNN">Titel</a>.
// Accumuleert in het meegegeven {ids,titles}-object (voor meerdere pagina's).
export function parsePromoted(html, into) {
  const acc = into || { ids: new Set(), titles: new Set() };
  const re = /<a\s+href="[^"]*?\/profiles\/blogs\/[^"]+"\s+_snid="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html || ''))) {
    acc.ids.add(m[1].trim());
    const t = normTitle(stripTags(m[2]));
    if (t) acc.titles.add(t);
  }
  return acc;
}

export async function getPromoted() {
  const now = Date.now();
  const ttl = _promoted.ok ? OK_TTL : FAIL_TTL;
  if (_promoted.data && now - _promoted.at < ttl) return _promoted.data;

  const acc = { ids: new Set(), titles: new Set() };
  const urls = [
    `${BASE}/profiles/blog/list?promoted=1`,
    `${BASE}/profiles/blog/list?promoted=1&page=2`,
  ];
  for (const url of urls) {
    try {
      const r = await ningFetch(url, { timeoutMs: 3000, headers: HEADERS });
      if (!r.ok || !r.body) continue;
      parsePromoted(r.body, acc);
    } catch { /* pagina overslaan */ }
  }
  _promoted = { at: now, ok: acc.ids.size > 0, data: acc };
  return acc;
}

// ---------- verrijking: reactieaantal + weergaven + tags per forum-URL ----------
// Zelfde markers als voorheen (Reactie van / N Reacties / Weergaven:). Volgt
// redirects (comment-permalink → draad), dus reacties/tags tellen voor de draad.
// Tags komen uit de draadpagina-links /profiles/blog/list?tag=… (datumtag genegeerd).
export async function enrichReplies(urls, cap = 8) {
  const map = new Map();
  const targets = (urls || []).filter(u => u && u.includes('nederlanders.fr')).slice(0, cap);
  await Promise.allSettled(
    targets.map(async (url) => {
      try {
        const r = await ningFetch(url, { timeoutMs: 3000, headers: { 'User-Agent': 'NLFR-IF-Zoek/1.0' } });
        if (!r.ok || !r.body) return;
        const html = r.body;
        let replyCount = (html.match(/Reactie van/g) || []).length;
        if (!replyCount) {
          const m = html.match(/(\d+)\s*Reacties?/i);
          if (m) replyCount = parseInt(m[1], 10);
        }
        let views = null;
        const vm = html.match(/Weergaven:\s*([\d.]+)/);
        if (vm) views = parseInt(vm[1].replace(/\./g, ''), 10);

        const tags = [];
        const seenTags = new Set();
        const tagRe = /\/profiles\/blog\/list\?tag=([^"'&\s>]+)/gi;
        let tm;
        while ((tm = tagRe.exec(html))) {
          let dec;
          try { dec = decodeURIComponent(tm[1].replace(/\+/g, ' ')); } catch { dec = tm[1].replace(/\+/g, ' '); }
          dec = dec.trim();
          if (!dec || isDateTag(dec) || seenTags.has(dec)) continue; // datumtag negeren
          seenTags.add(dec);
          tags.push(dec);
        }

        map.set(url, { replyCount, views, tags, finalUrl: r.finalUrl || url });
      } catch { /* stil falen */ }
    })
  );
  return map;
}

// ---------- geld-/regel-/procedure-onderwerp → harde 5-jaarsgrens ----------
const RESTRICTED_RE = new RegExp(
  '\\b(' +
  [
    'belasting', 'belastingdienst', 'belastingaangifte', 'aangifte', 'fiscaa?l', 'fiscus',
    'impot', 'impots', 'taxe', 'taxes', 'tva', 'btw', 'premie', 'verzekering', 'assurance',
    'mutuelle', 'pensioen', 'retraite', 'aow', 'uitkering', 'toeslag', 'cotisation', 'urssaf',
    'visum', 'visa', 'carte de sejour', 'sejour', 'verblijfsvergunning', 'vergunning',
    'subsidie', 'tarief', 'tarieven', 'notaris', 'notaire', 'successie', 'erfenis', 'erfrecht',
    'nalatenschap', 'schenking', 'testament', 'hypotheek', 'wet', 'wetgeving', 'regeling',
    'regelgeving', 'contract', 'boete', 'amende', 'cpam', 'ameli', 'securite sociale',
  ].join('|') +
  ')\\b',
  'i'
);
export function isRestrictedTopic(q) {
  const norm = (q || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return RESTRICTED_RE.test(norm);
}

/**
 * Dedupe op de VERRIJKTE draad-URL: bronnen die (na redirect) naar dezelfde
 * draad wijzen — bv. een reactie-permalink en de post zelf — worden samengevoegd
 * tot één treffer. Post-vorm wint; het viaReactie-signaal blijft behouden. De
 * verrijking (reacties/tags) wordt gemerged (max reacties, unie van tags).
 */
export function dedupeByThread(forumSources, replyByUrl) {
  const canon = (s) => {
    const enr = replyByUrl.get(s.url);
    const base = (enr && enr.finalUrl) ? enr.finalUrl : s.url;
    return base.split('#')[0].replace(/\/+$/, '');
  };
  const groups = new Map();
  for (const s of forumSources) {
    const key = canon(s);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const out = [];
  for (const group of groups.values()) {
    const rep = group.find(g => g.kind !== 'comment') || group[0]; // post-vorm wint
    const viaReactie = group.some(g => g.kind === 'comment' || g.viaReactie);
    // Verrijking mergen naar de representatieve URL.
    const enrRep = replyByUrl.get(rep.url) || {};
    let maxReply = enrRep.replyCount || 0;
    const tagSet = new Set(enrRep.tags || []);
    for (const g of group) {
      const e = replyByUrl.get(g.url);
      if (!e) continue;
      if ((e.replyCount || 0) > maxReply) maxReply = e.replyCount || 0;
      for (const t of e.tags || []) tagSet.add(t);
    }
    replyByUrl.set(rep.url, { ...enrRep, replyCount: maxReply, tags: [...tagSet] });
    out.push({ ...rep, viaReactieMerged: viaReactie });
  }
  return out;
}

/**
 * Bepaal tier + score per forumbron en sorteer aflopend.
 * tier 1 = promoted, 2 = auteur in goudlijst, 3 = reacties ≥ 5, 4 = rest.
 * Binnen een tier telt recentere datum zwaarder. Comment-treffers krijgen
 * viaReactie:true en tellen (promoted/replies) mee voor hun draad.
 *
 * Ouderdomsdemping is per bron houdbaarheid-gestuurd (gecureerde tabel): de
 * KORTSTE houdbaarheid over de tags van de bron domineert. Tags komen uit de
 * verrijking (draadpagina). Heeft een bron geen tags, dan is de query-heuristiek
 * (ctx.queryYears) het vangnet. Niets wordt op ouderdom verwijderd; oude bronnen
 * zakken glijdend en krijgen datumwaarschuwing:true (met de veroorzakende tag).
 *
 * ctx: { gold:Set, promoted:{ids,titles}, replyByUrl:Map, curYear:number, queryYears:number }
 */
export function scoreForumSources(forumSources, ctx) {
  const { gold, promoted, replyByUrl, curYear, queryYears = DEFAULT_HOUDBAARHEID } = ctx;
  const scored = forumSources.map((s) => {
    const isComment = s.kind === 'comment';
    const objId = blogObjectId(s.url);

    // Promoted: exact op BlogPost-object-id; anders genormaliseerde titel-match
    // (best-effort fallback, gedocumenteerd). Voor comments de titel van de
    // draad waarnaar verwezen wordt (tussen de aanhalingstekens).
    let matchTitle = s.titel || '';
    if (isComment) {
      const q = matchTitle.match(/['"“”‘’«»](.+?)['"“”‘’«»]/);
      if (q) matchTitle = q[1];
    }
    const isPromoted =
      (objId && promoted && promoted.ids.has(objId)) ||
      (promoted && promoted.titles.has(normTitle(matchTitle)));

    // Goudlijst: auteur (display of screennaam) featured lid?
    const goldAuthor =
      (s.auteur && gold.has(normName(s.auteur))) ||
      (s.auteurId && gold.has(normName(s.auteurId)));

    const enr = replyByUrl.get(s.url) || {};
    const replyCount = enr.replyCount != null ? enr.replyCount : (s.reacties || 0);

    let tier = 4;
    if (isPromoted) tier = 1;
    else if (goldAuthor) tier = 2;
    else if (replyCount >= 5) tier = 3;

    // Houdbaarheid: kortste over de tags van de bron (uit de verrijking). Geen
    // tags → query-heuristiek als vangnet. De veroorzakende tag onthouden.
    const tags = enr.tags || [];
    const sh = shortestHoudbaarheid(tags);
    const years = sh ? sh.years : queryYears;
    const houdbaarheidLabel = sh ? sh.label : '(zoekterm-heuristiek)';

    const rec = houdbaarheidRecency(s.datum, curYear, years);
    const datumwaarschuwing = isDatumwaarschuwing(s.datum, curYear, years);
    const replyBonus = replyCount > 0 ? Math.min(30, Math.log2(replyCount + 1) * 6) : 0;
    // Tier domineert; daarbinnen de houdbaarheid-gestuurde recency, dan reacties.
    const score = (5 - tier) * 10000 + rec * 1000 + replyBonus;

    const out = {
      ...s,
      tier,
      viaReactie: isComment || !!s.viaReactieMerged,
      replyCount: enr.replyCount,
      views: enr.views,
      _score: score,
    };
    delete out.viaReactieMerged;
    if (tags.length) out.tags = tags;
    if (datumwaarschuwing) {
      out.datumwaarschuwing = true;
      out.datumwaarschuwingTag = houdbaarheidLabel;
    }
    return out;
  });
  scored.sort((a, b) => b._score - a._score);
  return scored;
}
