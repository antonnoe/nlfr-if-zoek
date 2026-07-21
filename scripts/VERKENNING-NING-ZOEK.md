# Verkenning — NING-forumzoek als bronleverancier voor `/api/search`

**Status:** verkennend, géén productiewijziging. `api/search.js` en `src/` zijn niet aangeraakt.
**Datum:** 2026-07-21

---

## TL;DR

- **Kon niet live geverifieerd worden vanuit deze ontwikkel-sandbox.** Twee onafhankelijke
  ophaalwegen worden geblokkeerd:
  1. Server-side `fetch`/`curl` → de egress-policy van deze sessie weigert de host
     (`gateway answered 403 to CONNECT` voor `www.nederlanders.fr:443`).
  2. De onafhankelijke `WebFetch`-weg → **HTTP 403** van NING zelf, óók op de homepage
     (NING/Ning-platform blokkeert niet-browser/bot-verkeer).
- **Maar: er is sterk indirect bewijs dat het vanuit productie (Vercel) wél kan.** De
  bestaande functie `enrichTopThreads()` in `api/search.js` haalt nú al individuele
  `nederlanders.fr`-pagina's server-side op (met een simpele custom User-Agent) en parseert
  echte NING-HTML-markers (`Reactie van`, `Weergaven:`). Dat draait in productie op Vercel.
  De 403's hierboven zijn dus artefacten van de sandbox/WebFetch-omgeving, niet noodzakelijk
  van Vercel.
- **Advies:** de PoC-parser (`verkenning-ning-zoek.mjs`) is geschreven en klaar, maar zijn
  selectors moeten nog op de echte live-HTML worden geijkt — te doen vanaf een toegelaten
  omgeving/IP (lokaal, of een tijdelijke Vercel-preview-functie). Zie
  "Voorstel" onderaan voor hoe dit veilig in `/api/search` te mengen is, inclusief het
  5-jaar-tijdfilter.

---

## 1. Wat is er getest, en wat kwam eruit

Doel-URL: `https://www.nederlanders.fr/main/search/search?q=<term>` als niet-ingelogde bezoeker.

| Poging | Weg | Resultaat |
|---|---|---|
| `curl` met browser-UA, term `septic tank` | sandbox → egress-proxy | `HTTP 000` (geen verbinding) |
| idem, varianten `&format=rss`, `&feed=yes`, `&page=2`, `/search?q=` | sandbox → egress-proxy | `HTTP 000` (geen verbinding) |
| `node fetch` (`NODE_USE_ENV_PROXY=1`), 2 termen + pagina 2 | sandbox → egress-proxy | `NETWERK: fetch failed` |
| `WebFetch` op zoek-URL | Anthropic-infra | **HTTP 403 Forbidden** |
| `WebFetch` op homepage `/` | Anthropic-infra | **HTTP 403 Forbidden** |

**Bewijs egress-blok** (uit `GET $HTTPS_PROXY/__agentproxy/status`, veld `recentRelayFailures`):

```json
{
  "kind": "connect_rejected",
  "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
  "host": "www.nederlanders.fr:443"
}
```

De proxy-README is expliciet: een 403 van de gateway is een organisatie-egresspolicy-blok
dat **niet omzeild of geretried** mag worden — alleen gerapporteerd. Dat is hier gedaan.

**Conclusie van stap 1 & 2:** de statuscode, de HTML-inhoud, de veld-herkenning
(titel/URL/snippet/datum/auteur), paginering en de machineleesbare varianten (RSS/atom/feed)
**konden niet empirisch worden vastgesteld** vanuit deze omgeving. Ik heb dit niet met
verzonnen selectors "ingevuld" — dat zou de verkenning waardeloos maken.

### Wat we wél met zekerheid weten over NING's HTML (uit de bestaande codebase)

`api/search.js` bevat al werkende, in-productie-gebruikte kennis van NING-pagina's:

- `enrichTopThreads()` doet `fetch(threadUrl, { headers: { 'User-Agent': 'NLFR-IF-Zoek/1.0' } })`
  met 3s-timeout en leest daaruit:
  - reacties: `html.match(/Reactie van/g)` en `/(\d+)\s*Reacties?/i`
  - weergaven: `/Weergaven:\s*([\d.]+)/`
