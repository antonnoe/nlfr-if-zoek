import { useState, useEffect, useRef } from "react";

const TOKEN_STORAGE_KEY = "nlfr_if_zoek_token";

/* Embed-modus: als de app in een iframe onder een eigen menu draait (?embed=1),
   verbergen we het app-eigen logo, de hero-zoekbalk en de footer. */
const IS_EMBED = (() => {
  try {
    return new URLSearchParams(window.location.search).get("embed") === "1";
  } catch {
    return false;
  }
})();

/* Ledenpoort (zachte poort): met ?lid=1 tonen we de AI-samenvatting; zonder
   komt op die plek een uitnodiging om (gratis) lid te worden. De NING-pagina
   zet lid=1 op basis van ning.CurrentProfile. */
const IS_LID = (() => {
  try {
    return new URLSearchParams(window.location.search).get("lid") === "1";
  } catch {
    return false;
  }
})();

/* NING's eigen forumzoek. Google indexeert het NING-forum nauwelijks, dus we
   bieden altijd een aanvullende link naar de interne zoekfunctie; de zoekterm
   wordt er URL-encoded achter geplakt. */
const NING_SEARCH_URL = "https://www.nederlanders.fr/main/search/search?q=";

/* Vaste, sobere uitlegtekst boven elke resultatenweergave (embed én normaal). */
const EXPLAIN_TEXT =
  "Deze AI-zoek doorzoekt het forum van Nederlanders.fr en de kennisbank van " +
  "Infofrankrijk.com en vat de best passende bronnen samen. Controleer bij geld- " +
  "en overheidszaken altijd de datum van de bron.";

const SIGNUP_URL = "https://www.nederlanders.fr/main/authorization/signUp";

/* ---------- icons ---------- */
const IconSearch = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7"></circle><path d="m21 21-4.3-4.3"></path>
  </svg>
);
const IconArrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path>
  </svg>
);
const IconArrowLeft = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5"></path><path d="m12 19-7-7 7-7"></path>
  </svg>
);

const EXAMPLES = [
  "Carte vitale aanvragen als nieuwkomer",
  "Auto invoeren vanuit Nederland",
  "Belastingaangifte voor niet-residenten",
  "Een micro-entreprise opstarten",
];

const FEATURED_RUBRIEKEN = ["Geldzaken", "Migratie", "Vervoer", "Werk algemeen", "Overheid en wet", "MKB"];

/* ---------- topbar ---------- */
function Topbar({ subscriber }) {
  return (
    <header className="topbar">
      <div className="shell topbar-inner">
        <a className="brand" href="https://www.nederlanders.fr" target="_blank" rel="noopener noreferrer">
          <span className="brand-mark">Nederlanders<em>.fr</em></span>
        </a>
        <div className="topbar-right">
          <a className="topbar-link hide-mob" href="https://www.nederlanders.fr" target="_blank" rel="noopener noreferrer">
            <IconArrowLeft /> Terug naar forum
          </a>
          {subscriber && <span className="badge-pro">IF Abonnee</span>}
        </div>
      </div>
    </header>
  );
}

