# nlfr-if-zoek

AI-zoekassistent voor Nederlanders.fr en Infofrankrijk.com. Vite + React frontend, Vercel serverless backend, Anthropic API met `web_search` tool.

## Toegangsmodel

- **Niet-abonnees:** 3 zoekopdrachten per dag per IP
- **Infofrankrijk-abonnees:** 10 zoekopdrachten per dag per email (via HMAC-SSO)
- Beide via Upstash Redis (`Ratelimit.fixedWindow`)

## Vereiste Vercel environment variables

| Key | Waar te vinden |
|---|---|
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys |
| `INFOFRANKRIJK_SSO_SECRET` | `wp-config.php` op Infofrankrijk — exact dezelfde waarde |
| `UPSTASH_REDIS_REST_URL` | Upstash dashboard → database → REST API |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash dashboard → database → REST API |

**Belangrijk:** controleer dat geen van de waarden begint of eindigt met whitespace. Vercel waarschuwt hiervoor in de UI.

## Setup

1. Maak een Upstash Redis database aan (regional, dichtst bij Vercel-regio)
2. Voeg de 4 env vars toe in Vercel project settings
3. Deploy

## SSO koppeling op Infofrankrijk

Plaats `wp-snippets/nlfr-if-zoek.php` als WP Code Snippet. Gebruik dan in pagina's:

```
[nlfr_if_zoek]
[nlfr_if_zoek label="Open AI-zoek"]
[nlfr_if_zoek q="carte vitale"]
```

Zonder token werkt de app ook (gratis tier, IP-based).

## Iframe-zoekbalk op NLFR

```html
<p><iframe src="https://nlfr-if-zoek.vercel.app/zoekbalk.html"
  style="width:100%; max-width:850px; height:45px; border:none; overflow:hidden; margin:0 auto 4px; display:block;"
  title="AI Zoek"></iframe></p>
```

## Lokale dev

```
npm install
npm run dev
```

Voor de serverless function lokaal: `vercel dev` (vereist Vercel CLI + lokale `.env.local` met alle 4 env vars).