- Auteurs worden in `src/App.jsx` gelinkt als `https://www.nederlanders.fr/profile/<screennaam>`.
- Content-URL-patronen (uit `ning/nlfr-menu-2.html` en App.jsx): `/profiles/blog(s)/…`,
  `/forum/topics/…`, `/page/…`, `/group/…`, `/photo/…`, `/video/…`.

Deze feiten zijn in de PoC-parser als startpunt (hypothesen) verwerkt.

---

## 2. Machineleesbare varianten (RSS/atom/feed)

Niet live te testen (zelfde blok). Op basis van Ning-platformkennis, als aandachtspunten
om vanaf een toegelaten omgeving te proberen:

- **Zoek-endpoint zelf** biedt vrijwel zeker geen RSS — Ning's `main/search/search` is een
  HTML-view. `?format=rss` / `?feed=yes` op de zoek-URL leverden hier niets (geen verbinding),
  en zijn op Ning doorgaans geen ondersteunde parameters voor de zoekpagina.
- **Wél bestaande Ning-feeds** (op andere endpoints, niet zoekgebonden): `/<content>/feed`,
  `/profiles/blog/feed?xn_auth=no` (staat al in het menu-bestand), `/activity/log/list?fmt=rss`.
  Die zijn niet gefilterd op een zoekterm en dus **geen** directe vervanging voor zoek.
- **Advies:** reken niet op een machineleesbare zoek-feed. Ga uit van HTML-parsen (de PoC),
  tenzij ijking op de live-HTML alsnog een JSON/JSON-LD-payload in de zoekpagina blootlegt —
  de PoC probeert JSON-LD daarom éérst.

---

## 3. Proof-of-concept parser

Bestand: `scripts/verkenning-ning-zoek.mjs` (dependency-vrij; `node >= 18`).

```
node scripts/verkenning-ning-zoek.mjs "septic tank"
node scripts/verkenning-ning-zoek.mjs "carte vitale" --page=2 --max=20 --debug
```

Uitvoer = JSON met `{ ok, term, page, url, status, parser, count, results[] }`,
waarbij elk resultaat `{ titel, url, snippet, datum, auteur }` is.

**Parse-strategie (defensief, meerlaags):**
1. **JSON-LD** (`<script type="application/ld+json">`) — robuustst als NING het levert.
2. **DOM-heuristiek** — splitst op anchors naar bekende NING-content-URL's, reconstrueert
   per treffer een blok en haalt titel (anchor-tekst), url (href, geabsoluteerd),
   snippet (omringende tekst), datum (NL-datum/ISO/`20xx` → genormaliseerd jaar) en
   auteur (`/profile/<naam>`-link, of "door/van/Reactie van <Naam>").
3. Dedup op URL, begrenzing op `--max` (default 20), paginering via `?page=N` (aanname).

**Belangrijk:** het script meldt expliciet `ZERO_RESULTS` als het een respons kreeg maar
niets herkende, en `NETWERK`/`HTTP <code>` bij een blok — het verzint nooit resultaten.

**Draai-bewijs (in deze sandbox, 2 termen + pagina 2):** alle drie runs eindigden met
`"error": "NETWERK: fetch failed"` — precies zoals verwacht bij de egress-blokkade.
Dat bewijst dat het script correct en fail-safe werkt; het bewijst (nog) niet de selectors.
Die stap moet vanaf een toegelaten omgeving gebeuren.

---

## 4. Hoe stabiel oogt de structuur, en voorstel voor `/api/search`

### Stabiliteitsinschatting

- Ning is een volwassen, weinig-veranderend platform; de **URL-patronen** en de
  **NL-markers** (`Reactie van`, `Weergaven:`, `/profile/<naam>`) zijn al langer stabiel
  (de bestaande productie leunt er al op). HTML-**class-namen** in de zoekview zijn het
  grootste risico — die kunnen bij een Ning-thema-update wijzigen. Daarom parseert de PoC
  op URL-patroon + tekstmarkers i.p.v. op fragiele class-namen, en probeert JSON-LD eerst.
