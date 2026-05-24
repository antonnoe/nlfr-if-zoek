export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  const rubrieken = [
    'Bouw', 'Correspondentie', 'Cursussen', 'Dieren', 'Exterieur',
    'Geldzaken', 'Gezondheid/Sport', 'Korte verhalen', 'Woordenlijst',
    'MKB', 'Migratie', 'Onderwijs', 'Ouderverzorging', 'Overheid en wet',
    'Overige diensten', 'Telecommunicatie', 'Te koop', 'Te koop gevraagd',
    'Vervoer', 'Verenigingen', 'Werkaanbod', 'Werk algemeen', 'Werk gevraagd',
    'Woningbeheer', 'Huizen aangeboden', 'Wonen algemeen', 'Woningen gevraagd',
  ];
  return res.status(200).json({ rubrieken });
}
