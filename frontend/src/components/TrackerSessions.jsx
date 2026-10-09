import { useEffect, useState } from "react";
import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";
import Modal from "react-bootstrap/Modal";
import useTracker from "../hooks/useTracker.js";
import Table from "react-bootstrap/Table";
import { utc } from "../lib/format.js";
import {
  deleteTrackerSession,
  downloadTrackerSession,
  getTrackerSessions,
} from "../lib/tracker-api.js";

const LABELS = {
  completed: ["Saved", "success"],
  error: ["Connection lost / failed", "warning"],
  interrupted: ["Interrupted", "warning"],
  legacy: ["Previous captures", "secondary"],
};

export default function TrackerSessions() {
  const { snapshot } = useTracker();
  const sessionId = snapshot?.receiver?.session_id;
  const receiverState = snapshot?.receiver?.state;
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [page, setPage] = useState(null);
  const [before, setBefore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(null);

  // Return to newest captures whenever a connection changes.
  useEffect(() => setBefore(null), [sessionId, receiverState]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    getTrackerSessions(before, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setPage(data);
          setError("");
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [before, sessionId, receiverState, revision]);

  async function download(id) {
    setDownloading(id);
    setError("");
    try {
      await downloadTrackerSession(id);
    } catch (failure) {
      setError(failure.message || "Download failed. Try again.");
    } finally {
      setDownloading(null);
    }
  }

  async function remove() {
    if (!selected || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await deleteTrackerSession(selected.id);
      setSelected(null);
      setBefore(null);
      setRevision((value) => value + 1);
    } catch (failure) {
      setDeleteError(failure.message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <h1>Saved sessions</h1>
      </div>
      <Card>
        {error && (
          <Alert variant="danger" className="m-3">
            {error}
          </Alert>
        )}
        {page?.sessions.length ? (
          <Table responsive className="tracker-table mb-0">
            <thead>
              <tr>
                <th>Session</th>
                <th>Started (UTC)</th>
                <th>Status</th>
                <th>Packets</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {page.sessions.map((session) => {
                const [label, color] = LABELS[session.status] || [
                  session.status,
                  "secondary",
                ];
                return (
                  <tr key={session.id}>
                    <td>
                      #{session.id}
                      <div className="small text-body-secondary">
                        {session.receiver_id || session.port || "—"}
                      </div>
                    </td>
                    <td>{utc(session.started_at)}</td>
                    <td>
                      <Badge bg={color}>{label}</Badge>
                      {(session.dropped_packets > 0 ||
                        session.capture_error) && (
                        <div className="small text-danger mt-1">
                          Capture incomplete · {session.dropped_packets} dropped
                        </div>
                      )}
                    </td>
                    <td>{session.packet_count.toLocaleString()}</td>
                    <td>
                      <Button
                        variant="outline-secondary"
                        size="sm"
                        disabled={downloading !== null || deleting}
                        onClick={() => download(session.id)}
                        aria-label={`Download session ${session.id}`}
                      >
                        {downloading === session.id ? "Downloading…" : "JSON"}
                      </Button>
                      <Button
                        variant="outline-danger"
                        size="sm"
                        className="ms-2"
                        disabled={downloading !== null || deleting}
                        onClick={() => {
                          setSelected(session);
                          setDeleteError("");
                        }}
                        aria-label={`Delete session ${session.id}`}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <Card.Body className="text-center text-body-secondary py-4">
            {loading ? "Loading sessions…" : "No saved sessions yet."}
          </Card.Body>
        )}
        <Card.Footer className="d-flex justify-content-between align-items-center gap-3 flex-wrap">
          <span className="small text-body-secondary">
            Downloads include every saved packet.
          </span>
          <div className="d-flex gap-2">
            {before && (
              <Button
                size="sm"
                variant="outline-secondary"
                disabled={loading}
                onClick={() => setBefore(null)}
              >
                Newest sessions
              </Button>
            )}
            {page?.next_before && (
              <Button
                size="sm"
                variant="outline-secondary"
                disabled={loading}
                onClick={() => setBefore(page.next_before)}
              >
                Older sessions
              </Button>
            )}
          </div>
        </Card.Footer>
      </Card>
      <Modal
        show={Boolean(selected)}
        onHide={() => !deleting && setSelected(null)}
        centered
        backdrop={deleting ? "static" : true}
        keyboard={!deleting}
      >
        <Modal.Header closeButton={!deleting}>
          <Modal.Title>Delete session #{selected?.id}?</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          This permanently removes the session and its{" "}
          {selected?.packet_count.toLocaleString()} saved packets. Download the
          JSON first if you want to keep a copy.
          {deleteError && (
            <Alert variant="danger" className="mt-3 mb-0">
              {deleteError}
            </Alert>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            disabled={deleting}
            onClick={() => setSelected(null)}
          >
            Cancel
          </Button>
          <Button variant="danger" disabled={deleting} onClick={remove}>
            {deleting ? "Deleting…" : "Delete session"}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