/* ---------- hero / search ---------- */
function Hero({ query, setQuery, rubriek, setRubriek, rubrieken, onSearch, isSearching, inputRef }) {
  const featured = FEATURED_RUBRIEKEN.filter(r => rubrieken.includes(r));
  const overige = rubrieken.filter(r => !featured.includes(r));
  const isOverigeActive = rubriek && !featured.includes(rubriek);

  return (
    <section className="hero">
      <div className="shell">
        <div className="eyebrow">AI-zoek · Nederlanders.fr &amp; Infofrankrijk</div>
        <h1 className="title">
          Eén vraag, <em>twee bronnen.</em><br />
          Antwoord uit het netwerk.
        </h1>
        <p className="lede">
          Doorzoekt forumbijdragen op Nederlanders.fr en artikelen op Infofrankrijk.com,
          en geeft een verhalend antwoord met bronvermelding.
        </p>

        <div className="search">
          <div className="search-row">
            <span className="search-icon"><IconSearch /></span>
            <input
              ref={inputRef}
              className="search-input"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSearch()}
              placeholder="Stel een vraag over het leven in Frankrijk…"
              disabled={isSearching}
            />
            <button className="search-btn" onClick={onSearch} disabled={isSearching || !query.trim()}>
              {isSearching ? "Zoeken…" : <>Zoeken <IconArrow /></>}
            </button>
          </div>

          {rubrieken.length > 0 && (
            <div className="chips-meta">
              <span className="chips-label">Rubriek</span>
              <button
                className={`chip ${!rubriek ? "is-active" : ""}`}
                onClick={() => setRubriek("")}
              >
                Alle rubrieken
              </button>
              {featured.map((r) => {
                const active = rubriek === r;
                return (
                  <button
                    key={r}
                    className={`chip ${active ? "is-active" : ""}`}
                    onClick={() => setRubriek(active ? "" : r)}
                  >
                    {r}
                    {active && (
                      <span className="chip-close" onClick={(e) => { e.stopPropagation(); setRubriek(""); }}>×</span>
                    )}
                  </button>
                );
              })}
              {overige.length > 0 && (
                <select
                  className={`chip-select ${isOverigeActive ? "is-active" : ""}`}
                  value={isOverigeActive ? rubriek : ""}
                  onChange={(e) => setRubriek(e.target.value)}
                  disabled={isSearching}
                >
                  <option value="">Meer rubrieken…</option>
                  {overige.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ---------- examples (idle) ---------- */
function Examples({ onPick }) {
  return (
    <section className="shell">
      <div className="examples">
        <div className="examples-title">Probeer bijvoorbeeld</div>
        <div className="examples-grid">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="example" onClick={() => onPick(ex)}>
              <span>{ex}</span>
              <span className="example-arrow">→</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- searching state (animated steps) ---------- */
function Searching() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 700);
    const t2 = setTimeout(() => setStep(2), 1500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);
  return (
    <section className="shell">
      <div className="searching">
        <div className="searching-row">
          <span style={{ display: "inline-flex", gap: 5 }}>
            <span className="shimmer-dot"></span>
            <span className="shimmer-dot"></span>
            <span className="shimmer-dot"></span>
          </span>
          <span className="searching-label">Aan het zoeken…</span>
        </div>
        <div className="searching-substeps">
          {["Doorzoekt Nederlanders.fr forum", "Leest Infofrankrijk-artikelen", "Stelt antwoord met bronnen samen"].map((s, i) => {
            const cls = i < step ? "is-done" : i === step ? "is-active" : "";
            return (
              <div key={i} className={`substep ${cls}`}>
                <span className="tick">{i < step ? "✓" : ""}</span>
                <span>{s}</span>
              </div>
            );
          })}
        </div>
        <div className="shimmer-lines">
          <div className="shimmer-line"></div>
          <div className="shimmer-line"></div>
          <div className="shimmer-line"></div>
          <div className="shimmer-line"></div>
        </div>
      </div>
    </section>
  );
}

/* ---------- bron-kaart (per-source presentation) ---------- */
function BronCard({ src }) {
  const isNLFR = !src.url.includes('infofrankrijk.com') && (src.url.includes('nederlanders.fr') || src.type === 'forum' || src.type === 'leestip');
  const badgeClass = src.type === 'if' ? 'is-if' : src.type === 'leestip' ? 'is-leestip' : 'is-forum';
  const badgeLabel = src.type === 'if' ? 'IF' : src.type === 'leestip' ? 'Leestip' : 'Forum';
  return (
    <div className={`bron-card ${src.type === 'if' ? 'is-if' : ''}`}>
      <span className={`bron-badge ${badgeClass}`}>{badgeLabel}</span>
      <a className="bron-titel" href={src.url} target="_blank" rel="noopener noreferrer">{src.titel}</a>
      {src.samenvatting && <div className="bron-samenvatting">{src.samenvatting}</div>}
      {(src.auteur || src.datum) && (
        <div className="bron-meta">
          {src.auteur && (
            isNLFR
              ? <a href={`https://www.nederlanders.fr/profile/${src.auteur}`} target="_blank" rel="noopener noreferrer">{src.auteur}</a>
              : <span>{src.auteur}</span>
          )}
          {src.auteur && src.datum && " · "}
          {src.datum && <span>{src.datum}</span>}
        </div>
      )}
      {/* Verrijking, compact onder auteur/datum: reactieaantal, "veel besproken",
         via-reactie en de datumwaarschuwing (vervangt het losse netwerk-blok). */}
      {((src.replyCount != null && src.replyCount > 0) || src.viaReactie || src.datumwaarschuwing) && (
        <div className="bron-submeta">
          {src.replyCount >= 5 && <span className="flag flag-besproken">Veel besproken</span>}
          {src.replyCount != null && src.replyCount > 0 && (
            <span className="submeta-count">{src.replyCount} reactie{src.replyCount !== 1 ? "s" : ""}</span>
          )}
          {src.viaReactie && <span className="flag flag-reactie">via reactie</span>}
          {src.datumwaarschuwing && (
            <span className="flag flag-gedateerd">
              Let op: mogelijk gedateerd{src.datumwaarschuwingTag ? ` (${src.datumwaarschuwingTag})` : ""}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- forumzoek-fallback (altijd zichtbaar, elke uitkomst) ---------- */
function NingSearchLink({ query, compact }) {
  const q = (query || "").trim();
  if (!q) return null;
  const href = NING_SEARCH_URL + encodeURIComponent(q);

  // Compacte variant (o.a. in de limit-state): zelfde stijl als de knoppen
  // ernaast — normale padding, pijl als klein teken, op één regel.
  if (compact) {
    return (
      <a className="btn-ghost ning-search-compact" href={href} target="_top" rel="noopener noreferrer">
        Alle forumresultaten <IconArrow />
      </a>
    );
  }

  return (
    <div className="ning-search-fallback" style={{ margin: "16px 0 0" }}>
      <a
        className="ning-search-btn"
        href={href}
        target="_top"
        rel="noopener noreferrer"
        style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          fontWeight: 600, fontSize: 13.5, color: "#fff",
          background: "#800000", padding: "10px 16px", borderRadius: 8,
          textDecoration: "none",
        }}
      >
        Alle forumresultaten voor '{q}' <IconArrow />
      </a>
    </div>
  );
}

/* ---------- ledenpoort (zachte poort, op de plek van de samenvatting) ---------- */
function LedenPoort() {
  return (
    <div className="ledenpoort">
      <p className="ledenpoort-text">
        De AI-samenvatting is een voordeel voor leden van Nederlanders.fr — lidmaatschap is gratis.
      </p>
      <a className="ledenpoort-btn" href={SIGNUP_URL} target="_top" rel="noopener noreferrer">
        Word gratis lid
      </a>
    </div>
  );
}

/* ---------- steunblok (alleen leden, onder de resultaten) ---------- */
function Steunblok() {
  return (
    <div className="steunblok">
      <p className="steunblok-text">
        Deze AI-zoek is gratis. Waardeer je hem? Steun met een donatie of neem een Infofrankrijk-abonnement.
      </p>
      <div className="steunblok-actions">
        <a
          className="steunblok-btn"
          href="https://www.nederlanders.fr/page/fundraising-en-donaties"
          target="_top"
          rel="noopener noreferrer"
        >
          Doneren
        </a>
        <a
          className="steunblok-btn steunblok-btn-ghost"
          href="https://infofrankrijk.com/abonnement/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Neem een abonnement
        </a>
      </div>
    </div>
  );
}

/* ---------- results ---------- */
function Results({ query, rubriek, narrative, sources, searchCount, cached, onReset, cafeClaude }) {
  const hasNothing = sources.length === 0;
  // Spaarstand: geen narrative → geen samenvatting, geen foutmelding.
  const narrativeText = narrative && narrative.trim() ? narrative.trim() : "";

  return (
    <section className="results shell">
      <div className="query-line">
        <h2 className="query-q">
          <span className="quote">“</span>{query}<span className="quote">”</span>
        </h2>
        <div className="query-meta">
          {rubriek && <span>Rubriek · <b>{rubriek}</b></span>}
          {searchCount > 0 && <span>{searchCount} bronzoekopdracht{searchCount !== 1 ? "en" : ""}</span>}
          {sources.length > 0 && <span>{sources.length} bron{sources.length !== 1 ? "nen" : ""}</span>}
        </div>
      </div>

      {/* Vaste, sobere uitlegtekst boven elke resultatenweergave. */}
      <p className="search-explain">{EXPLAIN_TEXT}</p>

      {hasNothing ? (
        <div className="bron-empty">
          We hebben geen dossiers, artikelen of forumbijdragen gevonden over dit onderwerp.
          Probeer een andere zoekterm of plaats je vraag zelf op het forum
          {cafeClaude && (
            <>
              , of stel hem aan{" "}
              <a href="https://cafeclaude.fr" target="_blank" rel="noopener noreferrer" style={{ color: "#800000", textDecoration: "underline" }}>
                Café Claude
              </a>
            </>
          )}.
          <div style={{ margin: "16px 0 0" }}>
            <NingSearchLink query={query} compact />
          </div>
        </div>
      ) : (
        <>
          {/* Ledenpoort: samenvatting alleen voor leden (lid=1); anders uitnodiging.
             Spaarstand: lid maar geen narrative → toon niets (geen foutmelding). */}
          {IS_LID
            ? (narrativeText && <p className="result-intro">{narrativeText}</p>)
            : <LedenPoort />}

          {sources.length > 0 && (
            <div className="bron-list">
              {sources.map((s, i) => <BronCard key={i} src={s} />)}
            </div>
          )}

          <div style={{ margin: "16px 0 0" }}>
            <NingSearchLink query={query} compact />
          </div>

          <div className="bron-disclaimer">
            <p className="disclaimer-fine">
              Forumbijdragen zijn persoonlijke ervaringen en niet door de redactie geverifieerd.
            </p>
            {cafeClaude && (
              <p className="disclaimer-cta">
                Voor een persoonlijk, geverifieerd antwoord op je vraag kun je terecht bij{" "}
                <a href="https://cafeclaude.fr" target="_blank" rel="noopener noreferrer">Café Claude</a>.
              </p>
            )}
          </div>
        </>
      )}

      {/* Steunblok: alleen voor ingelogde leden (lid=1). Niet-leden zien hierboven
         al de gratis-lid-uitnodiging (ledenpoort), dus daar geen steunblok. */}
      {IS_LID && <Steunblok />}

      <div className="forum-cta" style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 12, flexWrap: "wrap", margin: "16px 0 0", padding: "14px 16px",
        border: "1px solid rgba(128,0,0,0.25)", borderRadius: 8, background: "rgba(128,0,0,0.03)",
      }}>
        <div style={{ fontSize: 14, color: "#2a2a2a" }}>
          Weet je er meer van, of heb je dezelfde vraag?{" "}
          <strong>Plaats zelf een bericht op het forum.</strong>
        </div>
        <a
          href="https://www.nederlanders.fr/profiles/blog/new"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            whiteSpace: "nowrap", fontWeight: 600, fontSize: 13, color: "#fff",
            background: "#800000", padding: "8px 14px", borderRadius: 6, textDecoration: "none",
          }}
        >
          Bericht plaatsen →
        </a>
      </div>

      {/* Groot Café Claude-blok: alleen binnen een CC-kennisdomein. */}
      {cafeClaude && (
        <div className="cta">
          <span className="cta-icon">☕</span>
          <div className="cta-body">
            <div className="cta-title">Meer weten? Stel je vraag aan Café Claude</div>
            <div className="cta-sub">Persoonlijke AI-begeleiding voor Nederlanders in Frankrijk.</div>
          </div>
          <a className="cta-btn" href="https://cafeclaude.fr" target="_blank" rel="noopener noreferrer">
            Naar Café Claude <IconArrow />
          </a>
        </div>
      )}

      <div className="new-search">
        <button className="new-search-btn" onClick={onReset}>
          <IconArrowLeft /> Nieuwe zoekvraag
        </button>
      </div>

      {cached && (
        <div style={{ fontSize: 10, color: '#bbb', textAlign: 'center', marginTop: 8 }}>
          Resultaat uit cache · Vernieuwt binnen 7 dagen
        </div>
      )}
    </section>
  );
}

/* ---------- limit ---------- */
function LimitCard({ subscriber, lid, message, onReset, query, cafeClaude }) {
  // Drie doelgroepen: IF-abonnee (onbeperkt, 40/dag stille veiligheidsgrens),
  // lid (8/dag) en bezoeker (3/dag). Café Claude alleen binnen een CC-domein.
  return (
    <section className="shell">
      <div className="limit-card">
        <div className="limit-eyebrow">Dagelijkse limiet</div>
        <h2 className="limit-title">
          {subscriber
            ? <>Even <em>pauze</em></>
            : lid
              ? <>8 zoekopdrachten <em>gebruikt vandaag</em></>
              : <>3 gratis zoekopdrachten <em>op</em></>}
        </h2>
        <p className="limit-text">{message}</p>
        <div className="limit-actions">
          {/* Niet-leden: gratis lid worden voor 8/dag. */}
          {!subscriber && !lid && (
            <a className="btn-primary" href={SIGNUP_URL} target="_top" rel="noopener noreferrer">
              Word gratis lid voor 8 per dag <IconArrow />
            </a>
          )}
          {/* Leden: verwijzing naar het IF-abonnement — onbeperkt zoeken. */}
          {lid && (
            <a className="btn-primary" href="https://infofrankrijk.com/abonnement/" target="_blank" rel="noopener noreferrer">
              Onbeperkt zoeken met Infofrankrijk <IconArrow />
            </a>
          )}
          {/* Café Claude-optie alleen binnen een CC-domein. */}
          {cafeClaude && (
            <a className={subscriber ? "btn-primary" : "btn-ghost"} href="https://cafeclaude.fr" target="_blank" rel="noopener noreferrer">
              ☕ Café Claude
            </a>
          )}
          <button className="btn-ghost" onClick={onReset}>Nieuwe vraag</button>
          <NingSearchLink query={query} compact />
        </div>
      </div>
    </section>
  );
}

/* ---------- error ---------- */
function ErrorCard({ message, onReset, query }) {
  return (
    <section className="shell">
      <div className="limit-card">
        <div className="limit-eyebrow" style={{ color: "#8b3a3a" }}>Foutmelding</div>
        <h2 className="limit-title">Er ging iets mis</h2>
        <p className="limit-text">{message}</p>
        <div className="limit-actions">
          <button className="btn-primary" onClick={onReset}>Opnieuw proberen</button>
        </div>
        <NingSearchLink query={query} />
      </div>
    </section>
  );
}

/* ---------- footer ---------- */
function Footer() {
  return (
    <footer className="footer">
      <div className="shell footer-inner">
        <div className="footer-marks">
          <span>Nederlanders.fr</span>
          <span className="sep">·</span>
          <span>Infofrankrijk.com</span>
          <span className="sep">·</span>
          <span>Café Claude</span>
        </div>
        <div className="footer-fine">Onderdeel van Communities Abroad</div>
      </div>
    </footer>
  );
}

/* ---------- app ---------- */
export default function App() {
  const [query, setQuery] = useState("");
  const [rubriek, setRubriek] = useState("");
  const [rubrieken, setRubrieken] = useState([]);
  const [token, setToken] = useState("");
  const [isSubscriber, setIsSubscriber] = useState(false);
  const [state, setState] = useState("idle"); // idle | searching | results | limit | error
  const [response, setResponse] = useState("");
  const [sources, setSources] = useState([]);
  const [searchCount, setSearchCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [cached, setCached] = useState(false);
  const [cafeClaude, setCafeClaude] = useState(false);
  const [limitInfo, setLimitInfo] = useState(null);
  const [autoSearchDone, setAutoSearchDone] = useState(false);
  const inputRef = useRef(null);
  const appRef = useRef(null);

  // Hoogtemelding in embed-modus: laat het iframe op de NING-pagina meegroeien
  // met de inhoud. We meten uitsluitend het root-element (.app) via een
  // ResizeObserver — nooit de scrollhoogte van de body of iets viewport-
  // afhankelijks, om een terugkoppellus met de iframe-hoogte te vermijden —
  // en versturen alleen als de waarde afwijkt van de laatst gemelde.
  useEffect(() => {
    if (!IS_EMBED) return;
    const el = appRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let lastSent = -1;
    const report = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h !== lastSent) {
        lastSent = h;
        window.parent.postMessage({ nlfrZoekHeight: h }, "*");
      }
    };
    const ro = new ResizeObserver(report);
    ro.observe(el);
    report();
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");
    if (urlToken) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, urlToken);
      setToken(urlToken);
      setIsSubscriber(true);
    } else {
      const stored = sessionStorage.getItem(TOKEN_STORAGE_KEY);
      if (stored) {
        setToken(stored);
        setIsSubscriber(true);
      }
    }
    const urlQuery = params.get("q");
    if (urlQuery) setQuery(urlQuery);

    fetch("/api/rubrieken")
      .then(r => r.json())
      .then(d => setRubrieken(d.rubrieken || []))
      .catch(() => {});
  }, []);

  const handleSearch = async (searchQuery) => {
    const q = (searchQuery || query).trim();
    if (!q) return;

    setState("searching");
    setResponse("");
    setSources([]);
    setSearchCount(0);
    setErrorMsg("");
    setCached(false);
    setCafeClaude(false);
    setLimitInfo(null);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, token: token || undefined, rubriek: rubriek || undefined, lid: IS_LID ? 1 : undefined }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 429) {
        setLimitInfo({
          subscriber: !!data.subscriber,
          lid: !!data.lid,
          cafeClaude: !!data.cafeClaude,
          message: data.message || "Dagelijkse limiet bereikt.",
        });
        setIsSubscriber(!!data.subscriber);
        setState("limit");
        return;
      }

      if (!res.ok) throw new Error(data?.error || `API fout (${res.status})`);

      setSearchCount(data.searchCount || 0);
      setIsSubscriber(!!data.subscriber);
      setCached(!!data.cached);
      setCafeClaude(!!data.cafeClaude);
      setResponse(data.narrative || "");
      setSources(Array.isArray(data.sources) ? data.sources : []);
      setState("results");
    } catch (err) {
      setErrorMsg(err.message || "Er ging iets mis bij het zoeken.");
      setState("error");
    }
  };

  useEffect(() => {
    if (query && !autoSearchDone && state === "idle") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("q")) {
        setAutoSearchDone(true);
        handleSearch(query);
      }
    }
  }, [query]);

  const onReset = () => {
    setQuery("");
    setResponse("");
    setSources([]);
    setCached(false);
    setCafeClaude(false);
    setLimitInfo(null);
    setErrorMsg("");
    setState("idle");
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const pickExample = (ex) => {
    setQuery(ex);
    setTimeout(() => handleSearch(ex), 50);
  };

  const heroProps = {
    query, setQuery, rubriek, setRubriek, rubrieken,
    onSearch: () => handleSearch(),
    isSearching: state === "searching",
    inputRef,
  };

  return (
    <div ref={appRef} className={IS_EMBED ? "app is-embed" : "app"}>
      {!IS_EMBED && <Topbar subscriber={isSubscriber} />}

      {state === "idle" && (
        <>
          {!IS_EMBED && <Hero {...heroProps} />}
          <Examples onPick={pickExample} />
        </>
      )}

      {state === "searching" && (
        <>
          {!IS_EMBED && <Hero {...heroProps} />}
          <Searching />
        </>
      )}

      {state === "results" && (
        <>
          {!IS_EMBED && <Hero {...heroProps} />}
          <Results
            query={query}
            rubriek={rubriek}
            narrative={response}
            sources={sources}
            searchCount={searchCount}
            cached={cached}
            onReset={onReset}
            cafeClaude={cafeClaude}
          />
        </>
      )}

      {state === "limit" && limitInfo && (
        <>
          {!IS_EMBED && <Hero {...heroProps} />}
          <LimitCard
            subscriber={limitInfo.subscriber}
            lid={limitInfo.lid}
            message={limitInfo.message}
            onReset={onReset}
            query={query}
            cafeClaude={limitInfo.cafeClaude}
          />
        </>
      )}

      {state === "error" && (
        <>
          {!IS_EMBED && <Hero {...heroProps} />}
          <ErrorCard message={errorMsg} onReset={onReset} query={query} />
        </>
      )}

      {!IS_EMBED && <Footer />}
    </div>
  );
}
