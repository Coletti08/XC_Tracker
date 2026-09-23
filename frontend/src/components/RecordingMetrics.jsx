import Card from "react-bootstrap/Card";
import Col from "react-bootstrap/Col";
import Row from "react-bootstrap/Row";
import { duration, miles, pacePerMile } from "../lib/format.js";


export default function RecordingMetrics({ recording }) {
    const { summary, points } = recording;
    const metrics = [
        ["GPS distance", points.length > 1 ? `${miles(summary.distance_m).toFixed(2)} mi` : "—"],
        ["Duration", points.length > 1 ? duration(summary.duration_s) : "—"],
        ["Overall pace", summary.average_pace_s_km === null ? "—" : `${duration(pacePerMile(summary.average_pace_s_km))} /mi`],
        ["Samples", summary.sample_count.toLocaleString()],
    ];
    return <Row xs={2} lg={4} className="g-3 mb-4">
    {metrics.map(([label, value]) => <Col key={label}><Card className="h-100 metric-card"><Card.Body><div className="metric-label">{label}</div><div className="metric-value">{value}</div></Card.Body></Card></Col>)}
  </Row>;
}
