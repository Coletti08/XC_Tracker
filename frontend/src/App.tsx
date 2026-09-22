import { useEffect, useState } from "react";

type Status = "checking" | "connected" | "offline";

export default function App() {
  const [status, setStatus] = useState<Status>("checking");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 5000);

    async function checkConnection() {
      try {
        const response = await fetch("/api/health/", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Backend unavailable");
        const data = await response.json();
        if (data.status !== "ok") throw new Error("Unexpected response");
        if (active) setStatus("connected");
      } catch {
        if (active) setStatus("offline");
      } finally {
        window.clearTimeout(timeout);
      }
    }
    void checkConnection();
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);

  const messages = {
    checking: "Checking backend…",
    connected: "Backend connected",
    offline: "Backend unavailable",
  };

  return (
    <div className="shell">
      <header>
        <a className="brand" href="/" aria-label="XC Tracker home">
          <span className="mark" aria-hidden="true">XC</span>
          <span>XC Tracker</span>
        </a>
        <span className="badge">Local development</span>
      </header>
      <main>
        <p className="eyebrow">Your starting line</p>
        <h1>Ready to build.</h1>
        <p className="intro">A simple starting point for your cross-country race tracker.</p>
        <section className="connection" aria-labelledby="connection-title">
          <div>
            <h2 id="connection-title">App connection</h2>
            <p className={`status ${status}`} role="status" aria-live="polite">
              <span className="dot" aria-hidden="true" />
              {messages[status]}
            </p>
            <p className="detail">
              {status === "offline"
                ? "Check the launcher terminal, then try again."
                : "This page checks that the frontend can reach the backend."}
            </p>
          </div>
          <button
            disabled={status === "checking"}
            onClick={() => {
              setStatus("checking");
              setAttempt((value) => value + 1);
            }}
          >
            {status === "checking" ? "Checking…" : "Check connection"}
          </button>
        </section>
      </main>
      <footer>XC Tracker <span aria-hidden="true">/</span> Development starter</footer>
    </div>
  );
}

