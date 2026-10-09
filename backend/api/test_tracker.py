"""Checks for units, serial lifecycle, real Meshtastic decoding, and the HTTP API."""

import json
import time
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import Client, SimpleTestCase, TestCase, TransactionTestCase
from meshtastic.protobuf import mesh_pb2, portnums_pb2, telemetry_pb2
from meshtastic.serial_interface import SerialInterface

from .models import TrackerPacket, TrackerSession
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

    def test_live_history_is_bounded_and_only_contains_current_session(self):
        receiver = TrackerReceiver()
        receiver.status()
        old = TrackerSession.objects.create(status="completed")
        TrackerPacket.objects.create(session=old, node_id="old", packet_type="TEXT_MESSAGE_APP", data={})
        session = TrackerSession.objects.create()
        receiver._status.update(state="connected", session_id=session.pk)
        for index in range(3):
            TrackerPacket.objects.create(session=session, node_id="!0000002a", packet_type="POSITION_APP", data={"packet_id": index})

        with patch("api.tracker.views.receiver", receiver):
            result = self.client.get("/api/tracker/packets/?limit=2")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result["Cache-Control"], "no-store")
        data = result.json()
        self.assertEqual([packet["packet_id"] for packet in data["packets"]], [2, 1])
        self.assertEqual(data["summary"]["packets"], 3)
        self.assertEqual(data["summary"]["devices"], 1)
        self.assertEqual(data["summary"]["positions"], 3)
        self.assertEqual(data["receiver"]["state"], "connected")
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
        self.assertEqual(result["summary"]["packets"], 0)
        self.assertEqual(result["packets"], [])
        session = TrackerSession.objects.get(pk=self.receiver.status()["session_id"])
        self.assertEqual(session.status, "completed")
        with patch("api.tracker.views.receiver", self.receiver):
            response = self.client.get(f"/api/tracker/sessions/{session.pk}/download/")
            saved = json.loads(b"".join(response.streaming_content))
        position, telemetry = saved["packets"]
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
        self.assertEqual(TrackerSession.objects.get().status, "error")

    def test_failed_handshake_cleans_up_and_allows_retry(self):
        self.radio.connect.side_effect = OSError("Port is busy")
        self.receiver.connect("/dev/test-radio")
        wait_until(lambda: self.receiver.status()["state"] == "error")
        self.receiver._thread.join(timeout=4)
        self.radio.close.assert_called_once()
        self.radio.connect.side_effect = self.radio.isConnected.set
        self.connect()
        self.assertIsNone(self.receiver.status()["error"])

    def test_disconnect_drains_queue_and_reconnect_starts_empty(self):
        self.connect()
        first_id = self.receiver.status()["session_id"]
        for index in range(30):
            self.receiver._receive({"from": 42, "id": index, "decoded": {
                "portnum": "TEXT_MESSAGE_APP", "text": str(index),
            }}, self.radio)
        self.receiver.disconnect()
        self.receiver._receive({"from": 42, "id": 999}, self.radio)
        self.receiver._thread.join(timeout=4)
        self.assertEqual(TrackerPacket.objects.filter(session_id=first_id).count(), 30)
        self.assertEqual(TrackerSession.objects.get(pk=first_id).status, "completed")
        self.connect()
        self.assertNotEqual(self.receiver.status()["session_id"], first_id)
        with patch("api.tracker.views.receiver", self.receiver):
            data = self.client.get("/api/tracker/packets/").json()
        self.assertEqual(data["packets"], [])
        self.assertEqual(data["summary"]["packets"], 0)


