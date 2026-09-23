import { useRef } from "react";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";
import Form from "react-bootstrap/Form";
import Spinner from "react-bootstrap/Spinner";
import Table from "react-bootstrap/Table";
import { Link } from "react-router-dom";
import { useRecordings } from "../state/RecordingsContext.jsx";
import { duration, miles } from "../lib/format.js";


export default function RecordingsPage() {
    const { recordings, ready, busy, importFiles, remove } = useRecordings();
    const input = useRef(null);
    
    return <>
    <div className="page-heading">
      <h1>Recordings <span className="recording-count">{recordings.length}</span></h1>
      <Button disabled={!ready || busy} onClick={() => input.current?.click()}>
        {busy && <Spinner size="sm" className="me-2" aria-hidden="true"/>}Import CSV
      </Button>
      <Form.Control ref={input} type="file" className="visually-hidden" accept=".csv,text/csv" multiple aria-label="Import CSV files" disabled={!ready || busy} onChange={(event) => {
            void importFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
        }}/>
    </div>
    <Card>
      <Table responsive hover className="recordings-table mb-0 align-middle">
        <thead><tr><th>Name</th><th>Date · UTC</th><th>Duration</th><th>Distance</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
        <tbody>{recordings.map((recording) => <tr key={recording.id}>
          <td><Link to={`/recordings/${recording.id}`} className="recording-link">{recording.name}</Link>{recording.demo && <Badge bg="light" text="secondary" className="ms-2">Sample</Badge>}</td>
          <td className="text-secondary">{recording.summary.started_at?.slice(0, 10) ?? "—"}</td>
          <td className="tabular">{duration(recording.summary.duration_s)}</td>
          <td className="tabular">{miles(recording.summary.distance_m).toFixed(2)} mi</td>
          <td><div className="d-flex justify-content-end gap-2">
            <Link to={`/recordings/${recording.id}`} className="btn btn-sm btn-outline-primary" aria-label={`Open ${recording.name}`}>Open</Link>
            {!recording.demo && <Button size="sm" variant="outline-secondary" disabled={busy} aria-label={`Delete ${recording.name}`} onClick={() => void remove(recording.id)}>Delete</Button>}
          </div></td>
        </tr>)}</tbody>
      </Table>
    </Card>
    {!ready && <div className="py-3 text-secondary" role="status"><Spinner size="sm" className="me-2"/>Loading recordings…</div>}
  </>;
}
