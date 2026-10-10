import { useMemo, useState } from "react";
import { Alert, Button, Form, Modal, Row, Col } from "react-bootstrap";
import { raceRequest, miles } from "../lib/race-api.js";
import RaceMap from "./RaceMap.jsx";

export default function CourseEditor({ recording, onClose, onSaved }) {
  const [name, setName] = useState(recording.name);
  const [start, setStart] = useState(1);
  const [end, setEnd] = useState(recording.points.length);
  const [reverse, setReverse] = useState(false);
  const [loop, setLoop] = useState(false);
  const [bridge, setBridge] = useState(false);
  const [checkpoints, setCheckpoints] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const points = useMemo(() => {
    const p = recording.points
      .slice(Math.max(0, start - 1), end)
      .map((p) => ({ ...p }));
    if (reverse) p.reverse();
    return p;
  }, [recording, start, end, reverse]);
  const gaps = recording.points.slice(start, end).some((p) => p.break_before);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const course = await raceRequest("courses/", {
        name,
        loop,
        points: points.map((p, i) => ({
          ...p,
          break_before: !bridge && gaps && i === 1,
        })),
        checkpoints: checkpoints
          .split(",")
          .filter((x) => x.trim())
          .map((x) => Number(x) * 1609.344),
      });
      onSaved(course);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal show onHide={() => !busy && onClose()} size="lg" centered>
      <Form onSubmit={save}>
        <Modal.Header closeButton={!busy}>
          <Modal.Title>Save as course</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {error && <Alert variant="danger">{error}</Alert>}
          <Form.Label htmlFor="course-name">Course name</Form.Label>
          <Form.Control
            id="course-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
          />
          <Row className="g-3 my-1">
            <Col>
              <Form.Label htmlFor="trim-start">Start sample</Form.Label>
              <Form.Control
                id="trim-start"
                type="number"
                min={1}
                max={end - 1}
                value={start}
                onChange={(e) => setStart(Number(e.target.value))}
                required
              />
            </Col>
            <Col>
              <Form.Label htmlFor="trim-end">Finish sample</Form.Label>
              <Form.Control
                id="trim-end"
                type="number"
                min={start + 1}
                max={recording.points.length}
                value={end}
                onChange={(e) => setEnd(Number(e.target.value))}
                required
              />
            </Col>
          </Row>
          <div className="d-flex gap-4 my-3">
            <Form.Check
              label="Reverse direction"
              checked={reverse}
              onChange={(e) => setReverse(e.target.checked)}
            />
            <Form.Check
              label="Repeated loop"
              checked={loop}
              onChange={(e) => setLoop(e.target.checked)}
            />
          </div>
          {gaps && (
            <Alert variant="warning">
              GPS gaps exist in this selection. Trim to a continuous section, or
              explicitly allow straight connections.
              <Form.Check
                className="mt-2"
                label="Connect these gaps with straight lines"
                checked={bridge}
                onChange={(e) => setBridge(e.target.checked)}
              />
            </Alert>
          )}
          <Form.Label htmlFor="checkpoints">
            Checkpoint distances (mi, comma-separated)
          </Form.Label>
          <Form.Control
            id="checkpoints"
            placeholder="1, 2"
            value={checkpoints}
            onChange={(e) => setCheckpoints(e.target.value)}
          />
          <div className="small text-secondary my-2">
            Selected samples define start and finish. Review crossings and
            turnarounds before saving.
          </div>
          {points.length > 1 && <RaceMap course={{ points }} />}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={busy || points.length < 2 || (gaps && !bridge)}
          >
            {busy ? "Saving…" : "Save course"}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