class SessionApiTests(TestCase):
    def setUp(self):
        self.receiver = TrackerReceiver()
        self.receiver.status()
        self.patcher = patch("api.tracker.views.receiver", self.receiver)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def test_export_contains_all_packets_and_raw_data_after_restart(self):
        session = TrackerSession.objects.create(status="completed")
        for index in range(205):
            TrackerPacket.objects.create(
                session=session, node_id="!42", packet_type="TEXT_MESSAGE_APP",
                data={"text": f"Message {index}", "raw": {"binary": {"encoding": "base64", "data": "AP8="}}},
            )
        with patch("api.tracker.views.receiver", TrackerReceiver()):
            response = self.client.get(f"/api/tracker/sessions/{session.pk}/download/")
            data = json.loads(b"".join(response.streaming_content))
            live = self.client.get("/api/tracker/packets/").json()
        self.assertEqual(response.status_code, 200)
        self.assertIn("attachment", response["Content-Disposition"])
        self.assertEqual(data["session"]["packet_count"], 205)
        self.assertEqual(len(data["packets"]), 205)
        self.assertEqual(data["packets"][0]["text"], "Message 0")
        self.assertEqual(data["packets"][-1]["text"], "Message 204")
        self.assertEqual(data["packets"][0]["raw"]["binary"]["data"], "AP8=")
        self.assertEqual(live["summary"]["packets"], 0)

    def test_unfinished_capture_is_recovered_and_retains_packets(self):
        session = TrackerSession.objects.create()
        TrackerPacket.objects.create(session=session, node_id="!42", packet_type="ENCRYPTED", data={"raw": {}})
        with patch("api.tracker.views.receiver", TrackerReceiver()):
            data = self.client.get("/api/tracker/sessions/").json()
        self.assertEqual(data["sessions"][0]["status"], "interrupted")
        self.assertEqual(data["sessions"][0]["packet_count"], 1)
        self.assertIn("recovery time", data["sessions"][0]["error"])

    def test_active_export_rejected_and_history_paginated(self):
        active = TrackerSession.objects.create()
        self.assertEqual(self.client.get(f"/api/tracker/sessions/{active.pk}/download/").status_code, 409)
        self.assertEqual(self.client.get("/api/tracker/sessions/99999/download/").status_code, 404)
        for _ in range(21):
            TrackerSession.objects.create(status="completed")
        first = self.client.get("/api/tracker/sessions/").json()
        second = self.client.get(f"/api/tracker/sessions/?before={first['next_before']}").json()
        self.assertEqual(len(first["sessions"]), 20)
        self.assertEqual(len(second["sessions"]), 1)
        self.assertIsNone(second["next_before"])
        self.assertEqual(self.client.get("/api/tracker/sessions/?before=bad").status_code, 400)

    def test_delete_removes_only_selected_session_and_requires_csrf(self):
        closed = TrackerSession.objects.create(status="completed")
        other = TrackerSession.objects.create(status="completed")
        active = TrackerSession.objects.create()
        for session in [closed, other, active]:
            TrackerPacket.objects.create(session=session, node_id="!42", packet_type="TEXT_MESSAGE_APP", data={})
        client = Client(enforce_csrf_checks=True)
        url = f"/api/tracker/sessions/{closed.pk}/delete/"
        self.assertEqual(client.get(url).status_code, 405)
        self.assertEqual(client.post(url).status_code, 403)
        token = client.get("/api/health/").json()["csrf_token"]
        def delete(pk):
            return client.post(f"/api/tracker/sessions/{pk}/delete/", HTTP_X_CSRFTOKEN=token)
        self.assertEqual(delete(active.pk).status_code, 409)
        self.assertEqual(delete(closed.pk).status_code, 200)
        self.assertFalse(TrackerSession.objects.filter(pk=closed.pk).exists())
        self.assertEqual(TrackerPacket.objects.count(), 2)
        self.assertTrue(TrackerSession.objects.filter(pk=other.pk).exists())
        self.assertEqual(delete(closed.pk).status_code, 404)


class SessionMigrationTests(TransactionTestCase):
    def test_previous_packets_are_preserved(self):
        from django.db import connection
        from django.db.migrations.executor import MigrationExecutor

        executor = MigrationExecutor(connection)
        executor.migrate([("api", "0001_initial")])
        try:
            apps = executor.loader.project_state([("api", "0001_initial")]).apps
            old_packet = apps.get_model("api", "TrackerPacket").objects.create(
                node_id="!42", packet_type="TEXT_MESSAGE_APP", data={"text": "Keep me"},
            )
        finally:
            executor = MigrationExecutor(connection)
            executor.migrate([("api", "0002_tracker_sessions")])
        packet = TrackerPacket.objects.get(pk=old_packet.pk)
        self.assertEqual(packet.data["text"], "Keep me")
        self.assertEqual(packet.session.status, "legacy")
