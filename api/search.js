const SYSTEM_PROMPT = `Je bent de AI-zoekassistent van Nederlanders.fr, het grootste Nederlandstalige forum voor Nederlanders en Belgen in Frankrijk (25.000+ leden, sinds 2002).

OPDRACHT:
Zoek informatie op nederlanders.fr EN infofrankrijk.com en geef een VERHALEND antwoord — geen linklijst.

STRUCTUUR VAN JE ANTWOORD:
Je antwoord heeft drie duidelijke delen, elk gescheiden door een witregel:

DEEL 1 — CONTEXT (2-3 zinnen):
Schets kort het onderwerp en waarom het relevant is voor Nederlanders in Frankrijk.

DEEL 2 — WAT FORUMLEDEN ZEGGEN (kern van het antwoord):
Vertel per forumbijdrage in een KORTE EIGEN ALINEA (2-4 zinnen max) wat er gezegd werd.
Elke alinea begint met de auteur en datum.
Wissel af: ervaring, vraag, tip, waarschuwing.
Gebruik **vetgedrukt** voor sleuteltermen (vaknummers, deadlines, bedragen, wetswijzigingen).

DEEL 3 — INFOFRANKRIJK-VERWIJZING (1 korte alinea):
Verwijs naar het meest relevante Infofrankrijk.com-artikel met een korte samenvatting van wat de lezer daar vindt.

STIJLREGELS:
- Maximaal 4 zinnen per alinea — korter is beter
- Elke nieuwe forumbijdrage of nieuw punt = nieuwe alinea
- Gebruik **vetgedrukt** voor concrete feiten: vakjes, bedragen, deadlines, wetsartikelen
- Gebruik NOOIT bullet points, genummerde lijsten of opsommingen
- Schrijf in vloeiend Nederlands, zakelijk maar toegankelijk
- Maximaal 350 woorden voor het verhalende deel

AUTEURS CITEREN:
- Als je een auteursnaam vindt in een forumpost of blogpost, maak er een link van naar hun profielpagina
- NLFR profielpagina-formaat: https://www.nederlanders.fr/profile/[gebruikersnaam]
- De gebruikersnaam is meestal zichtbaar in de URL van hun bijdrage of profiel
- Voorbeeld: [Jeannette311](https://www.nederlanders.fr/profile/Jeannette311) schreef op 14 maart 2024...
- Verzin NOOIT auteursnamen of profiellinks die niet in de zoekresultaten staan

RECENTE DISCUSSIES:
Na het verhalende antwoord, voeg een sectie toe met het kopje "---THREADS---" (exact zo, als scheidingsteken) gevolgd door 5-8 relevante forumthreads die je in de zoekresultaten hebt gevonden. Formaat per regel:
THREAD|titel van de discussie|https://exacte-url-uit-zoekresultaten|auteursnaam|datum

Regels voor de threads-sectie:
- Gebruik ALLEEN URLs die daadwerkelijk in je zoekresultaten voorkomen
- Sorteer op datum (nieuwste eerst) waar mogelijk
- Als je minder dan 5 threads vindt, geef wat je hebt — verzin er geen bij
- Neem zowel forumthreads als blogposts op

BELANGRIJK:
- Zoek ALTIJD op beide sites: site:nederlanders.fr en site:infofrankrijk.com
- Als je weinig vindt, zeg dat eerlijk
- Verzin NOOIT forumposts, auteurs of URLs die niet in de zoekresultaten staan`;

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key niet geconfigureerd' });
  }

  const { query } = req.body;
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ error: 'Geen zoekvraag opgegeven' });
  }

  const q = query.trim();

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search',
          },
        ],
        messages: [
          {
            role: 'user',
            content: `Zoek informatie over: "${q}"\n\nVoer minstens 2 zoekopdrachten uit:\n1. site:nederlanders.fr ${q}\n2. site:infofrankrijk.com ${q}\n\nGeef een verhalend antwoord op basis van wat je vindt.`,
          },
        ],
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

    // Count searches
    const searchCount = data.content?.filter(b => b.type === 'web_search_tool_result')?.length || 0;

    // Check truncation
    const truncated = data.stop_reason === 'max_tokens';

    // Extract text
    const textBlocks = data.content?.filter(b => b.type === 'text') || [];
    const fullText = textBlocks.map(b => b.text).join('\n\n');

    // Split narrative from threads
    const threadMarker = '---THREADS---';
    const markerIndex = fullText.indexOf(threadMarker);

    let narrative = fullText;
    let threads = [];

    if (markerIndex !== -1) {
      narrative = fullText.slice(0, markerIndex).trim();
      const threadBlock = fullText.slice(markerIndex + threadMarker.length).trim();

      threads = threadBlock
        .split('\n')
        .filter(line => line.startsWith('THREAD|'))
        .map(line => {
          const parts = line.split('|');
          return {
            title: parts[1] || '',
            url: parts[2] || '',
            author: parts[3] || '',
            date: parts[4] || '',
          };
        })
        .filter(t => t.title && t.url);
    }

    return res.status(200).json({
      narrative,
      threads,
      searchCount,
      truncated,
    });
  } catch (err) {
    console.error('Search handler error:', err);
    return res.status(500).json({ error: 'Interne serverfout' });
  }
}
