import { useEffect, useRef, useState } from "react";
import { RoutePlot, SpeedPlot } from "./TrackPlots";
import { duration, speed, utc, type Recording } from "./types";

type Status = "checking" | "connected" | "offline";
const MAX_RECORDINGS = 8;
const PAGE_SIZE = 50;

function UploadIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function RecordingView({ recording, rename }: { recording: Recording; rename: (name: string) => void }) {
  const [selected, setSelected] = useState(0);
  const [page, setPage] = useState(0);
  const { summary, points } = recording;
  const point = points[selected];
  const currentSpeed = speed(point);
  const pageCount = Math.ceil(points.length / PAGE_SIZE);
  const chooseSample = (index: number) => {
    setSelected(index);
    setPage(Math.floor(index / PAGE_SIZE));
  };
  const metrics = [
    ["GPS distance", points.length > 1 ? `${(summary.distance_m / 1000).toFixed(2)}` : "—", "km"],
    ["Elapsed time", points.length > 1 ? duration(summary.duration_s) : "—", ""],
    ["Overall pace", summary.average_pace_s_km === null ? "—" : duration(summary.average_pace_s_km), "/km"],
    ["GPS samples", summary.sample_count.toLocaleString(), ""],
  ];
  return <div className="recording-view">
    <div className="recording-heading">
      <div className="recording-name">
        <label className="sr-only" htmlFor="recording-name">Recording name</label>
        <input id="recording-name" value={recording.name} onChange={(event) => rename(event.target.value)} maxLength={80} onBlur={() => { if (!recording.name.trim()) rename(recording.filename); }} />
        <p>{summary.started_at ? utc(summary.started_at) : "Relative time · measured from the first GPS sample"}</p>
      </div>
      <span className="badge">{recording.demo ? "Simulated sample" : "Imported CSV"}</span>
    </div>
    <div className="metrics">
      {metrics.map(([label, value, unit]) => <div className="metric" key={label}>
        <span>{label}</span><p>{value} <small>{unit}</small></p>
      </div>)}
    </div>
    {recording.warnings.length > 0 && <div className="notice" role="status">
      <strong>Import notes</strong>
      <ul>{recording.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
    </div>}
    <section className="panel route-panel" aria-labelledby="route-title">
      <div className="panel-heading"><h2 id="route-title">Recorded route</h2><span className="legend">○ Start <span className="finish-key">■ Finish</span> ● Selected</span></div>
      <RoutePlot points={points} selected={selected} />
      <div className="scrubber">
        <div className="scrubber-heading"><label htmlFor="sample-slider">Explore samples</label><span>{duration(point.elapsed_s)} <span className="muted">/ {duration(summary.duration_s)}</span></span></div>
        <input id="sample-slider" type="range" min="0" max={points.length - 1} value={selected} disabled={points.length < 2} onChange={(event) => chooseSample(Number(event.target.value))} aria-valuetext={`Sample ${selected + 1}, ${duration(point.elapsed_s)} elapsed`} />
        <div className="sample-readout">
          <span><small>Position</small><strong>{point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}</strong></span>
          <span><small>Speed</small><strong>{currentSpeed === null ? "—" : `${currentSpeed.toFixed(2)} m/s`}</strong></span>
          <span><small>Reported accuracy</small><strong>{point.accuracy_m === null ? "—" : `${point.accuracy_m.toFixed(1)} m`}</strong></span>
          <span><small>Sample</small><strong>{(selected + 1).toLocaleString()} of {points.length.toLocaleString()}</strong></span>
        </div>
      </div>
    </section>
    <section className="panel" aria-labelledby="speed-title">
      <div className="panel-heading"><h2 id="speed-title">Speed over time</h2><span className="muted">m/s</span></div>
      <SpeedPlot points={points} selected={selected} />
      <p className="panel-note">Phone speed when available; otherwise estimated between consecutive fixes.</p>
    </section>
    <section className="panel" aria-labelledby="samples-title">
      <div className="panel-heading"><h2 id="samples-title">GPS samples</h2><span className="muted">Select a sample to inspect it</span></div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="GPS sample table">
        <table>
          <thead><tr><th>Sample</th><th>{recording.time_basis === "utc" ? "Time (UTC)" : "Elapsed"}</th><th>Latitude</th><th>Longitude</th><th>Speed · m/s</th><th>Accuracy · m</th></tr></thead>
          <tbody>{points.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((sample, index) => {
            const actual = page * PAGE_SIZE + index;
            const sampleSpeed = speed(sample);
            return <tr key={actual} className={actual === selected ? "selected-row" : ""}>
              <td><button className="sample-button" aria-label={`Select sample ${actual + 1}`} aria-pressed={actual === selected} onClick={() => chooseSample(actual)}>#{actual + 1}</button></td>
              <td title={sample.timestamp ?? undefined}>{sample.timestamp ? sample.timestamp.slice(11, 23) : `${sample.elapsed_s.toFixed(3)} s`}</td>
              <td>{sample.latitude.toFixed(6)}</td><td>{sample.longitude.toFixed(6)}</td>
              <td>{sampleSpeed?.toFixed(2) ?? "—"}{sample.speed_m_s === null && sampleSpeed !== null ? "*" : ""}</td>
              <td>{sample.accuracy_m?.toFixed(1) ?? "—"}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <div className="pagination"><span>Page {page + 1} of {pageCount} <span className="muted">· * estimated speed</span></span><div>
        <button className="secondary compact" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
        <button className="secondary compact" disabled={page + 1 === pageCount} onClick={() => setPage(page + 1)}>Next</button>
      </div></div>
    </section>
    <p className="data-note">GPS distance is estimated from consecutive fixes and can be inflated by drift. Pace uses total elapsed time, including stops.
      {summary.median_accuracy_m !== null && ` Median reported accuracy: ${summary.median_accuracy_m.toFixed(1)} m.`}
      {summary.median_interval_s !== null && ` Typical sample interval: ${summary.median_interval_s.toFixed(2)} s.`}
    </p>
  </div>;
}

export default function App() {
  const [status, setStatus] = useState<Status>("checking");
  const [attempt, setAttempt] = useState(0);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [activeId, setActiveId] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const importLock = useRef(false);
  const active = recordings.find((recording) => recording.id === activeId) ?? recordings[0];

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    fetch("/api/health/", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok || (await response.json()).status !== "ok") throw new Error();
        if (mounted) setStatus("connected");
      }).catch(() => { if (mounted) setStatus("offline"); })
      .finally(() => window.clearTimeout(timeout));
    return () => { mounted = false; controller.abort(); window.clearTimeout(timeout); };
  }, [attempt]);

  async function importFiles(files: File[], demo = false) {
    if (importLock.current || files.length === 0) return;
    importLock.current = true;
    setBusy(true);
    setErrors([]);
    setDragging(false);
    const imported: Recording[] = [];
    const failures: string[] = [];
    const capacity = MAX_RECORDINGS - recordings.length;
    if (files.length > capacity) failures.push(`Keep up to ${MAX_RECORDINGS} recordings in this tab. Remove one to import more.`);
    try {
      for (const file of files.slice(0, capacity)) {
        if (!file.name.toLowerCase().endsWith(".csv")) { failures.push(`${file.name}: unzip the export and choose Location.csv.`); continue; }
        if (file.size > 10 * 1024 * 1024) { failures.push(`${file.name}: maximum file size is 10 MB.`); continue; }
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 30000);
        try {
          const health = await fetch("/api/health/", { signal: controller.signal, cache: "no-store" });
          if (!health.ok) throw new Error("Backend unavailable. Check the launcher terminal.");
          const { csrf_token } = await health.json();
          setStatus("connected");
          const body = new FormData();
          body.append("file", file);
          const response = await fetch("/api/recordings/import/", {
            method: "POST", body, headers: { "X-CSRFToken": csrf_token }, signal: controller.signal,
          });
          const data = await response.json().catch(() => ({ error: `Import failed (${response.status}). Refresh the page and try again.` }));
          if (!response.ok) throw new Error(data.error);
          const name = demo ? "Sample loop" : /^location\.csv$/i.test(file.name) ? `Recording ${recordings.length + imported.length + 1}` : file.name.replace(/\.csv$/i, "");
          imported.push({ ...data, id: crypto.randomUUID(), name, demo });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Import failed.";
          failures.push(`${file.name}: ${message === "Failed to fetch" || (error instanceof Error && error.name === "AbortError") ? "Could not reach the backend in time. Check the launcher and try again." : message}`);
        } finally {
          window.clearTimeout(timeout);
        }
      }
      if (imported.length) {
        setRecordings((previous) => [...previous, ...imported]);
        setActiveId(imported[0].id);
      }
      setErrors(failures);
    } finally { importLock.current = false; setBusy(false); }
  }

  async function loadSample() {
    try {
      const response = await fetch("/samples/sample-location.csv");
      if (!response.ok) throw new Error();
      await importFiles([new File([await response.text()], "sample-location.csv", { type: "text/csv" })], true);
    } catch { setErrors(["The sample could not be loaded. Try importing your own Location.csv."]); }
  }

  return <div className="shell">
    <header>
      <a className="brand" href="/" aria-label="XC Tracker home"><span className="mark" aria-hidden="true">XC</span><span>XC Tracker</span></a>
      <div className="header-actions">
        <button className={`connection-status ${status}`} title="Check backend connection" disabled={status === "checking"} onClick={() => { setStatus("checking"); setAttempt((value) => value + 1); }}>
          <span className="dot" aria-hidden="true" />{status === "connected" ? "Backend connected" : status === "checking" ? "Connecting…" : "Backend unavailable · retry"}
        </button>
        <button disabled={busy} onClick={() => input.current?.click()}><UploadIcon />Import CSV</button>
      </div>
    </header>
    <main>
      <div className="page-heading"><p className="eyebrow">Recording explorer</p><h1>See your run.</h1><p className="intro">Import a GPS recording and explore every sample.</p></div>
      <input ref={input} className="sr-only" type="file" accept=".csv,text/csv" multiple aria-label="Import CSV files" disabled={busy} onChange={(event) => { void importFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
      {errors.length > 0 && <div className="notice error" role="alert"><strong>Couldn’t import everything</strong><ul>{errors.map((error, index) => <li key={index}>{error}</li>)}</ul></div>}
      {busy && <p className="import-status" role="status">Reading your recording…</p>}
      <div className="workspace">
        <aside>
          <button className={`dropzone ${dragging ? "dragging" : ""}`} disabled={busy} onClick={() => input.current?.click()}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); if (!busy) void importFiles(Array.from(event.dataTransfer.files)); }}>
            <span className="upload-symbol"><UploadIcon /></span><strong>Drop your CSV here</strong><span>or click to browse</span><small>Up to 10 MB · 20,000 rows</small>
          </button>
          <p className="import-hint">Using Sensor Logger? Unzip the export, then choose <strong>Location.csv</strong>.</p>
          <button className="text-button" disabled={busy || recordings.length >= MAX_RECORDINGS} onClick={() => void loadSample()}>Try a sample recording <span aria-hidden="true">↗</span></button>
          <div className="sidebar-heading"><h2>Recordings</h2><span>{recordings.length}/{MAX_RECORDINGS}</span></div>
          {recordings.length === 0 ? <p className="sidebar-empty">Your imported runs will appear here.</p> : <ul className="recording-list">
            {recordings.map((recording) => <li key={recording.id} className={active?.id === recording.id ? "active" : ""}>
              <button className="recording-select" aria-pressed={active?.id === recording.id} onClick={() => setActiveId(recording.id)}>
                <strong>{recording.name || "Untitled recording"}</strong><span>{recording.summary.sample_count.toLocaleString()} samples · {duration(recording.summary.duration_s)}</span>
              </button>
              <button className="remove-button" disabled={busy} onClick={() => setRecordings((previous) => previous.filter((item) => item.id !== recording.id))} aria-label={`Remove ${recording.name}`}>×</button>
            </li>)}
          </ul>}
          <p className="session-note">Recordings stay in this tab. Refreshing clears them; your original files are untouched.</p>
        </aside>
        {active ? <RecordingView key={active.id} recording={active} rename={(name) => setRecordings((previous) => previous.map((recording) => recording.id === active.id ? { ...recording, name } : recording))} /> : <section className="empty-state">
          <svg width="240" height="150" viewBox="0 0 240 150" fill="none" aria-hidden="true"><path d="M43 104C15 76 69 30 117 39S217 25 207 80 167 100 144 113 89 127 77 91 169 50 176 82" stroke="#dbe4d6" strokeWidth="14" strokeLinecap="round" /><path d="M43 104C15 76 69 30 117 39S217 25 207 80 167 100 144 113 89 127 77 91 169 50 176 82" stroke="#7f9c75" strokeWidth="2" strokeDasharray="5 6" /><circle cx="43" cy="104" r="7" fill="#163e32" /><circle cx="176" cy="82" r="7" fill="#a16639" /></svg>
          <h2>Your route, brought to life.</h2><p>Load a location CSV to see its route, distance, speed, and GPS accuracy.</p><button className="secondary" disabled={busy} onClick={() => input.current?.click()}>Choose a recording</button>
          <span>Have no data yet? Try the simulated sample.</span>
        </section>}
      </div>
    </main>
    <footer><span>XC Tracker <span className="footer-divider">/</span> Local development</span><span>Route previews work without map downloads.</span></footer>
  </div>;
}
