import crypto from 'crypto';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const SYSTEM_PROMPT = `Je bent de AI-zoekassistent van Nederlanders.fr, het grootste Nederlandstalige forum voor Nederlanders en Belgen in Frankrijk (25.000+ leden, sinds 2002).

OPDRACHT:
Zoek informatie op infofrankrijk.com EN nederlanders.fr en geef een VERHALEND antwoord — geen linklijst.

STRUCTUUR VAN JE ANTWOORD:
Je antwoord heeft drie duidelijke delen, elk gescheiden door een witregel:

DEEL 1 — CONTEXT VIA INFOFRANKRIJK (3-4 zinnen):
Begin ALTIJD met wat Infofrankrijk.com over dit onderwerp schrijft. Dit is de redactionele bron met geverifieerde informatie. Verwijs naar het meest relevante IF-artikel met link en geef een korte samenvatting van wat de lezer daar vindt.

DEEL 2 — WAT FORUMLEDEN ZEGGEN (ervaringen van NLFR):
Vertel per forumbijdrage in een KORTE EIGEN ALINEA (2-4 zinnen max) wat er gezegd werd. Elke alinea begint met de auteur en datum. Wissel af: ervaring, vraag, tip, waarschuwing. Gebruik **vetgedrukt** voor sleuteltermen (vaknummers, deadlines, bedragen, wetswijzigingen).

DEEL 3 — SAMENVATTING / TIP (1 korte alinea):
Sluit af met een praktische tip of waarschuwing op basis van wat je hebt gevonden.

STIJLREGELS:
- Maximaal 4 zinnen per alinea — korter is beter
- Elke nieuwe forumbijdrage of nieuw punt = nieuwe alinea
- Gebruik **vetgedrukt** voor concrete feiten: vakjes, bedragen, deadlines, wetsartikelen
- Gebruik NOOIT bullet points, genummerde lijsten of opsommingen
- Schrijf in vloeiend Nederlands, zakelijk maar toegankelijk
- Maximaal 350 woorden voor het verhalende deel

FILTERS — STRENG TOEPASSEN:
- NEGEER alle URLs die "/m/" bevatten — dat zijn mobiele duplicaten, gebruik nooit
- NEGEER forumposts en blogposts ouder dan 5 jaar (vóór ${new Date().getFullYear() - 5})
- Als je geen datum kunt vinden bij een resultaat, alleen gebruiken als de URL of context recent oogt
- Infofrankrijk-artikelen mogen ouder zijn (redactionele bron blijft relevant)

AUTEURS CITEREN:
- Als je een auteursnaam vindt in een forumpost of blogpost, maak er een link van naar hun profielpagina
- NLFR profielpagina-formaat: https://www.nederlanders.fr/profile/[gebruikersnaam]
- Voorbeeld: [Jeannette311](https://www.nederlanders.fr/profile/Jeannette311) schreef op 14 maart 2024...
- Verzin NOOIT auteursnamen of profiellinks die niet in de zoekresultaten staan

RECENTE DISCUSSIES:
Na het verhalende antwoord, voeg een sectie toe met het kopje "---THREADS---" (exact zo, als scheidingsteken) gevolgd door 5-8 relevante items. Formaat per regel:
THREAD|titel|https://exacte-url|auteursnaam|datum

Regels voor de threads-sectie:
- Infofrankrijk-artikelen ALTIJD bovenaan, daarna NLFR-forumposts
- Geen URLs met "/m/" erin
- Geen forumposts ouder dan 5 jaar
- Sorteer binnen elke groep op datum (nieuwste eerst)
- Gebruik ALLEEN URLs die daadwerkelijk in je zoekresultaten voorkomen
- Als je minder dan 5 items vindt, geef wat je hebt — verzin er geen bij

BELANGRIJK:
- Zoek ALTIJD op beide sites: eerst site:infofrankrijk.com, dan site:nederlanders.fr
- Als je weinig vindt, zeg dat eerlijk
- Verzin NOOIT forumposts, auteurs of URLs die niet in de zoekresultaten staan`;

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

