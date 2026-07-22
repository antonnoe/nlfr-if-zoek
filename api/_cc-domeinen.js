// ---------------------------------------------------------------------------
// Café Claude-kennisdomeinen
// ---------------------------------------------------------------------------
// Café Claude beantwoordt vragen binnen strak afgebakende kennisdomeinen. De
// verwijzingen naar Café Claude (de tekstregel onder de bronnen, het grote blok
// onderaan en de optie in de limietkaart) mogen ALLEEN verschijnen wanneer de
// zoekvraag binnen een van die domeinen valt. Een "Montmartre"-zoeker doorsturen
// naar Café Claude beschadigt het vertrouwen.
//
// BEHEER: dit is een door de beheerder uitbreidbare configuratie. Voeg een
// domein toe door een object aan CC_DOMEINEN toe te voegen, of breid een bestaand
// domein uit met extra `rubrieken`/`tags`/`trefwoorden`. Alles is hoofdletter- en
// accent-ongevoelig en leestekens (spaties, +, -, komma's) worden genegeerd bij
// het matchen, dus je mag rubriek- en tagnamen gewoon leesbaar noteren
// ("Midden- en Kleinbedrijf", "Gezondheid, Sport en Spel"). Trefwoorden matchen
// op hele woorden in de query én op meerwoordige begrippen zonder spaties
// ("carte de séjour" → "cartedesejour"). Eén treffer (rubriek, brontag óf
// trefwoord) volstaat om een domein-match te geven.

export const CC_DOMEINEN = [
  {
    naam: 'Ondernemen',
    rubrieken: ['Werk Algemeen', 'Midden- en Kleinbedrijf', 'Horeca en Toerisme'],
    tags: ['Werk Algemeen', 'Midden- en Kleinbedrijf', 'Horeca en Toerisme'],
    trefwoorden: [
      'micro-entreprise', 'microentreprise', 'auto-entrepreneur', 'autoentrepreneur',
      'sasu', 'sarl', 'sas', 'eurl', 'kvk', 'inschrijving', 'siret', 'siren', 'urssaf',
      'ondernemen', 'ondernemer', 'onderneming', 'zzp', 'eenmanszaak', 'bedrijf starten',
      'zelfstandige', 'freelance', 'btw', 'tva',
    ],
  },
  {
    naam: 'Wonen & Vastgoed',
    rubrieken: ['Woningen Algemeen', 'Bouw'],
    tags: ['Woningen Algemeen', 'Bouw'],
    // Bewust NIET de marktplaats-advertentietags (Te Koop Aangeboden e.d.).
    trefwoorden: [
      'kopen', 'huis kopen', 'huiskopen', 'notaris', 'notaire', 'compromis',
      'compromis de vente', 'diagnostics', 'diagnostic', 'acte', 'acte de vente',
      'koopakte', 'hypotheek', 'immobilier', 'vastgoed kopen', 'bien immobilier',
      'verbouwen', 'verbouwing', 'permis de construire', 'bouwvergunning',
    ],
  },
  {
    naam: 'Geld & Belasting',
    rubrieken: ['Geldzaken', 'Overheid'],
    tags: ['Geldzaken', 'Overheid'],
    trefwoorden: [
      'belasting', 'belastingaangifte', 'aangifte', 'impots', 'impot', 'impôt',
      'fiscaal', 'fiscale', 'taxe', "taxe d'habitation", 'taxe fonciere',
      'pensioen', 'aow', 'svb', 'uitkering', 'rekening', 'bank', 'iban',
    ],
  },
  {
    naam: 'Verzekeren',
    rubrieken: [],
    tags: [],
    trefwoorden: [
      'verzekering', 'verzekeren', 'verzekerd', 'zorgverzekering', 'mutuelle',
      'assurance', 'assure', 'ehic', 'aansprakelijkheid', 'responsabilite civile',
      'autoverzekering', 'opstalverzekering', 'inboedel',
    ],
  },
  {
    naam: 'Gezondheid & Zorg',
    rubrieken: ['Gezondheid, Sport en Spel', 'Ouderverzorging'],
    tags: ['Gezondheid, Sport en Spel', 'Ouderverzorging'],
    trefwoorden: [
      'huisarts', 'médecin', 'medecin', 'dokter', 'arts', 'apotheek', 'pharmacie',
      'ziekenhuis', 'hopital', 'zorg', 'medisch', 'behandeling', 'specialist',
      'tandarts', 'dentiste', 'ouderenzorg', 'thuiszorg', 'ehpad',
    ],
  },
  {
    naam: 'Bureaucratie & Papieren',
    rubrieken: ['Overheid', 'Migratie', 'Onderwijs', 'Kinderen'],
    tags: ['Overheid', 'Migratie', 'Onderwijs', 'Kinderen'],
    trefwoorden: [
      'rijbewijs', 'permis de conduire', 'carte de séjour', 'cartedesejour',
      'titre de séjour', 'titredesejour', 'identiteitskaart', 'identiteitsdocument',
      'identiteitsdocumenten', 'paspoort', 'passeport', 'prefecture', 'préfecture',
      'inschrijven', 'inschrijving', 'geboorteakte', 'huwelijksakte', 'apostille',
      'visum', 'visa', 'verblijfsvergunning', 'document',
    ],
  },
];

