import { useState } from "react";
import { Alert, Button, Form, Modal, Row, Col, Table } from "react-bootstrap";
import { raceRequest } from "../lib/race-api.js";

export default function RaceSetup({ catalog, existing, onClose, onSaved }) {
  const [form, setForm] = useState(
    existing
      ? {
          name: existing.name,
          course_id: existing.course_id,
          mode: existing.mode,
          laps: existing.settings.laps,
          interval_s: existing.settings.interval_s,
          tolerance_ft: Math.round(existing.settings.tolerance_m / 0.3048),
        }
      : {
          name: "",
          course_id: catalog.courses[0]?.id || "",
          mode: "simulation",
          laps: 1,
          interval_s: 5,
          tolerance_ft: 100,
        },
  );
  const [roster, setRoster] = useState(
    existing?.roster ||
      Array.from({ length: 3 }, (_, i) => ({
        name: `Runner ${i + 1}`,
        node_id: "",
        bib: String(i + 1),
        team: "",
        pace_s_mi: 420 + i * 20,
        start_offset_s: 0,
      })),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const field = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  function update(i, key, value) {
    setRoster((rows) =>
      rows.map((r, j) => (i === j ? { ...r, [key]: value } : r)),
    );
  }
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await raceRequest(
        existing ? `races/${existing.id}/action/` : "races/",
        { ...form, roster, action: "update" },
      );
      onSaved(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal show onHide={() => !busy && onClose()} size="xl" centered>
      <Form onSubmit={submit}>
        <Modal.Header closeButton={!busy}>
          <Modal.Title>{existing ? "Edit race" : "Create race"}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {error && <Alert variant="danger">{error}</Alert>}
          <Row className="g-3">
            <Col md={6}>
              <Form.Label htmlFor="race-name">Race name</Form.Label>
              <Form.Control
                id="race-name"
                required
                value={form.name}
                onChange={(e) => field("name", e.target.value)}
                maxLength={100}
              />
            </Col>
            <Col md={6}>
              <Form.Label htmlFor="race-course">Course</Form.Label>
              <Form.Select
                id="race-course"
                required
                value={form.course_id}
                onChange={(e) => field("course_id", Number(e.target.value))}
              >
                <option value="">Select a course</option>
                {catalog.courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Form.Select>
            </Col>
            <Col md={4}>
              <Form.Label htmlFor="race-mode">Data source</Form.Label>
              <Form.Select
                id="race-mode"
                value={form.mode}
                onChange={(e) => {
                  field("mode", e.target.value);
                  field("interval_s", e.target.value === "live" ? 30 : 5);
                }}
              >
                <option value="simulation">Simulation</option>
                <option value="live">Live receiver</option>
              </Form.Select>
            </Col>
            <Col md={4}>
              <Form.Label htmlFor="runner-count">Number of runners</Form.Label>
              <Form.Control
                id="runner-count"
                type="number"
                min={1}
                max={200}
                value={roster.length}
                onChange={(e) => {
                  const n = Math.max(1, Math.min(200, Number(e.target.value)));
                  setRoster((r) =>
                    Array.from(
                      { length: n },
                      (_, i) =>
                        r[i] || {
                          name: `Runner ${i + 1}`,
                          bib: String(i + 1),
                          node_id: "",
                          team: "",
                          pace_s_mi: 420 + i * 10,
                          start_offset_s: 0,
                        },
                    ),
                  );
                }}
              />
            </Col>
            <Col md={4}>
              <Form.Label htmlFor="race-laps">Laps</Form.Label>
              <Form.Control
                id="race-laps"
                type="number"
                min={1}
                max={50}
                required
                value={form.laps}
                onChange={(e) => field("laps", Number(e.target.value))}
              />
            </Col>
            <Col md={6}>
              <Form.Label htmlFor="race-interval">
                Expected update interval (seconds)
              </Form.Label>
              <Form.Control
                id="race-interval"
                type="number"
                min={1}
                max={600}
                required
                value={form.interval_s}
                onChange={(e) => field("interval_s", Number(e.target.value))}
              />
            </Col>
            <Col md={6}>
              <Form.Label htmlFor="race-tolerance">
                Course tolerance (ft)
              </Form.Label>
              <Form.Control
                id="race-tolerance"
                type="number"
                min={10}
                max={1000}
                required
                value={form.tolerance_ft}
                onChange={(e) => field("tolerance_ft", Number(e.target.value))}
              />
            </Col>
          </Row>
          <h2 className="mt-4 mb-3">Runner roster</h2>
          <datalist id="heard-nodes">
            {catalog.nodes.map((n) => (
              <option key={n.node_id} value={n.node_id}>
                {n.name}
              </option>
            ))}
          </datalist>
          <Table responsive className="mb-0">
            <thead>
              <tr>
                <th>Name</th>
                <th>Bib</th>
                <th>Team</th>
                {form.mode === "live" ? (
                  <th>Node ID (recent nodes suggested)</th>
                ) : (
                  <>
                    <th>Pace (seconds/mi)</th>
                    <th>Start offset (s)</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {roster.map((r, i) => (
                <tr key={i}>
                  {[
                    "name",
                    "bib",
                    "team",
                    ...(form.mode === "live"
                      ? ["node_id"]
                      : ["pace_s_mi", "start_offset_s"]),
                  ].map((key) => (
                    <td key={key}>
                      <Form.Control
                        aria-label={`${key} runner ${i + 1}`}
                        style={{
                          minWidth:
                            key === "name" || key === "node_id" ? 150 : 90,
                        }}
                        list={key === "node_id" ? "heard-nodes" : undefined}
                        type={
                          key.endsWith("_s") || key === "pace_s_mi"
                            ? "number"
                            : "text"
                        }
                        value={r[key]}
                        required={key !== "team"}
                        onChange={(e) => update(i, key, e.target.value)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
          {form.mode === "simulation" && (
            <p className="small text-secondary mt-2 mb-0">
              Simulated runners follow the selected recording’s route at the
              configured paces. No packets are sent over radio.
            </p>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !form.course_id}>
            {busy ? "Saving…" : "Save race"}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
