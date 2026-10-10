import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Badge, Button, Card, Form, Table } from "react-bootstrap";
import { useRecordings } from "../state/RecordingsContext.jsx";
import { raceRequest, raceDownload, miles } from "../lib/race-api.js";
import CourseEditor from "../components/CourseEditor.jsx";
import RaceSetup from "../components/RaceSetup.jsx";

export default function RacesPage() {
  const { recordings } = useRecordings();
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState(null),
    [error, setError] = useState(""),
    [selected, setSelected] = useState("");
  const [course, setCourse] = useState(null),
    [setup, setSetup] = useState(false),
    [busy, setBusy] = useState(false);
  const refresh = () =>
    raceRequest()
      .then(setCatalog)
      .catch((e) => setError(e.message));
  useEffect(() => {
    refresh();
  }, []);
  async function upload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const data = new FormData();
      data.append("file", file);
      await raceRequest("courses/import/", data);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }
  return (
    <>
      <div className="page-heading">
        <h1>Races</h1>
        <Button
          disabled={!catalog?.courses.length}
          onClick={() => setSetup(true)}
        >
          Create race
        </Button>
      </div>
      {error && <Alert variant="danger">{error}</Alert>}
      <Card className="mb-4">
        <Card.Header>
          <h2>Your races</h2>
        </Card.Header>
        {catalog?.races.length ? (
          <Table responsive hover className="mb-0">
            <thead>
              <tr>
                <th>Race</th>
                <th>Source</th>
                <th>State</th>
                <th>Runners</th>
              </tr>
            </thead>
            <tbody>
              {catalog.races.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to={`/races/${r.id}`}>{r.name}</Link>
                  </td>
                  <td>
                    <Badge
                      bg={r.mode === "simulation" ? "warning" : "success"}
                      text={r.mode === "simulation" ? "dark" : undefined}
                    >
                      {r.mode}
                    </Badge>
                  </td>
                  <td className="text-capitalize">{r.state}</td>
                  <td>{r.roster.length}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Card.Body className="text-secondary">
            {catalog ? "No races yet." : "Loading…"}
          </Card.Body>
        )}
      </Card>
      <Card>
        <Card.Header>
          <h2>Courses</h2>
        </Card.Header>
        <Card.Body>
          <div className="d-flex flex-wrap gap-2 align-items-end mb-3">
            <div className="flex-grow-1">
              <Form.Label htmlFor="course-recording">
                Create from recording
              </Form.Label>
              <Form.Select
                id="course-recording"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">Select a recording</option>
                {recordings.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Form.Select>
            </div>
            <Button
              variant="outline-primary"
              disabled={!selected}
              onClick={() =>
                setCourse(recordings.find((r) => r.id === selected))
              }
            >
              Save as course
            </Button>
          </div>
          <Form.Label htmlFor="import-course">
            Import exported course CSV
          </Form.Label>
          <Form.Control
            id="import-course"
            type="file"
            accept=".csv"
            disabled={busy}
            onChange={upload}
          />
        </Card.Body>
        {catalog?.courses.length > 0 && (
          <Table responsive className="mb-0">
            <thead>
              <tr>
                <th>Course</th>
                <th>Distance (mi)</th>
                <th>Type</th>
                <th>Export</th>
              </tr>
            </thead>
            <tbody>
              {catalog.courses.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.name}
                    {c.warnings.map((w) => (
                      <div key={w} className="small text-warning-emphasis">
                        {w}
                      </div>
                    ))}
                  </td>
                  <td>{miles(c.length_m)}</td>
                  <td>{c.loop ? "Loop" : "Single route"}</td>
                  <td>
                    <Button
                      size="sm"
                      variant="outline-secondary"
                      onClick={() =>
                        raceDownload(
                          `courses/${c.id}/export/`,
                          `xc-course-${c.id}.csv`,
                        ).catch((e) => setError(e.message))
                      }
                    >
                      CSV
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {course && (
        <CourseEditor
          recording={course}
          onClose={() => setCourse(null)}
          onSaved={() => {
            setCourse(null);
            refresh();
          }}
        />
      )}
      {setup && (
        <RaceSetup
          catalog={catalog}
          onClose={() => setSetup(false)}
          onSaved={(r) => navigate(`/races/${r.id}`)}
        />
      )}
    </>
  );
}
