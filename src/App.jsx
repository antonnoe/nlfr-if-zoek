import { useState, useRef, useEffect } from "react";

export default function App() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("idle");
  const [response, setResponse] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [searchCount, setSearchCount] = useState(0);
  const [threads, setThreads] = useState([]);
  const [autoSearchDone, setAutoSearchDone] = useState(false);
  const outputRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
    const params = new URLSearchParams(window.location.search);
    const urlQuery = params.get("q");
    if (urlQuery) setQuery(urlQuery);
  }, []);

  const handleSearch = async (searchQuery) => {
    const q = (searchQuery || query).trim();
    if (!q) return;

    setStatus("searching");
    setResponse("");
    setErrorMsg("");
    setSearchCount(0);
    setThreads([]);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `API fout (${res.status})`);
      }

      const data = await res.json();
      setSearchCount(data.searchCount || 0);

      let fullText = data.narrative || "";

      if (data.truncated) {
        fullText += "\n\n*Dit antwoord is afgekapt. Probeer een specifiekere zoekvraag voor een vollediger resultaat.*";
      }

      if (!fullText.trim()) {
        setResponse("Geen resultaten gevonden. Probeer een andere zoekterm of stel je vraag direct aan [Café Claude](https://cafeclaude.fr).");
        setThreads([]);
      } else {
        setResponse(fullText);
        setThreads(data.threads || []);
      }
      setStatus("done");
    } catch (err) {
      setErrorMsg(err.message || "Er ging iets mis bij het zoeken.");
      setStatus("error");
    }
  };

  // Auto-search from URL param
  useEffect(() => {
    if (query && !autoSearchDone && status === "idle") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("q")) {
        setAutoSearchDone(true);
        handleSearch(query);
      }
    }
  }, [query]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [response]);

  const renderMarkdown = (text) => {
    if (!text) return null;
    const paragraphs = text.split(/\n\n+/);
    return paragraphs.map((p, i) => {
      const parts = [];
      const regex = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
      let lastIndex = 0;
      let match;
      let key = 0;
      const raw = p.replace(/\n/g, " ");

      while ((match = regex.exec(raw)) !== null) {
        if (match.index > lastIndex) {
          parts.push(<span key={key++}>{raw.slice(lastIndex, match.index)}</span>);
        }
        if (match[1] && match[2]) {
          parts.push(
            <a key={key++} href={match[2]} target="_blank" rel="noopener noreferrer"
              style={{ color: "#800000", textDecoration: "underline", textDecorationColor: "rgba(128,0,0,0.3)", textUnderlineOffset: "2px" }}>
              {match[1]}
            </a>
          );
        } else if (match[3]) {
          parts.push(<strong key={key++} style={{ fontWeight: 600 }}>{match[3]}</strong>);
        } else if (match[4]) {
          parts.push(<em key={key++}>{match[4]}</em>);
        }
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < raw.length) {
        parts.push(<span key={key++}>{raw.slice(lastIndex)}</span>);
      }
      return (
        <p key={i} style={{ margin: "0 0 18px 0", lineHeight: "1.8" }}>{parts}</p>
      );
    });
  };

  const examples = [
    "Carte vitale aanvragen",
    "Auto invoeren Frankrijk",
    "Belastingaangifte niet-resident",
    "Micro-entreprise starten",
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#faf8f6", fontFamily: "'Mulish', 'Segoe UI', sans-serif", color: "#2a2a2a" }}>
      {/* Header */}
      <header style={{ background: "#800000", padding: "20px 24px 18px", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <div style={{ fontFamily: "'Poppins', sans-serif", color: "#fff", fontSize: 18, fontWeight: 700, letterSpacing: "0.01em", marginBottom: 4 }}>
            Zoek in NLFR &amp; Infofrankrijk
          </div>
          <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>
            AI-zoekassistent · nederlanders.fr · infofrankrijk.com
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <input ref={inputRef} type="text" value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Stel een vraag over het leven in Frankrijk..."
              disabled={status === "searching"}
              style={{ flex: 1, padding: "10px 14px", border: "2px solid rgba(255,255,255,0.2)", borderRadius: 6, background: "rgba(255,255,255,0.12)", color: "#fff", fontSize: 14, fontFamily: "inherit", outline: "none" }}
            />
            <button onClick={() => handleSearch()}
              disabled={status === "searching" || !query.trim()}
              style={{ padding: "10px 20px", background: status === "searching" ? "rgba(255,255,255,0.15)" : "#fff", color: status === "searching" ? "rgba(255,255,255,0.5)" : "#800000", border: "none", borderRadius: 6, fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 13, cursor: status === "searching" ? "wait" : "pointer", whiteSpace: "nowrap" }}>
              {status === "searching" ? "Zoeken..." : "Zoek"}
            </button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 720, margin: "0 auto", padding: "24px 20px 60px" }}>
        {/* Idle */}
        {status === "idle" && (
          <div>
            <p style={{ color: "#888", fontSize: 13, marginBottom: 16, fontStyle: "italic" }}>
              Doorzoekt forumbijdragen en artikelen van het netwerk en geeft een verhalend antwoord met bronvermelding.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {examples.map((ex) => (
                <button key={ex}
                  onClick={() => { setQuery(ex); setTimeout(() => handleSearch(ex), 50); }}
                  style={{ padding: "7px 14px", background: "rgba(128,0,0,0.06)", border: "1px solid rgba(128,0,0,0.15)", borderRadius: 20, color: "#800000", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Searching */}
        {status === "searching" && (
          <div style={{ textAlign: "center", padding: "48px 0" }}>
            <div style={{ display: "inline-block", width: 32, height: 32, border: "3px solid rgba(128,0,0,0.15)", borderTopColor: "#800000", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <p style={{ color: "#800000", fontSize: 13, marginTop: 14 }}>
              Doorzoekt nederlanders.fr en infofrankrijk.com...
            </p>
          </div>
        )}

        {/* Results */}
        {(status === "done" || status === "error") && (
          <div>
            <div style={{ background: "rgba(128,0,0,0.04)", borderLeft: "3px solid #800000", padding: "10px 14px", marginBottom: 20, borderRadius: "0 4px 4px 0" }}>
              <span style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 2 }}>Zoekvraag</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: "#800000" }}>{query}</span>
              {searchCount > 0 && (
                <span style={{ fontSize: 11, color: "#888", marginLeft: 12, fontWeight: 400 }}>
                  · {searchCount} bronzoekopdracht{searchCount !== 1 ? "en" : ""} uitgevoerd
                </span>
              )}
            </div>

            {status === "error" && (
              <div style={{ background: "#fff5f5", border: "1px solid #e8c4c4", borderRadius: 6, padding: "14px 16px", fontSize: 13, color: "#8b3a3a" }}>
                {errorMsg}
              </div>
            )}

            {status === "done" && (
              <div ref={outputRef} style={{ fontSize: 14, lineHeight: 1.8, color: "#2a2a2a" }}>
                {renderMarkdown(response)}
              </div>
            )}

            {/* Threads */}
            {status === "done" && threads.length > 0 && (
              <div style={{ marginTop: 24, padding: "16px 18px", background: "#fff", border: "1px solid rgba(128,0,0,0.10)", borderRadius: 6 }}>
                <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 13, color: "#800000", marginBottom: 12 }}>
                  Recente discussies
                </div>
                {threads.map((t, i) => (
                  <div key={i} style={{ padding: "8px 0", borderTop: i > 0 ? "1px solid rgba(0,0,0,0.05)" : "none", display: "flex", flexDirection: "column", gap: 2 }}>
                    <a href={t.url} target="_blank" rel="noopener noreferrer"
                      style={{ color: "#800000", textDecoration: "none", fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>
                      {t.title}
                    </a>
                    <div style={{ fontSize: 11, color: "#888" }}>
                      {t.author && (
                        <a href={`https://www.nederlanders.fr/profile/${t.author}`} target="_blank" rel="noopener noreferrer"
                          style={{ color: "#888", textDecoration: "none" }}>
                          {t.author}
                        </a>
                      )}
                      {t.author && t.date && " · "}
                      {t.date && <span>{t.date}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* CC Funnel */}
            {status === "done" && (
              <div style={{ marginTop: 28, padding: "14px 16px", background: "rgba(128,0,0,0.04)", border: "1px solid rgba(128,0,0,0.12)", borderRadius: 6, display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 22 }}>☕</span>
                <div>
                  <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 13, color: "#800000", marginBottom: 2 }}>
                    Meer weten? Stel je vraag aan Café Claude
                  </div>
                  <div style={{ fontSize: 12, color: "#666" }}>
                    Persoonlijke AI-begeleiding voor Nederlanders in Frankrijk
                  </div>
                </div>
                <a href="https://cafeclaude.fr" target="_blank" rel="noopener noreferrer"
                  style={{ marginLeft: "auto", padding: "7px 16px", background: "#800000", color: "#fff", borderRadius: 4, fontSize: 12, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap", fontFamily: "'Poppins', sans-serif" }}>
                  Ga naar CC
                </a>
              </div>
            )}

            <div style={{ textAlign: "center", marginTop: 24 }}>
              <button
                onClick={() => { setQuery(""); setResponse(""); setThreads([]); setStatus("idle"); setTimeout(() => inputRef.current?.focus(), 100); }}
                style={{ padding: "8px 20px", background: "transparent", border: "1px solid rgba(128,0,0,0.25)", borderRadius: 4, color: "#800000", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>
                Nieuwe zoekvraag
              </button>
            </div>
          </div>
        )}
      </main>

      <footer style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#faf8f6", borderTop: "1px solid rgba(128,0,0,0.08)", padding: "8px 20px", textAlign: "center", fontSize: 11, color: "#aaa" }}>
        Nederlanders.fr · Infofrankrijk.com · Communities Abroad
      </footer>
    </div>
  );
}
