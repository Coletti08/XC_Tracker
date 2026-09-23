import { useState } from "react";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Modal from "react-bootstrap/Modal";
import Nav from "react-bootstrap/Nav";
import Spinner from "react-bootstrap/Spinner";
import { Link, Outlet, useLocation, useOutletContext, useParams } from "react-router-dom";
import { useRecordings } from "../state/RecordingsContext.jsx";
export default function RecordingLayout() {
    const { id } = useParams();
    const { recordings, ready, busy, rename } = useRecordings();
    const recording = recordings.find((item) => item.id === id);
    const location = useLocation();
    const [showRename, setShowRename] = useState(false);
    const [name, setName] = useState("");
    if (!recording)
        return !ready ? <Spinner animation="border" role="status" aria-label="Loading recording"/> : <>
    <h1 className="mb-4">Recording not found</h1>
    <Link to="/recordings" className="btn btn-outline-primary">Recordings</Link>
  </>;
    return <>
    <Link to="/recordings" className="back-link">← Recordings</Link>
    <div className="page-heading recording-heading">
      <div className="d-flex align-items-center flex-wrap gap-3"><h1>{recording.name}</h1>{recording.demo && <Badge bg="light" text="secondary">Sample</Badge>}</div>
      {!recording.demo && <Button variant="outline-secondary" size="sm" onClick={() => { setName(recording.name); setShowRename(true); }}>Rename</Button>}
    </div>
    <Nav variant="tabs" activeKey={location.pathname.endsWith("/data") ? "data" : "playback"} className="mb-4">
      <Nav.Item><Nav.Link as={Link} to={`/recordings/${recording.id}`} eventKey="playback">Playback</Nav.Link></Nav.Item>
      <Nav.Item><Nav.Link as={Link} to={`/recordings/${recording.id}/data`} eventKey="data">Data</Nav.Link></Nav.Item>
    </Nav>
    <Outlet context={recording}/>
    <Modal show={showRename} onHide={() => { if (!busy)
        setShowRename(false); }} centered>
      <Form onSubmit={async (event) => { event.preventDefault(); if (await rename(recording.id, name))
        setShowRename(false); }}>
        <Modal.Header closeButton={!busy}><Modal.Title>Rename recording</Modal.Title></Modal.Header>
        <Modal.Body><Form.Group controlId="recording-name"><Form.Label>Name</Form.Label><Form.Control value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoFocus required disabled={busy}/></Form.Group></Modal.Body>
        <Modal.Footer><Button variant="outline-secondary" disabled={busy} onClick={() => setShowRename(false)}>Cancel</Button><Button type="submit" disabled={busy || !name.trim()}>Save</Button></Modal.Footer>
      </Form>
    </Modal>
  </>;
}
export function useRecording() { return useOutletContext(); }
