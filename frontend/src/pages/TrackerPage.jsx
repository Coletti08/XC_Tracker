import { useEffect, useState } from "react";
import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import Modal from "react-bootstrap/Modal";
import Row from "react-bootstrap/Row";
import Spinner from "react-bootstrap/Spinner";
import Table from "react-bootstrap/Table";
import useTracker from "../hooks/useTracker.js";
import { feet, speedMph, utc } from "../lib/format.js";
import { getTrackerPorts } from "../lib/tracker-api.js";

const STATES = {
  disconnected: ["Disconnected", "secondary"],
  connecting: ["Connecting", "warning"],
  connected: ["Connected", "success"],
  stopping: ["Disconnecting", "warning"],
  error: ["Connection failed", "danger"],
};

function time(value) {
  return value ? utc(value, { includeDate: false }) : "—";
}

function numeric(value, decimals = 0) {
  return value == null ? "—" : value.toFixed(decimals);
}

function packetLabel(value) {
  return value.replace(/_APP$/, "").replaceAll("_", " ").toLowerCase();
}

function battery(packet) {
  return packet.external_power
    ? "Powered"
    : packet.battery_percent == null
      ? "—"
      : `${packet.battery_percent}%`;
}

function PacketDetails({ packet, onHide }) {
  return (
    <Modal show={Boolean(packet)} onHide={onHide} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title>Packet details</Modal.Title>
      </Modal.Header>
      {packet && (
        <Modal.Body>
          <dl className="tracker-details">
            <dt>Sender</dt>
            <dd>{packet.node_name || packet.node_id}</dd>
            <dt>Node ID</dt>
            <dd>{packet.node_id}</dd>
            <dt>Packet ID</dt>
            <dd>{packet.packet_id ?? "—"}</dd>
            <dt>Received (UTC)</dt>
            <dd>{utc(packet.received_at)}</dd>
            <dt>GPS fix (UTC)</dt>
            <dd>{time(packet.gps_fix_at)}</dd>
            <dt>Device time (UTC)</dt>
            <dd>{time(packet.device_time)}</dd>
            <dt>Altitude (ft)</dt>
            <dd>{numeric(feet(packet.altitude_m))}</dd>
            <dt>Satellites</dt>
            <dd>{packet.satellites ?? "—"}</dd>
            <dt>Battery</dt>
            <dd>{battery(packet)}</dd>
            <dt>Voltage</dt>
            <dd>
              {packet.voltage == null ? "—" : `${packet.voltage.toFixed(2)} V`}
            </dd>
            {packet.text != null && (
              <>
                <dt>Message</dt>
                <dd>{packet.text}</dd>
              </>
            )}
          </dl>
          <h2 className="mb-3">Raw packet</h2>
          <pre className="tracker-raw mb-0">
            {JSON.stringify(packet.raw, null, 2)}
          </pre>
        </Modal.Body>
      )}
    </Modal>
  );
}

