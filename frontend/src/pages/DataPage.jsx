import { useState } from "react";
import Accordion from "react-bootstrap/Accordion";
import Badge from "react-bootstrap/Badge";
import Card from "react-bootstrap/Card";
import Pagination from "react-bootstrap/Pagination";
import Table from "react-bootstrap/Table";
import { Link } from "react-router-dom";
import { useRecording } from "../components/RecordingLayout.jsx";
import { speedMph, feet, utc, warningText } from "../lib/format.js";
const PAGE_SIZE = 50;
function Samples({ recording }) {
    const [page, setPage] = useState(0);
    const count = Math.ceil(recording.points.length / PAGE_SIZE);
    return <>
    {recording.warnings.length > 0 && <Accordion className="mb-4"><Accordion.Item eventKey="quality"><Accordion.Header>Data quality <Badge bg="warning" text="dark" className="ms-2">{recording.warnings.length}</Badge></Accordion.Header><Accordion.Body><ul className="mb-0">{recording.warnings.map((warning) => <li key={warning}>{warningText(warning)}</li>)}</ul></Accordion.Body></Accordion.Item></Accordion>}
    <Card>
      <Card.Header className="d-flex justify-content-between align-items-center"><h2>Samples</h2><span className="small text-secondary text-truncate ms-3">{recording.filename}</span></Card.Header>
      <Table responsive hover size="sm" className="sample-table mb-0 align-middle">
        <thead><tr><th>#</th><th>{recording.time_basis === "utc" ? "Time · UTC" : "Elapsed · s"}</th><th>Latitude</th><th>Longitude</th><th>Speed · mph</th><th>Accuracy · ft</th><th><span className="visually-hidden">View on route</span></th></tr></thead>
        <tbody>{recording.points.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((point, index) => <tr key={point.source_row}>
          <td>{page * PAGE_SIZE + index + 1}</td><td>{point.timestamp ? utc(point.timestamp) : Math.round(point.elapsed_s)}</td>
          <td>{point.latitude.toFixed(6)}</td><td>{point.longitude.toFixed(6)}</td>
          <td title={point.speed_m_s === null ? "Estimated from consecutive fixes" : "Phone measurement"}>{speedMph(point)?.toFixed(2) ?? "—"}</td><td>{feet(point.accuracy_m)?.toFixed(1) ?? "—"}</td>
          <td><Link to={`/recordings/${recording.id}?t=${point.elapsed_s}`} className="btn btn-link btn-sm" aria-label={`View sample ${page * PAGE_SIZE + index + 1}`}>View</Link></td>
        </tr>)}</tbody>
      </Table>
      <Card.Footer className="d-flex justify-content-between align-items-center gap-3 flex-wrap">
        <span className="small text-secondary">{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, recording.points.length)} of {recording.points.length}</span>
        <Pagination size="sm" className="mb-0"><Pagination.Prev disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page"/><Pagination.Item active>{page + 1}</Pagination.Item><Pagination.Next disabled={page + 1 >= count} onClick={() => setPage(page + 1)} aria-label="Next page"/></Pagination>
      </Card.Footer>
    </Card>
  </>;
}
export default function DataPage() {
    const recording = useRecording();
    return <Samples key={recording.id} recording={recording}/>;
}
