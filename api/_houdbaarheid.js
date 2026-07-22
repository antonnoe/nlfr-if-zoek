/**
 * Door de beheerder gecureerde houdbaarheidstabel — wijzigingen alleen op diens
 * aanwijzing.
 *
 * Per rubriek-tag de houdbaarheid in JAREN (Infinity = tijdloos). Wordt gebruikt
 * om forumbronnen glijdend te dempen naar rato van ouderdom/houdbaarheid.
 * Principe: inclusief — niets wordt ooit op ouderdom verwijderd; oude bronnen
 * zakken alleen in de score en krijgen desnoods datumwaarschuwing: true.
 *
 * Regels:
 *  - Meerdere tags op één bron → de KORTSTE houdbaarheid domineert; de
 *    waarschuwing vermeldt welke tag dat is.
 *  - Onbekende tag → 5 jaar (DEFAULT).
 *  - datumwaarschuwing zodra de ouderdom de houdbaarheid ruim overschrijdt
 *    (± 2× bij korte houdbaarheden). Tijdloos (Infinity) → nooit.
 */

// Sleutels zijn de weergavenamen; matching gebeurt genormaliseerd (zie normTag).
export const HOUDBAARHEID = {
  'Overheid': 1,
  'Geldzaken': 1,
  'Telecommunicatie': 2,
  'Ledenservice': Infinity,
  'Werk Algemeen': 5,
  'Midden- en Kleinbedrijf': 5,
  'Horeca en Toerisme': 5,
  'Vervoer': 1,
  'Overige Diensten': 5,
  'Onderwijs': 5,
  'Cursussen en Opleidingen': 5,
  'Kinderen': 5,
  'Vertaling': Infinity,
  'Gezondheid, Sport en Spel': 5,
  'Ouderverzorging': 5,
  'Clubs, Verenigingen en Bijéénkomsten': 0.5,
  'Correspondentie': 10,
  'Migratie': 10,
  'Bouw': 10,
  'Inrichting': 10,
  'Exterieur': 10,
  'Woningen Algemeen': 10,
  'Woningbeheer en Huishouding': 5,
  'Korte Verhalen': Infinity,
  'Kunst en Cultuur': Infinity,
  'Recepten': Infinity,
  'Lexicon': Infinity,
  'Dieren': Infinity,
  'Te Koop Aangeboden': 0.5,
  'Te Koop Gevraagd': 0.5,
  'Werk Aangeboden': 0.5,
  'Werk Gevraagd': 0.5,
  'Woningen Aangeboden': 1,
  'Woningen Gevraagd': 0.5,
  'Vakantiehuis': 1,
  'Woningruil': 0.5,
  'Contact Gezocht': 5,
};

export const DEFAULT_HOUDBAARHEID = 5; // onbekende tag → 5 jaar

// Genormaliseerde lookup (accenten/leestekens/hoofdletters-onafhankelijk).
export function normTag(s) {
  return (s || '')
    .toString()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
const NORM_TABLE = new Map(Object.entries(HOUDBAARHEID).map(([k, v]) => [normTag(k), { years: v, label: k }]));

// Datumtag? NING hangt aan draadpagina's een datum-tag (bv. 20210417) — negeren.
export function isDateTag(tag) {
  return /^\d{6,8}$/.test((tag || '').trim());
}

// Houdbaarheid voor één tag (onbekend → default). Geeft {years, label}.
export function houdbaarheidForTag(tag) {
  const hit = NORM_TABLE.get(normTag(tag));
  if (hit) return hit;
  return { years: DEFAULT_HOUDBAARHEID, label: (tag || '').trim() || 'onbekend' };
}

// Kortste houdbaarheid over meerdere tags (datumtags genegeerd). De kortste
// domineert; we onthouden welke tag dat is voor de waarschuwing.
// Geeft null als er geen bruikbare tags zijn.
export function shortestHoudbaarheid(tags) {
  let best = null;
  for (const t of tags || []) {
    if (!t || isDateTag(t)) continue;
    const h = houdbaarheidForTag(t);
    if (best === null || h.years < best.years) best = h;
  }
  return best; // {years, label} of null
}

// Glijdende demping (0..1) naar rato ouderdom/houdbaarheid. Tijdloos → 1 (zakt
// niet door ouderdom). age==houdbaarheid → 0.5; ouder → glijdend lager.
export function houdbaarheidRecency(datum, curYear, years) {
  const m = (datum || '').match(/(20\d{2})/);
  if (!m) return 0.5;
  const age = curYear - parseInt(m[1], 10);
  if (age <= 0) return 1;
  if (!isFinite(years)) return 1;
  const ratio = age / years;
  return Math.max(0.02, 1 / (1 + ratio));
}

// datumwaarschuwing zodra de ouderdom de houdbaarheid ruim (±2×) overschrijdt.
// Tijdloos → nooit.
export function isDatumwaarschuwing(datum, curYear, years) {
  if (!isFinite(years)) return false;
  const m = (datum || '').match(/(20\d{2})/);
  if (!m) return false;
  const age = curYear - parseInt(m[1], 10);
  return age > years * 2;
}
