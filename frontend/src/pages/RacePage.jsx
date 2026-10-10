import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Form,
  Modal,
  Row,
  Table,
} from "react-bootstrap";
import RaceMap, { runnerColor } from "../components/RaceMap.jsx";
import RaceSetup from "../components/RaceSetup.jsx";
import { raceRequest, raceDownload, miles, clock } from "../lib/race-api.js";

export default function RacePage() {
  const { id } = useParams();
  const [snapshot, setSnapshot] = useState(null),
    [error, setError] = useState(""),
    [pollError, setPollError] = useState(""),
    [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null),
    [replay, setReplay] = useState(null),
    [countdown, setCountdown] = useState(0);
  const [playing, setPlaying] = useState(false),
    [dropout, setDropout] = useState(""),
    [delay, setDelay] = useState(0),
    [jump, setJump] = useState("");
  const [edit, setEdit] = useState(null),
    [confirm, setConfirm] = useState(null),
    [correction, setCorrection] = useState(null);
  const lock = useRef(false),
    generation = useRef(0);
  const race = snapshot?.race;
  async function refresh(signal) {
    const version = generation.current;
    const data = await raceRequest(
      `races/${id}/${replay === null ? "" : `?at=${replay}`}`,
      undefined,
      signal,
    );
    if (!signal?.aborted && version === generation.current) {
      setSnapshot(data);
      setPollError("");
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    let timer;
    async function poll() {
      try {
        await refresh(controller.signal);
      } catch (e) {
        if (!controller.signal.aborted) setPollError(e.message);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 1500);
      }
    }
    poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [id, replay]);
  async function action(payload) {
    if (lock.current) return;
    setError("");
    lock.current = true;
    setBusy(true);
    generation.current++;
    try {
      await raceRequest(`races/${id}/action/`, payload);
      setConfirm(null);
      setCorrection(null);
      await refresh();
    } catch (e) {
      if (e.needsConfirmation)
        setConfirm({
          action: "start",
          countdown_s: countdown,
          acknowledge: true,
        });
      else setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function advance(seconds = 30) {
    if (lock.current) return;
    setError("");
    lock.current = true;
    setBusy(true);
    generation.current++;
    try {
      await raceRequest(`races/${id}/simulate/`, {
        seconds,
        dropout: dropout ? [dropout] : [],
        delay_s: Number(delay),
        jump_node: jump,
      });
      await refresh();
    } catch (e) {
      setError(e.message);
      setPlaying(false);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!playing || race?.state !== "running") return;
    const t = setInterval(() => advance(10), 1000);
    return () => clearInterval(t);
  }, [playing, race?.state, dropout, delay, jump, id]);
  if (!race)
    return (
      <>
        {error || pollError ? (
          <Alert variant="danger">{error || pollError}</Alert>
        ) : (
          <p>Loading race…</p>
        )}
      </>
    );
  const rows = snapshot.standings.map((r) => ({
    ...r,
    color_index: race.roster.findIndex((x) => x.node_id === r.node_id),
  }));
  const ready = snapshot.readiness.length ? snapshot.readiness : rows;
  const runner = rows.find((r) => r.node_id === selected);
  const draft = ["draft", "ready"].includes(race.state);
  const remaining = race.started_at
    ? Math.max(0, (new Date(race.started_at) - Date.now()) / 1000)
    : 0;
  const ended = ["finished", "archived"].includes(race.state);
  async function beginEdit() {
    try {
      setEdit(await raceRequest());
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <>
      <Link to="/races" className="back-link">
        ← Races
      </Link>
      <div className="page-heading">
        <div>
          <h1>{race.name}</h1>
          <div className="mt-2 d-flex gap-2">
            <Badge
              bg={race.mode === "simulation" ? "warning" : "success"}
              text={race.mode === "simulation" ? "dark" : undefined}
            >
              {race.mode === "simulation" ? "SIMULATION" : "Live receiver"}
            </Badge>
            <Badge bg="secondary" className="text-capitalize">
              {race.state}
            </Badge>
          </div>
        </div>
        <div className="race-clock">
          {remaining > 0 && race.mode === "live"
            ? `Starts in ${Math.ceil(remaining)}s`
            : clock(snapshot.view_s)}
        </div>
      </div>
      {error && <Alert variant="danger">{error}</Alert>}
      {pollError && <Alert variant="warning">{pollError}</Alert>}
      {race.course.warnings.map((w) => (
        <Alert key={w} variant="warning">
          {w}
        </Alert>
      ))}
      <Card className="mb-3">
        <Card.Body>
          <div className="d-flex flex-wrap justify-content-between gap-3 align-items-center">
            <div>
              <strong>{race.course.name}</strong>
              <div className="small text-secondary">
                {miles(race.course.length_m * race.settings.laps)} mi ·{" "}
                {race.settings.laps} lap{race.settings.laps === 1 ? "" : "s"}
              </div>
            </div>
            <div aria-live="polite">
              <strong>
                {race.mode === "simulation"
                  ? "Simulated data"
                  : `Receiver: ${snapshot.receiver.state}`}
              </strong>
              <div>
                {ready.filter((r) => r.heard_recently).length}/
                {race.roster.length} trackers heard ·{" "}
                {ready.filter((r) => r.gps_recently).length}/
                {race.roster.length} fresh GPS
              </div>
            </div>
            <div className="d-flex gap-2 flex-wrap">
              {draft && (
                <Button
                  variant="outline-secondary"
                  disabled={busy}
                  onClick={beginEdit}
                >
                  Edit setup
                </Button>
              )}
              {race.state === "draft" && (
                <Button
                  disabled={busy}
                  onClick={() => action({ action: "ready" })}
                >
                  Ready race
                </Button>
              )}
              {race.state === "ready" && (
                <>
                  <Form.Select
                    aria-label="Start countdown"
                    style={{ width: 145 }}
                    value={countdown}
                    onChange={(e) => setCountdown(Number(e.target.value))}
                    disabled={race.mode === "simulation"}
                  >
                    <option value={0}>Start now</option>
                    <option value={10}>10s countdown</option>
                    <option value={30}>30s countdown</option>
                  </Form.Select>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      action({ action: "start", countdown_s: countdown })
                    }
                  >
                    Start race
                  </Button>
                </>
              )}
              {race.state === "running" && (
                <Button
                  variant="outline-danger"
                  disabled={busy}
                  onClick={() => {
                    setPlaying(false);
                    setConfirm({ action: "finish" });
                  }}
                >
                  Finish race
                </Button>
              )}
              {race.state === "finished" && (
                <Button
                  variant="outline-secondary"
                  disabled={busy}
                  onClick={() => action({ action: "archive" })}
                >
                  Archive
                </Button>
              )}
              <Button
                variant="outline-secondary"
                onClick={() =>
                  raceDownload(
                    `races/${id}/export/`,
                    `xc-race-${id}.json`,
                  ).catch((e) => setError(e.message))
                }
              >
                Export race
              </Button>
            </div>
          </div>
        </Card.Body>
      </Card>
      {draft && (
        <Card className="mb-3">
          <Card.Header>
            <h2>Start readiness</h2>
          </Card.Header>
          <Table responsive className="mb-0">
            <thead>
              <tr>
                <th>Runner</th>
                <th>Node</th>
                <th>Radio</th>
                <th>GPS</th>
                <th>Start area</th>
                <th>Battery</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.readiness.map((r) => (
                <tr key={r.node_id}>
                  <td>{r.name}</td>
                  <td>{r.node_id}</td>
                  <td>{r.heard_recently ? "Heard" : "Not heard"}</td>
                  <td>{r.gps_recently ? "Fresh" : "Waiting"}</td>
                  <td>{r.near_start ? "At start" : "Not confirmed"}</td>
                  <td>
                    {r.battery_percent == null ? "—" : `${r.battery_percent}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {race.mode === "simulation" && race.state === "running" && (
        <Card className="mb-3">
          <Card.Body>
            <div className="d-flex flex-wrap gap-2 align-items-end">
              <Button
                disabled={busy && !playing}
                onClick={() => setPlaying((p) => !p)}
              >
                {playing ? "Pause simulation" : "Play simulation"}
              </Button>
              <Button
                variant="outline-primary"
                disabled={busy || playing}
                onClick={() => advance(30)}
              >
                Advance 30s
              </Button>
              <div>
                <Form.Label htmlFor="dropout">Missing packets</Form.Label>
                <Form.Select
                  id="dropout"
                  value={dropout}
                  onChange={(e) => setDropout(e.target.value)}
                >
                  <option value="">None</option>
                  {race.roster.map((r) => (
                    <option key={r.node_id} value={r.node_id}>
                      {r.name}
                    </option>
                  ))}
                </Form.Select>
              </div>
              <div>
                <Form.Label htmlFor="delay">Delay (s)</Form.Label>
                <Form.Control
                  id="delay"
                  style={{ width: 100 }}
                  type="number"
                  min={0}
                  max={300}
                  value={delay}
                  onChange={(e) => setDelay(e.target.value)}
                />
              </div>
              <div>
                <Form.Label htmlFor="jump">GPS jump</Form.Label>
                <Form.Select
                  id="jump"
                  value={jump}
                  onChange={(e) => setJump(e.target.value)}
                >
                  <option value="">None</option>
                  {race.roster.map((r) => (
                    <option key={r.node_id} value={r.node_id}>
                      {r.name}
                    </option>
                  ))}
                </Form.Select>
              </div>
            </div>
          </Card.Body>
        </Card>
      )}
      {ended && (
        <Card className="mb-3">
          <Card.Body>
            <Form.Label htmlFor="replay">
              Replay · {clock(snapshot.view_s)} / {clock(snapshot.elapsed_s)}
            </Form.Label>
            <Form.Range
              id="replay"
              min={0}
              max={snapshot.elapsed_s}
              step={1}
              value={replay ?? snapshot.elapsed_s}
              onChange={(e) => {
                generation.current++;
                setReplay(Number(e.target.value));
              }}
            />
            <Button
              size="sm"
              variant="outline-secondary"
              onClick={() => setReplay(null)}
            >
              Final results
            </Button>
          </Card.Body>
        </Card>
      )}
      <Row className="g-3">
        <Col xl={7}>
          <Card>
            <Card.Header>
              <h2>Course map</h2>
            </Card.Header>
            <RaceMap
              course={race.course}
              runners={rows}
              selected={selected}
              onSelect={setSelected}
            />
            <Card.Footer className="small text-secondary">
              Latest measured positions · Faded markers have stale GPS · Drag to
              pan
            </Card.Footer>
          </Card>
        </Col>
        <Col xl={5}>
          <Card>
            <Card.Header>
              <h2>Provisional leaderboard</h2>
            </Card.Header>
            <Table responsive hover className="race-leaderboard mb-0">
              <thead>
                <tr>
                  <th>Place</th>
                  <th>Runner</th>
                  <th>Progress</th>
                  <th>Gap</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.node_id}
                    className={selected === r.node_id ? "table-active" : ""}
                  >
                    <td>{r.place ?? "—"}</td>
                    <td>
                      <button
                        className="runner-link"
                        onClick={() => setSelected(r.node_id)}
                      >
                        <span
                          style={{ background: runnerColor(r.color_index) }}
                          className="runner-dot"
                        />
                        {r.bib} · {r.name}
                      </button>
                      <div className="small text-secondary">
                        {r.team || r.node_id}
                      </div>
                      <div
                        className={`small ${r.status === "Tracking" ? "text-success" : "text-secondary"}`}
                      >
                        {r.status}
                        {r.manual ? " · corrected" : ""}
                      </div>
                      <div className="small text-secondary">
                        {r.age_s == null
                          ? "No GPS"
                          : `${Math.round(r.age_s)}s since fix`}
                      </div>
                    </td>
                    <td>
                      {miles(r.progress_m)} mi
                      <div className="small text-secondary">
                        Lap {r.lap}/{race.settings.laps}
                      </div>
                      {r.finish_s !== null && (
                        <div className="small">
                          {clock(r.finish_s)}
                          {r.manual ? "" : " est."}
                        </div>
                      )}
                    </td>
                    <td>
                      {r.gap_m == null ? "—" : `${miles(r.gap_m)} mi`}
                      <div className="small text-secondary">
                        {r.gap_s == null ? "" : `~${clock(r.gap_s)}`}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Card.Footer className="small text-secondary">
              Rank uses last known course progress. GPS cannot settle close
              finishes.
            </Card.Footer>
          </Card>
        </Col>
      </Row>
      {runner && (
        <Card className="mt-3">
          <Card.Header className="d-flex justify-content-between">
            <h2>
              {runner.name} · {runner.node_id}
            </h2>
            {["running", "finished"].includes(race.state) &&
              replay === null && (
                <Button
                  size="sm"
                  variant="outline-secondary"
                  onClick={() =>
                    setCorrection({
                      node_id: runner.node_id,
                      distance_mi: (runner.progress_m || 0) / 1609.344,
                      finish_s: "",
                      reason: "",
                      dnf: false,
                    })
                  }
                >
                  Correct result
                </Button>
              )}
          </Card.Header>
          <Card.Body>
            <p>
              {miles(runner.remaining_m)} mi remaining ·{" "}
              {runner.rejected_updates} rejected or uncertain updates
            </p>
            <Table responsive>
              <thead>
                <tr>
                  <th>Split at (mi)</th>
                  <th>Elapsed</th>
                </tr>
              </thead>
              <tbody>
                {runner.splits.map((s, i) => (
                  <tr key={i}>
                    <td>{miles(s.distance_m)}</td>
                    <td>
                      {s.elapsed_s == null
                        ? "Uncertain"
                        : `~${clock(s.elapsed_s)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card.Body>
        </Card>
      )}
      {edit && (
        <RaceSetup
          catalog={edit}
          existing={race}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            refresh().catch((e) => setError(e.message));
          }}
        />
      )}
      <Modal
        show={Boolean(confirm)}
        onHide={() => !busy && setConfirm(null)}
        centered
      >
        <Modal.Header closeButton={!busy}>
          <Modal.Title>
            {confirm?.action === "start"
              ? "Start with missing trackers?"
              : "Finish this race?"}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {confirm?.action === "start"
            ? "Some trackers lack fresh GPS, are away from the start, or the receiver is disconnected. Their places will remain provisional."
            : "This stops race timing and opens results and replay. Receiver capture continues separately."}
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => setConfirm(null)}
          >
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => action(confirm)}>
            Confirm
          </Button>
        </Modal.Footer>
      </Modal>
      <Modal
        show={Boolean(correction)}
        onHide={() => !busy && setCorrection(null)}
        centered
      >
        <Modal.Header closeButton={!busy}>
          <Modal.Title>Correct runner result</Modal.Title>
        </Modal.Header>
        {correction && (
          <Form
            onSubmit={(e) => {
              e.preventDefault();
              action({ ...correction, action: "correct" });
            }}
          >
            <Modal.Body>
              <Form.Label htmlFor="correct-distance">
                Total course progress (mi, including laps)
              </Form.Label>
              <Form.Control
                id="correct-distance"
                type="number"
                step="any"
                min={0}
                max={(race.course.length_m * race.settings.laps) / 1609.344}
                value={correction.distance_mi}
                onChange={(e) =>
                  setCorrection((c) => ({ ...c, distance_mi: e.target.value }))
                }
              />
              <Form.Label htmlFor="correct-finish" className="mt-3">
                Official finish time (elapsed seconds, optional)
              </Form.Label>
              <Form.Control
                id="correct-finish"
                type="number"
                min={0}
                max={snapshot.elapsed_s}
                value={correction.finish_s}
                onChange={(e) =>
                  setCorrection((c) => ({ ...c, finish_s: e.target.value }))
                }
              />
              <Form.Check
                className="my-3"
                label="Did not finish (DNF)"
                checked={correction.dnf}
                onChange={(e) =>
                  setCorrection((c) => ({ ...c, dnf: e.target.checked }))
                }
              />
              <Form.Label htmlFor="correct-reason">Reason</Form.Label>
              <Form.Control
                id="correct-reason"
                required
                value={correction.reason}
                onChange={(e) =>
                  setCorrection((c) => ({ ...c, reason: e.target.value }))
                }
              />
            </Modal.Body>
            <Modal.Footer>
              <Button disabled={busy} type="submit">
                Save correction
              </Button>
            </Modal.Footer>
          </Form>
        )}
      </Modal>
    </>
  );
}