// Init rate limiters (alleen als Upstash env vars aanwezig zijn)
let subscriberLimit = null;
let anonLimit = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  const redis = Redis.fromEnv();
  subscriberLimit = new Ratelimit({
    redis,
    limiter: Ratelimit.fixedWindow(10, '1 d'),
    prefix: 'nlfr-if-zoek:sub',
    analytics: false,
  });
  anonLimit = new Ratelimit({
    redis,
    limiter: Ratelimit.fixedWindow(3, '1 d'),
    prefix: 'nlfr-if-zoek:anon',
    analytics: false,
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key niet geconfigureerd' });

  const { query, token } = req.body || {};
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ error: 'Geen zoekvraag opgegeven' });
  }
  const q = query.trim();

  // Token validatie
  const ssoSecret = process.env.INFOFRANKRIJK_SSO_SECRET;
  const verified = token ? verifyToken(token, ssoSecret) : null;
  const isSubscriber = !!verified;

  // Rate limiting
  if (subscriberLimit && anonLimit) {
    if (isSubscriber) {
      const result = await subscriberLimit.limit(verified.email.toLowerCase());
      if (!result.success) {
        return res.status(429).json({
          error: 'Dagelijkse limiet bereikt',
          subscriber: true,
          limit: result.limit,
          reset: result.reset,
          message: 'Je hebt vandaag je 10 zoekopdrachten gebruikt. Morgen kun je weer verder, of stel je vraag aan Café Claude voor onbeperkte AI-begeleiding.',
        });
      }
    } else {
      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
      const result = await anonLimit.limit(ip);
      if (!result.success) {
        return res.status(429).json({
          error: 'Dagelijkse gratis limiet bereikt',
          subscriber: false,
          limit: result.limit,
          reset: result.reset,
          message: 'Je gratis zoekopdrachten zijn op voor vandaag. Word abonnee van Infofrankrijk voor 10 zoekopdrachten per dag, of probeer morgen opnieuw.',
        });
      }
    }
  }

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
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [
          {
            role: 'user',
            content: `Zoek informatie over: "${q}"\n\nVoer minstens 2 zoekopdrachten uit:\n1. site:infofrankrijk.com ${q}\n2. site:nederlanders.fr ${q} -inurl:/m/\n\nNegeer URLs met "/m/" (mobiele duplicaten) en forumposts ouder dan ${new Date().getFullYear() - 5}. Begin het antwoord met Infofrankrijk-context, daarna pas forumstemmen.`,
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
    const searchCount = data.content?.filter(b => b.type === 'web_search_tool_result')?.length || 0;
    const truncated = data.stop_reason === 'max_tokens';
    const textBlocks = data.content?.filter(b => b.type === 'text') || [];
    const fullText = textBlocks.map(b => b.text).join('\n\n');

    const threadMarker = '---THREADS---';
    const markerIndex = fullText.indexOf(threadMarker);

    let narrative = fullText;
    let threads = [];

    if (markerIndex !== -1) {
      narrative = fullText.slice(0, markerIndex).trim();
      const threadBlock = fullText.slice(markerIndex + threadMarker.length).trim();
      const cutoffYear = new Date().getFullYear() - 5;
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
        .filter(t => t.title && t.url)
        .filter(t => !t.url.includes('/m/'))
        .filter(t => {
          // Filter forumposts ouder dan 5 jaar (IF-artikelen blijven)
          if (t.url.includes('infofrankrijk.com')) return true;
          const yearMatch = t.date && t.date.match(/(20\d{2})/);
          if (!yearMatch) return true;
          return parseInt(yearMatch[1], 10) >= cutoffYear;
        });

      // Sorteer: Infofrankrijk eerst, daarna NLFR
      threads.sort((a, b) => {
        const aIF = a.url.includes('infofrankrijk.com') ? 0 : 1;
        const bIF = b.url.includes('infofrankrijk.com') ? 0 : 1;
        return aIF - bIF;
      });
    }

    return res.status(200).json({
      narrative,
      threads,
      searchCount,
      truncated,
      subscriber: isSubscriber,
    });
  } catch (err) {
    console.error('Search handler error:', err);
    return res.status(500).json({ error: 'Interne serverfout' });
  }
}
