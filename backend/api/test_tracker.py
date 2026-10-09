"""Checks for units, serial lifecycle, real Meshtastic decoding, and the HTTP API."""

import json
import time
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import Client, SimpleTestCase, TestCase, TransactionTestCase
from meshtastic.protobuf import mesh_pb2, portnums_pb2, telemetry_pb2
from meshtastic.serial_interface import SerialInterface

from .models import TrackerPacket
from .tracker.packets import normalize_packet
from .tracker.receiver import ReceiverBusy, TrackerReceiver


def wait_until(predicate, seconds=4):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.02)
    raise AssertionError("Timed out waiting for the receiver")


class PacketTests(SimpleTestCase):
    def normalize(self, decoded, **extra):
        return normalize_packet({"from": 42, "decoded": decoded, **extra}, SimpleNamespace())

    def test_position_units_zero_values_and_distinct_timestamps(self):
        row = self.normalize({"portnum": "POSITION_APP", "position": {
            "latitudeI": 0, "longitudeI": -720000000, "altitude": 0,
            "groundSpeed": 18, "timestamp": 1700000000,
            "timestampMillisAdjust": 625, "time": 1700000100,
        }}, rxTime=1700000200)
        data = row["data"]
        self.assertEqual(row["node_id"], "!0000002a")
        self.assertEqual(data["latitude"], 0)
        self.assertEqual(data["longitude"], -72)
        self.assertEqual(data["altitude_m"], 0)
        self.assertEqual(data["speed_m_s"], 5)
        self.assertEqual(data["gps_fix_at"], "2023-11-14T22:13:20.625000+00:00")
        self.assertEqual(data["device_time"], "2023-11-14T22:15:00+00:00")
        self.assertEqual(data["radio_received_at"], "2023-11-14T22:16:40+00:00")

    def test_missing_or_invalid_measurements_stay_missing(self):
        for position in [{}, {"latitudeI": 910000000, "longitudeI": 1810000000,
                              "altitude": float("nan"), "groundSpeed": -1, "timestamp": 0}]:
            with self.subTest(position=position):
                data = self.normalize({"position": position})["data"]
                for field in ["latitude", "longitude", "altitude_m", "speed_m_s", "gps_fix_at"]:
                    self.assertIsNone(data[field])
                json.dumps(data, allow_nan=False)

    def test_device_clock_is_not_reported_as_gps_fix(self):
        data = self.normalize({"position": {"time": 1700000000}})["data"]
        self.assertIsNotNone(data["device_time"])
        self.assertIsNone(data["gps_fix_at"])

    def test_telemetry_external_power_and_binary_payload_are_preserved(self):
        data = self.normalize({
            "portnum": "TELEMETRY_APP", "payload": b"\x00\xff",
            "telemetry": {"deviceMetrics": {"batteryLevel": 101, "voltage": 4.2}},
        })["data"]
        self.assertIsNone(data["battery_percent"])
        self.assertTrue(data["external_power"])
        self.assertEqual(data["voltage"], 4.2)
        self.assertEqual(data["raw"]["decoded"]["payload"], {"encoding": "base64", "data": "AP8="})

    def test_encrypted_packet_is_retained_without_fabricated_coordinates(self):
        row = normalize_packet({"from": 42, "encrypted": b"encrypted"}, SimpleNamespace())
        self.assertEqual(row["packet_type"], "ENCRYPTED")
        self.assertIsNone(row["data"]["latitude"])


class TrackerApiTests(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)
        self.token = self.client.get("/api/health/").json()["csrf_token"]

    def post(self, action, body=None):
        return self.client.post(
            f"/api/tracker/{action}/", data=json.dumps(body or {}),
            content_type="application/json", HTTP_X_CSRFTOKEN=self.token,
            HTTP_ORIGIN="http://127.0.0.1:5173", HTTP_HOST="127.0.0.1:8000",
        )

    @patch("api.tracker.views.receiver")
    @patch("api.tracker.views.available_ports", return_value=[{"device": "/dev/ttyUSB0", "description": "V4"}])
    def test_connect_validates_port_and_requires_csrf(self, ports, receiver):
        receiver.connect.return_value = {"state": "connecting", "port": "/dev/ttyUSB0"}
        self.assertEqual(self.client.post("/api/tracker/connect/").status_code, 403)
        self.assertEqual(self.client.post("/api/tracker/disconnect/").status_code, 403)
        self.assertEqual(self.post("connect").status_code, 400)
        self.assertEqual(self.post("connect", {"port": "/etc/passwd"}).status_code, 400)
        receiver.connect.assert_not_called()
        self.assertEqual(self.post("connect", {"port": "/dev/ttyUSB0"}).status_code, 202)
        receiver.connect.assert_called_once_with("/dev/ttyUSB0")
        receiver.connect.side_effect = ReceiverBusy("Already connected")
        self.assertEqual(self.post("connect", {"port": "/dev/ttyUSB0"}).status_code, 409)

    def test_history_is_newest_first_bounded_and_survives_receiver_instances(self):
        for index in range(3):
            TrackerPacket.objects.create(node_id="!0000002a", packet_type="POSITION_APP", data={"packet_id": index})

        with patch("api.tracker.views.receiver", TrackerReceiver()):
            result = self.client.get("/api/tracker/packets/?limit=2")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result["Cache-Control"], "no-store")
        data = result.json()
        self.assertEqual([packet["packet_id"] for packet in data["packets"]], [2, 1])
        self.assertEqual(data["summary"]["packets"], 3)
        self.assertEqual(data["summary"]["devices"], 1)
        self.assertEqual(data["summary"]["positions"], 3)
        self.assertEqual(data["receiver"]["state"], "disconnected")
        for value in ["0", "201", "abc"]:
            self.assertEqual(self.client.get(f"/api/tracker/packets/?limit={value}").status_code, 400)