export default function TrackerPage() {
  const { snapshot, error, busy, command } = useTracker();
  const [ports, setPorts] = useState([]);
  const [selectedPort, setSelectedPort] = useState("");
  const [portsError, setPortsError] = useState("");
  const [actionError, setActionError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [detail, setDetail] = useState(null);
  const receiver = snapshot?.receiver;
  const packets = snapshot?.packets || [];
  const summary = snapshot?.summary;
  const active = ["connecting", "connected", "stopping"].includes(
    receiver?.state,
  );
  const [statusLabel, statusColor] = error
    ? ["Backend offline", "danger"]
    : receiver
      ? STATES[receiver.state] || STATES.disconnected
      : ["Loading", "secondary"];

  async function refreshPorts(signal) {
    setRefreshing(true);

    try {
      const data = await getTrackerPorts(signal);
      if (signal?.aborted) return;
      setPorts(data.ports);
      setPortsError("");
      setSelectedPort((current) =>
        data.ports.some((port) => port.device === current) ? current : "",
      );
    } catch (failure) {
      if (!signal?.aborted) setPortsError(failure.message);
    } finally {
      if (!signal?.aborted) setRefreshing(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    refreshPorts(controller.signal);
    return () => controller.abort();
  }, []);

  async function act(action) {
    setActionError("");
    try {
      await command(action, action === "connect" ? { port: selectedPort } : {});
    } catch (failure) {
      setActionError(failure.message);
    }
  }

  const alerts = [
    ...new Set(
      [
        error,
        portsError,
        actionError,
        receiver?.error,
        receiver?.capture_error,
      ].filter(Boolean),
    ),
  ];

  return (
    <>
      <div className="page-heading">
        <h1>Live data</h1>
        <Badge bg={statusColor} className="tracker-status" role="status">
          {statusLabel}
        </Badge>
      </div>

      {alerts.map((message) => (
        <Alert key={message} variant="danger">
          {message}
        </Alert>
      ))}

      <Card className="mb-4">
        <Card.Body>
          <Row className="g-3 align-items-end">
            <Col md>
              <Form.Label htmlFor="receiver-port">USB receiver</Form.Label>
              <Form.Select
                id="receiver-port"
                value={active ? receiver.port : selectedPort}
                onChange={(event) => setSelectedPort(event.target.value)}
                disabled={active || busy || refreshing}
              >
                <option value="">
                  {ports.length
                    ? "Choose a serial port"
                    : "No serial ports found"}
                </option>
                {active &&
                  !ports.some((port) => port.device === receiver.port) && (
                    <option value={receiver.port}>{receiver.port}</option>
                  )}
                {ports.map((port) => (
                  <option key={port.device} value={port.device}>
                    {port.device} — {port.description}
                  </option>
                ))}
              </Form.Select>
            </Col>
            <Col md="auto" className="d-flex gap-2">
              <Button
                variant="outline-secondary"
                onClick={() => refreshPorts()}
                disabled={active || busy || refreshing}
              >
                {refreshing ? "Refreshing…" : "Refresh ports"}
              </Button>
              {active ? (
                <Button
                  variant="outline-danger"
                  onClick={() => act("disconnect")}
                  disabled={
                    busy || receiver.state === "stopping" || Boolean(error)
                  }
                >
                  Disconnect
                </Button>
              ) : (
                <Button
                  onClick={() => act("connect")}
                  disabled={
                    !selectedPort || busy || !snapshot || Boolean(error)
                  }
                >
                  {busy ? "Connecting…" : "Connect"}
                </Button>
              )}
            </Col>
          </Row>
          <div className="small text-body-secondary mt-3">
            {active
              ? `Meshtastic · ${receiver.receiver_id || receiver.port}`
              : "Meshtastic over USB"}
          </div>
        </Card.Body>
      </Card>

      <Row className="g-3 mb-4">
        {[
          ["Packets saved", summary?.packets?.toLocaleString() ?? "—"],
          ["Senders", summary?.devices?.toLocaleString() ?? "—"],
          ["Position packets", summary?.positions?.toLocaleString() ?? "—"],
          ["Last received (UTC)", time(summary?.last_received_at)],
        ].map(([label, value]) => (
          <Col xs={6} lg={3} key={label}>
            <Card className="h-100">
              <Card.Body>
                <div className="metric-label">{label}</div>
                <div className="metric-value">{value}</div>
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>

      <Card>
        <Card.Header className="d-flex justify-content-between align-items-center gap-3">
          <h2>Incoming packets</h2>
          <span className="small text-body-secondary">
            Newest first · {packets.length} shown
          </span>
        </Card.Header>
        {packets.length ? (
          <Table responsive hover className="tracker-table mb-0">
            <thead>
              <tr>
                <th>Received (UTC)</th>
                <th>Sender</th>
                <th>Type</th>
                <th>Position</th>
                <th>GPS fix (UTC)</th>
                <th>Speed (mph)</th>
                <th>Battery</th>
                <th>Signal</th>
                <th>Packet</th>
              </tr>
            </thead>
            <tbody>
              {packets.map((packet) => (
                <tr key={packet.id}>
                  <td className="tabular">{time(packet.received_at)}</td>
                  <td>
                    <div className="tracker-node-name">
                      {packet.node_name || packet.node_id}
                    </div>
                    {packet.node_name && (
                      <div className="small text-body-secondary">
                        {packet.node_id}
                      </div>
                    )}
                  </td>
                  <td className="text-capitalize">
                    {packetLabel(packet.packet_type)}
                  </td>
                  <td className="tabular">
                    {packet.latitude != null && packet.longitude != null ? (
                      <>
                        <div>{packet.latitude.toFixed(6)}</div>
                        <div>{packet.longitude.toFixed(6)}</div>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="tabular">{time(packet.gps_fix_at)}</td>
                  <td className="tabular">{numeric(speedMph(packet), 1)}</td>
                  <td>{battery(packet)}</td>
                  <td className="tabular small">
                    <div>
                      {packet.rssi == null ? "—" : `${packet.rssi} dBm`}
                    </div>
                    <div className="text-body-secondary">
                      SNR {packet.snr == null ? "—" : `${packet.snr} dB`}
                    </div>
                  </td>
                  <td>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={() => setDetail(packet)}
                      aria-label={`View packet ${packet.id}`}
                    >
                      View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Card.Body className="text-center text-body-secondary py-5">
            {!snapshot && !error ? (
              <>
                <Spinner size="sm" className="me-2" />
                Loading packets…
              </>
            ) : receiver?.state === "connected" ? (
              "Waiting for the first packet."
            ) : (
              "No packets received yet."
            )}
          </Card.Body>
        )}
        {packets.length > 0 && (
          <Card.Footer className="small text-body-secondary">
            Latest {packets.length} of {summary?.packets?.toLocaleString()}{" "}
            saved packets
            {error ? " · Updates paused" : " · Updates automatically"}
          </Card.Footer>
        )}
      </Card>

      <PacketDetails packet={detail} onHide={() => setDetail(null)} />
    </>
  );
}
