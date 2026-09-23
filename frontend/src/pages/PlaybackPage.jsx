import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import { useSearchParams } from "react-router-dom";
import { useRecording } from "../components/RecordingLayout.jsx";
import RecordingMetrics from "../components/RecordingMetrics.jsx";
import { RoutePlot, SpeedPlot } from "../components/TrackPlots.jsx";
import { usePlayback } from "../hooks/usePlayback.js";
import { sampleAtTime } from "../lib/playback.js";
import { duration, speedMph, feet, utc } from "../lib/format.js";


function Player({ recording }) {
    const [params] = useSearchParams();
    const { points, summary } = recording;
    const player = usePlayback(summary.duration_s, Number(params.get("t") ?? 0));
    const selected = sampleAtTime(points, player.elapsed);
    const point = points[selected];
    const next = points[selected + 1];
    const inGap = next?.break_before && player.elapsed > point.elapsed_s && player.elapsed < next.elapsed_s;
    const currentSpeed = speedMph(point);
    return <>
    <RecordingMetrics recording={recording}/>
    <Row className="g-4">
      <Col lg={9}>
        <Card className="route-card mb-4">
          <Card.Header className="d-flex justify-content-between align-items-center"><h2>Route</h2><div className="route-legend"><span>○ Start</span><span>■ Finish</span>{inGap && <Badge bg="warning" text="dark">GPS gap</Badge>}</div></Card.Header>
          <RoutePlot points={points} selected={selected} cursorTime={player.elapsed}/>
          <Card.Body className="playback-controls">
            <div className="d-flex align-items-center justify-content-between gap-3 mb-3">
              <div className="d-flex gap-2">
                <Button className="play-button" disabled={summary.duration_s <= 0} onClick={player.toggle} aria-label={player.playing ? "Pause playback" : "Play recording"}>{player.playing ? "Pause" : "Play"}</Button>
                <Button variant="outline-secondary" onClick={player.restart} aria-label="Restart recording">Restart</Button>
              </div>
              <Form.Select className="playback-rate" aria-label="Playback speed" value={player.rate} onChange={(event) => player.setRate(Number(event.target.value))}>
                {[0.5, 1, 2, 4, 8].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
              </Form.Select>
            </div>
            <Form.Range aria-label="Playback position" min={0} max={summary.duration_s || 1} step="0.01" value={player.elapsed} disabled={summary.duration_s <= 0} onChange={(event) => player.seek(Number(event.target.value))} aria-valuetext={`${duration(player.elapsed)} of ${duration(summary.duration_s)}`}/>
            <div className="d-flex justify-content-between playback-time"><span data-testid="elapsed-time">{duration(player.elapsed)}</span><span>{duration(summary.duration_s)}</span></div>
          </Card.Body>
        </Card>
        <Card><Card.Header className="d-flex justify-content-between"><h2>Speed</h2><span className="text-secondary small">mph</span></Card.Header><SpeedPlot points={points} selected={selected} cursorTime={player.elapsed}/></Card>
      </Col>
      <Col lg={3}>
        <Card className="position-card"><Card.Header><h2>GPS fix</h2></Card.Header><Card.Body>
          <dl className="mb-0">
            <dt>Sample</dt><dd data-testid="sample-number">{selected + 1} / {points.length}</dd>
            <dt>Speed</dt><dd>{currentSpeed === null ? "—" : `${currentSpeed.toFixed(2)} mph`}</dd>
            <dt>Accuracy</dt><dd>{point.accuracy_m === null ? "—" : `${feet(point.accuracy_m).toFixed(1)} ft`}</dd>
            <dt>Latitude</dt><dd>{point.latitude.toFixed(6)}</dd>
            <dt>Longitude</dt><dd>{point.longitude.toFixed(6)}</dd>
            <dt>Time · UTC</dt><dd className="small mb-0">{point.timestamp ? utc(point.timestamp, { includeDate: false }) : "—"}</dd>
          </dl>
        </Card.Body></Card>
      </Col>
    </Row>
  </>;
}
export default function PlaybackPage() {
    const recording = useRecording();
    const [params] = useSearchParams();
    return <Player key={`${recording.id}:${params.get("t") ?? "0"}`} recording={recording}/>;
}