- Reëel risico's: (a) **bot-blokkade** (403/CAPTCHA) op datacenter-IP's zoals Vercel;
  (b) **latency** (HTML-zoekpagina + evt. detailpagina's) binnen de serverless-timeout;
  (c) HTML-driftbreuk. Elk hiervan pleit voor "additief en degraderend", niet "vervangend".

### Voorstel om dit in `/api/search` te mengen (niet nu, wél ontworpen)

1. **Additief naast Serper, niet vervangend.** Behoud `serperSearch()` (dekt IF goed).
   Voeg een derde, parallelle bron toe — `ningSearch(q)` — met `Promise.allSettled`, zodat
   een NING-403/timeout de rest nooit sloopt. NING levert juist de forumtreffers die Google
   mist; Serper blijft de IF-dossiers leveren.
2. **Hard budget + faal-stil.** Geef `ningSearch` een strakke `AbortController`-timeout
   (bv. 2.5–3s, zoals `enrichTopThreads` nu al doet) en behandel elke non-200 als "0 treffers".
3. **Zelfde pijplijn erna.** Map NING-treffers naar dezelfde hit-vorm
   (`{ title, link, snippet, date }`) en voer ze door dezelfde weg: Haiku-samenvatting →
   `parseSources` → `validUrl` → **tijdfilter** → sorteren → begrenzen. Dedup op URL tegen de
   Serper-hits (NING-URL's kunnen dubbel voorkomen).
4. **Caching ongewijzigd** (7 dagen). Let op: bestaande zoektermen tonen de mix pas na een
   verse (niet-gecachte) query — vermeld dat bij oplevering.

### Wat er met het 5-jaar-tijdfilter moet gebeuren

Het huidige filter (`api/search.js`):

```js
const cutoffYear = new Date().getFullYear() - 5;
const passesTimeFilter = (type, dateStr) => {
  if (type === 'if') return true;              // IF mag ouder
  const m = dateStr && dateStr.match(/(20\d{2})/);
  if (!m) return true;                          // geen herkenbaar jaar → blijft staan
  return parseInt(m[1], 10) >= cutoffYear;      // forum: alleen laatste 5 jaar
};
```

Consequenties voor een NING-zoekbron:

- Het filter kan **ongewijzigd** blijven, mits `ningSearch` per treffer een **`datum` met een
  herkenbaar `20xx`-jaar** aanlevert. De PoC's `extractDate()` normaliseert NL-datums/ISO/jaar
  daar al naartoe.
- **Risico:** als NING alleen **relatieve** datums toont ("3 jaar geleden") of géén datum in de
  zoekview, dan matcht `(20\d{2})` niet → de treffer **passeert het filter altijd** (want
  "geen jaar → blijft staan"). Dan lekken mogelijk >5 jaar oude forumposts binnen. Twee opties:
  - **A (voorkeur):** relatieve datums in `extractDate()` omrekenen naar een absoluut jaar
    (`"X jaar geleden"` → `currentYear - X`), zodat het bestaande filter blijft werken.
  - **B:** de default omdraaien speciaal voor NING-treffers (geen jaar → wél wegfilteren),
    maar dat raakt de gedeelde `passesTimeFilter`-logica en is dus invasiever.
- NING's zoek heeft mogelijk een eigen tijd-parameter; als die bestaat, kan filteren aan de
  bron (server-side) betrouwbaarder zijn dan achteraf op geparste datums. Te verifiëren bij ijking.

---

## 5. Concrete vervolgstappen (om de verkenning af te maken)

1. Draai `verkenning-ning-zoek.mjs` op 2–3 termen vanaf een **toegelaten omgeving/IP**
   (lokaal of Vercel-preview) — bevestig statuscode, of NING datacenter-IP's 403't, en of er
   resultaten in de HTML zitten.
2. Als er HTML terugkomt: ijk de selectors (of bevestig JSON-LD), leg vast hoe titel/URL/
   snippet/**datum**/auteur precies te herkennen zijn, en test paginering (echte parameter).
3. Beslis o.b.v. datum-beschikbaarheid welke tijdfilter-optie (A of B hierboven) nodig is.
4. Pas daarna, in een aparte PR, `ningSearch()` additief in `/api/search` in met hard budget
   en `Promise.allSettled`.
```