class ReceiverIntegrationTests(TransactionTestCase):
    def setUp(self):
        self.receiver = TrackerReceiver()
        # Use the real SDK decoder and PubSub path, substituting only the USB transport.
        self.radio = SerialInterface(devPath="/dev/test-radio", connectNow=False)
        self.radio.nodes = {}
        self.radio.nodesByNum = {}
        self.radio.myInfo = mesh_pb2.MyNodeInfo(my_node_num=99)
        self.radio.connect = Mock(side_effect=self.radio.isConnected.set)
        self.radio.close = Mock(side_effect=self.radio.isConnected.clear)
        self.factory = patch("api.tracker.receiver.SerialInterface", return_value=self.radio)
        self.factory.start()

    def tearDown(self):
        self.receiver.disconnect()
        if self.receiver._thread:
            self.receiver._thread.join(timeout=4)
            self.assertFalse(self.receiver._thread.is_alive())
        self.factory.stop()

    def connect(self):
        self.receiver.connect("/dev/test-radio")
        wait_until(lambda: self.receiver.status()["state"] == "connected")

    def send(self, payload, port, packet_id):
        packet = mesh_pb2.MeshPacket(id=packet_id, rx_time=1700000005, rx_rssi=-81, rx_snr=6.5)
        setattr(packet, "from", 42)
        packet.to = 0xFFFFFFFF
        packet.decoded.portnum = port
        packet.decoded.payload = payload.SerializeToString()
        self.radio._handlePacketFromRadio(packet)

    def test_sdk_position_and_telemetry_reach_database_and_api(self):
        self.connect()
        self.send(mesh_pb2.Position(latitude_i=421234567, longitude_i=-720123456,
                                    ground_speed=18, altitude=100, timestamp=1700000000),
                  portnums_pb2.POSITION_APP, 123)
        telemetry = telemetry_pb2.Telemetry(time=1700000001)
        telemetry.device_metrics.battery_level = 87
        self.send(telemetry, portnums_pb2.TELEMETRY_APP, 124)
        wait_until(lambda: TrackerPacket.objects.count() == 2)

        self.receiver.disconnect()
        self.receiver._thread.join(timeout=4)
        self.assertEqual(self.receiver.status()["state"], "disconnected")
        self.radio.close.assert_called_once()

        with patch("api.tracker.views.receiver", self.receiver):
            result = self.client.get("/api/tracker/packets/").json()
        self.assertEqual(result["summary"]["packets"], 2)
        telemetry, position = result["packets"]
        self.assertEqual(telemetry["battery_percent"], 87)
        self.assertIsNone(telemetry["latitude"])
        self.assertAlmostEqual(position["latitude"], 42.1234567)
        self.assertEqual(position["speed_m_s"], 5)
        self.assertEqual(position["rssi"], -81)
        self.assertEqual(position["raw"]["raw"]["decoded"]["portnum"], "POSITION_APP")
        self.assertEqual(result["receiver"]["receiver_id"], "!00000063")

    def test_double_connect_foreign_events_and_usb_loss(self):
        self.connect()
        with self.assertRaises(ReceiverBusy):
            self.receiver.connect("/dev/another-radio")
        self.receiver._receive({"from": 100}, interface=object())
        self.assertTrue(self.receiver._pending.empty())
        self.radio.isConnected.clear()
        wait_until(lambda: self.receiver.status()["state"] == "error")
        self.assertIn("disconnected", self.receiver.status()["error"])
        self.assertEqual(TrackerPacket.objects.count(), 0)

    def test_failed_handshake_cleans_up_and_allows_retry(self):
        self.radio.connect.side_effect = OSError("Port is busy")
        self.receiver.connect("/dev/test-radio")
        wait_until(lambda: self.receiver.status()["state"] == "error")
        self.receiver._thread.join(timeout=4)
        self.radio.close.assert_called_once()
        self.radio.connect.side_effect = self.radio.isConnected.set
        self.connect()
        self.assertIsNone(self.receiver.status()["error"])