// URL-vormen (rubriek-tags als "Gezondheid%2C+Sport+en+Spel") eerst ontdoen van
// %-codering en +; foutieve codering laat de string ongemoeid.
function decodeSafe(s) {
  const raw = String(s || '').replace(/\+/g, ' ');
  try { return decodeURIComponent(raw); } catch { return raw; }
}
// Accent-strip + lowercase (voor woord-tokens: leestekens blijven als grens).
function normNfd(s) {
  return decodeSafe(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
// Volledig genormaliseerde sleutel: alleen letters/cijfers overhouden. Zo vallen
// "Werk Algemeen", "Werk+Algemeen" en "werk algemeen" op elkaar.
function normKey(s) {
  return normNfd(s).replace(/[^a-z0-9]/g, '');
}

/**
 * Valt de zoekopdracht binnen een Café Claude-domein?
 *
 * @param {object} args
 * @param {string}   args.query          De ruwe zoekvraag.
 * @param {string[]} [args.rubriekSignals] Rubriek-signalen (rubriek-sleutel en/of
 *                                        de bijbehorende NING-tag); lege/undefined
 *                                        waarden worden genegeerd.
 * @param {string[]} [args.tags]         Tags van de gevonden bronnen (uit de
 *                                        verrijking).
 * @returns {boolean} true zodra rubriek, een brontag óf een trefwoord matcht.
 */
export function matchtCafeClaude({ query, rubriekSignals = [], tags = [] } = {}) {
  const rubKeys = new Set((rubriekSignals || []).filter(Boolean).map(normKey));
  const tagKeys = new Set((tags || []).filter(Boolean).map(normKey));
  const qJoined = normKey(query);
  const qTokens = new Set(
    normNfd(query).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  );

  for (const d of CC_DOMEINEN) {
    // (1) Rubriek/tag-signatuur: exacte genormaliseerde gelijkheid.
    for (const naam of [...(d.rubrieken || []), ...(d.tags || [])]) {
      const sig = normKey(naam);
      if (sig && (rubKeys.has(sig) || tagKeys.has(sig))) return true;
    }
    // (2) Trefwoorden: heel woord in de query, of — voor langere (samengestelde)
    //     begrippen — als deelstring van de samengevoegde query. De lengtedrempel
    //     voorkomt dat korte woorden toevallig in een ander woord opduiken.
    for (const w of d.trefwoorden || []) {
      const token = normKey(w);
      if (!token) continue;
      if (qTokens.has(token)) return true;
      if (token.length >= 6 && qJoined.includes(token)) return true;
    }
  }
  return false;
}
