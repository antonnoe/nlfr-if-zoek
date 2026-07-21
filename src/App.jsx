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
const IconExternal = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 17 17 7"></path><path d="M8 7h9v9"></path>
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
    </div>
  );
}

/* ---------- results ---------- */
function Results({ query, rubriek, narrative, sources, threads, searchCount, cached, onReset }) {
  const hasNothing = sources.length === 0 && threads.length === 0;
  const introText = narrative && narrative.trim()
    ? narrative.trim()
    : (sources.length > 0
        ? `Over "${query}" vonden we het volgende in het netwerk:`
        : '');

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

      {hasNothing ? (
        <div className="bron-empty">
          We hebben geen dossiers, artikelen of forumbijdragen gevonden over dit onderwerp.
          Probeer een andere zoekterm, plaats je vraag zelf op het forum, of stel hem aan{" "}
          <a href="https://cafeclaude.fr" target="_blank" rel="noopener noreferrer" style={{ color: "#800000", textDecoration: "underline" }}>
            Café Claude
          </a>.
        </div>
      ) : (
        <>
          {introText && <p className="result-intro">{introText}</p>}

          {sources.length > 0 && (
            <div className="bron-list">
              {sources.map((s, i) => <BronCard key={i} src={s} />)}
            </div>
          )}

          <div className="bron-disclaimer">
            <p className="disclaimer-fine">
              Forumbijdragen zijn persoonlijke ervaringen en niet door de redactie geverifieerd.
            </p>
            <p className="disclaimer-cta">
              Voor een persoonlijk, geverifieerd antwoord op je vraag kun je terecht bij{" "}
              <a href="https://cafeclaude.fr" target="_blank" rel="noopener noreferrer">Café Claude</a>.
            </p>
          </div>
        </>
      )}

      {threads.length > 0 && (
        <div className="sources">
          <div className="sources-head">
            <div className="sources-title">Gevonden in het netwerk</div>
            <div className="sources-count">{threads.length} gevonden</div>
          </div>
          <div className="source-list">
            {threads.map((t, i) => {
              const tagClass = t.type === "if" ? "tag-if" : t.type === "leestip" ? "tag-leestip" : "tag-forum";
              const tagLabel = t.type === "if" ? "Infofrankrijk" : t.type === "leestip" ? "Leestip" : "Forum NLFR";
              const dimmed = t.isQuestion && (!t.replyCount || t.replyCount === 0);
              return (
                <a key={i} className="source" href={t.url} target="_blank" rel="noopener noreferrer"
                   style={dimmed ? { opacity: 0.5 } : undefined}>
                  <span className="source-num">{i + 1}</span>
                  <div className="source-body">
                    <div className="source-kicker">
                      <span className={`tag ${tagClass}`}>{tagLabel}</span>
                    </div>
                    <div className="source-title">
                      {t.title}
                      {t.replyCount >= 5 && (
                        <span style={{
                          display: 'inline-block', fontSize: 9, fontWeight: 700,
                          color: '#800000', background: 'rgba(128,0,0,0.07)',
                          padding: '2px 6px', borderRadius: 3, marginLeft: 6,
                          verticalAlign: 'middle', textTransform: 'uppercase',
                          letterSpacing: '0.03em',
                        }}>Veel besproken</span>
                      )}
                    </div>
                    <div className="source-meta" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px' }}
                         onClick={e => e.preventDefault()}>
                      {(t.authorDisplay || t.author) && (
                        <a href={`https://www.nederlanders.fr/profile/${t.author || t.authorDisplay}`}
                           target="_blank" rel="noopener noreferrer"
                           style={{ color: '#888', textDecoration: 'none' }}
                           onMouseEnter={e => e.target.style.color = '#800000'}
                           onMouseLeave={e => e.target.style.color = '#888'}
                           onClick={e => e.stopPropagation()}>
                          {t.authorDisplay || t.author}
                        </a>
                      )}
                      {(t.authorDisplay || t.author) && t.date && <span> · </span>}
                      {t.date && <span>{t.date}</span>}
                      {t.views != null && <span> · {t.views}× bekeken</span>}
                      {t.replyCount != null && t.replyCount > 0 && (
                        <span> · {t.replyCount} reactie{t.replyCount !== 1 ? 's' : ''}</span>
                      )}
                    </div>
                  </div>
                  <span className="source-arrow"><IconExternal /></span>
                </a>
              );
            })}
          </div>
        </div>
      )}

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
function LimitCard({ subscriber, message, onReset }) {
  return (
    <section className="shell">
      <div className="limit-card">
        <div className="limit-eyebrow">Dagelijkse limiet</div>
        <h2 className="limit-title">
          {subscriber ? <>15 zoekopdrachten <em>gebruikt vandaag</em></> : <>6 gratis zoekopdrachten <em>op</em></>}
        </h2>
        <p className="limit-text">{message}</p>
        <div className="limit-actions">
          {!subscriber && (
            <a className="btn-primary" href="https://infofrankrijk.com/abonnement/" target="_blank" rel="noopener noreferrer">
              Word abonnee <IconArrow />
            </a>
          )}
          <a className={subscriber ? "btn-primary" : "btn-ghost"} href="https://cafeclaude.fr" target="_blank" rel="noopener noreferrer">
            ☕ Café Claude
          </a>
          <button className="btn-ghost" onClick={onReset}>Nieuwe vraag</button>
        </div>
      </div>
    </section>
  );
}

/* ---------- error ---------- */
function ErrorCard({ message, onReset }) {
  return (
    <section className="shell">
      <div className="limit-card">
        <div className="limit-eyebrow" style={{ color: "#8b3a3a" }}>Foutmelding</div>
        <h2 className="limit-title">Er ging iets mis</h2>
        <p className="limit-text">{message}</p>
        <div className="limit-actions">
          <button className="btn-primary" onClick={onReset}>Opnieuw proberen</button>
        </div>
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
  const [threads, setThreads] = useState([]);
  const [searchCount, setSearchCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [cached, setCached] = useState(false);
  const [limitInfo, setLimitInfo] = useState(null);
  const [autoSearchDone, setAutoSearchDone] = useState(false);
  const inputRef = useRef(null);

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
    setThreads([]);
    setSearchCount(0);
    setErrorMsg("");
    setCached(false);
    setLimitInfo(null);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, token: token || undefined, rubriek: rubriek || undefined }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 429) {
        setLimitInfo({
          subscriber: !!data.subscriber,
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
      setResponse(data.narrative || "");
      setSources(Array.isArray(data.sources) ? data.sources : []);
      setThreads(Array.isArray(data.threads) ? data.threads : []);
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
    setThreads([]);
    setCached(false);
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
    <div className={IS_EMBED ? "app is-embed" : "app"}>
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
            threads={threads}
            searchCount={searchCount}
            cached={cached}
            onReset={onReset}
          />
        </>
      )}

      {state === "limit" && limitInfo && (
        <>
          {!IS_EMBED && <Hero {...heroProps} />}
          <LimitCard
            subscriber={limitInfo.subscriber}
            message={limitInfo.message}
            onReset={onReset}
          />
        </>
      )}

      {state === "error" && (
        <>
          {!IS_EMBED && <Hero {...heroProps} />}
          <ErrorCard message={errorMsg} onReset={onReset} />
        </>
      )}

      {!IS_EMBED && <Footer />}
    </div>
  );
}
