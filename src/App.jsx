import { useState, useEffect, useRef } from "react";

const TOKEN_STORAGE_KEY = "nlfr_if_zoek_token";

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

/* ---------- markdown renderer (inline links, bold, italic) ---------- */
function renderMd(raw) {
  if (!raw) return null;
  const parts = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0, m, key = 0;
  const text = raw.replace(/\n/g, " ");
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={key++}>{text.slice(last, m.index)}</span>);
    if (m[1] && m[2]) {
      parts.push(<a key={key++} href={m[2]} target="_blank" rel="noopener noreferrer">{m[1]}</a>);
    } else if (m[3]) {
      parts.push(<strong key={key++}>{m[3]}</strong>);
    } else if (m[4]) {
      parts.push(<em key={key++}>{m[4]}</em>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<span key={key++}>{text.slice(last)}</span>);
  return parts;
}

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
    const t1 = setTimeout(() => setStep(1), 1800);
    const t2 = setTimeout(() => setStep(2), 4200);
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

/* ---------- results ---------- */
function Results({ query, rubriek, response, threads, searchCount, onReset }) {
  const paragraphs = (response || "").split(/\n\n+/).filter(p => p.trim());

  return (
    <section className="results shell">
      <div className="query-line">
        <h2 className="query-q">
          <span className="quote">“</span>{query}<span className="quote">”</span>
        </h2>
        <div className="query-meta">
          {rubriek && <span>Rubriek · <b>{rubriek}</b></span>}
          {searchCount > 0 && <span>{searchCount} bronzoekopdracht{searchCount !== 1 ? "en" : ""}</span>}
          {threads.length > 0 && <span>{threads.length} bron{threads.length !== 1 ? "nen" : ""}</span>}
        </div>
      </div>

      <div className="answer">
        {paragraphs.map((p, i) => {
          const isLead = i === 0;
          return isLead
            ? <p key={i} className="lead-first">{renderMd(p)}</p>
            : <p key={i}>{renderMd(p)}</p>;
        })}
      </div>

      {threads.length > 0 && (
        <div className="sources">
          <div className="sources-head">
            <div className="sources-title">Bronnen</div>
            <div className="sources-count">{threads.length} gevonden</div>
          </div>
          <div className="source-list">
            {threads.map((t, i) => {
              const tagClass = t.type === "if" ? "tag-if" : t.type === "leestip" ? "tag-leestip" : "tag-forum";
              const tagLabel = t.type === "if" ? "Infofrankrijk" : t.type === "leestip" ? "Leestip" : "Forum NLFR";
              return (
                <a key={i} className="source" href={t.url} target="_blank" rel="noopener noreferrer">
                  <span className="source-num">{i + 1}</span>
                  <div className="source-body">
                    <div className="source-kicker">
                      <span className={`tag ${tagClass}`}>{tagLabel}</span>
                    </div>
                    <div className="source-title">{t.title}</div>
                    {(t.author || t.date) && (
                      <div className="source-meta">
                        {t.author && <span>{t.author}</span>}
                        {t.author && t.date && " · "}
                        {t.date && <span>{t.date}</span>}
                      </div>
                    )}
                  </div>
                  <span className="source-arrow"><IconExternal /></span>
                </a>
              );
            })}
          </div>
        </div>
      )}

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
  const [threads, setThreads] = useState([]);
  const [searchCount, setSearchCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
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
    setThreads([]);
    setSearchCount(0);
    setErrorMsg("");
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
      let fullText = data.narrative || "";
      if (data.truncated) {
        fullText += "\n\n*Dit antwoord is afgekapt. Probeer een specifiekere zoekvraag.*";
      }
      if (!fullText.trim()) {
        setResponse("Geen resultaten gevonden. Probeer een andere zoekterm of stel je vraag direct aan [Café Claude](https://cafeclaude.fr).");
        setThreads([]);
      } else {
        setResponse(fullText);
        setThreads(data.threads || []);
      }
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
    setThreads([]);
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
    <div className="app">
      <Topbar subscriber={isSubscriber} />

      {state === "idle" && (
        <>
          <Hero {...heroProps} />
          <Examples onPick={pickExample} />
        </>
      )}

      {state === "searching" && (
        <>
          <Hero {...heroProps} />
          <Searching />
        </>
      )}

      {state === "results" && (
        <>
          <Hero {...heroProps} />
          <Results
            query={query}
            rubriek={rubriek}
            response={response}
            threads={threads}
            searchCount={searchCount}
            onReset={onReset}
          />
        </>
      )}

      {state === "limit" && limitInfo && (
        <>
          <Hero {...heroProps} />
          <LimitCard
            subscriber={limitInfo.subscriber}
            message={limitInfo.message}
            onReset={onReset}
          />
        </>
      )}

      {state === "error" && (
        <>
          <Hero {...heroProps} />
          <ErrorCard message={errorMsg} onReset={onReset} />
        </>
      )}

      <Footer />
    </div>
  );
}
