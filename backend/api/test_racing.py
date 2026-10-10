import json
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.test import Client, SimpleTestCase, TestCase
from django.utils import timezone
from api.models import Course, Race, RaceEvent, TrackerPacket, TrackerSession
from api.racing.engine import make_course, standings, point_at
from api.racing.views import sync_packets


def geometry(loop=False):
    points = [{"latitude": 42, "longitude": -72 + i * 0.0001} for i in range(31)]
    if loop:
        points += [
            {"latitude": 42.001, "longitude": -71.997},
            {"latitude": 42.001, "longitude": -72},
            points[0],
        ]
    return make_course({"points": points, "loop": loop, "checkpoints": [100]})


def fake_race(course=None):
    return SimpleNamespace(
        course_snapshot=course or geometry(),
        settings={"laps": 1, "interval_s": 5, "tolerance_m": 20},
        roster=[{"node_id": "!42", "name": "Runner", "bib": "1"}],
        started_at=timezone.now(),
    )


def event(race, t, distance=None, **extra):
    data = point_at(race.course_snapshot, distance) if distance is not None else {}
    data.update(extra)
    return SimpleNamespace(node_id="!42", elapsed_s=t, data=data)


class ProgressTests(SimpleTestCase):
    def test_course_rejects_missing_data_gaps_and_open_loop(self):
        with self.assertRaises(ValueError):
            make_course(
                {
                    "points": [
                        {"latitude": 0, "longitude": 0},
                        {"latitude": 0, "longitude": 1, "break_before": True},
                    ]
                }
            )
        with self.assertRaises(ValueError):
            make_course(
                {
                    "points": [
                        {"latitude": 0, "longitude": 0},
                        {"latitude": 0, "longitude": 1},
                    ],
                    "loop": True,
                }
            )
        with self.assertRaises(ValueError):
            make_course({"points": [{"latitude": float("nan"), "longitude": 0}] * 2})

    def test_progress_splits_and_estimated_finish(self):
        race = fake_race()
        length = race.course_snapshot["length_m"]
        events = [
            event(race, 0, 0),
            event(race, 20, 90),
            event(race, 40, 180),
            event(race, 50, length),
        ]
        row = standings(race, events, 50)[0]
        self.assertAlmostEqual(row["progress_m"], length)
        self.assertIsNotNone(row["finish_s"])
        self.assertEqual(len(row["splits"]), 2)
        self.assertAlmostEqual(row["splits"][0]["elapsed_s"], 22.222222, places=3)

    def test_stale_telemetry_does_not_refresh_gps(self):
        race = fake_race()
        row = standings(
            race, [event(race, 0, 0), event(race, 30, None, battery_percent=80)], 30
        )[0]
        self.assertTrue(row["heard_recently"])
        self.assertFalse(row["gps_recently"])
        self.assertEqual(row["status"], "Stale position")

    def test_delayed_duplicate_and_jump_do_not_advance_progress(self):
        race = fake_race()
        events = [
            event(race, 0, 0, packet_id=1),
            event(race, 10, 40, packet_id=2),
            event(race, 11, 90, packet_id=2),
            event(
                race,
                12,
                90,
                packet_id=3,
                gps_fix_at=(race.started_at + timedelta(seconds=5)).isoformat(),
            ),
            SimpleNamespace(
                node_id="!42", elapsed_s=13, data={"latitude": 43, "longitude": -72}
            ),
        ]
        row = standings(race, events, 13)[0]
        self.assertAlmostEqual(row["progress_m"], 40, places=2)
        self.assertEqual(row["rejected_updates"], 3)

    def test_missing_start_and_ambiguous_route_are_unranked(self):
        race = fake_race()
        row = standings(race, [event(race, 1, 220)], 1)[0]
        self.assertIsNone(row["place"])
        # An out-and-back has two spatially identical segments in a wide search.
        course = geometry()
        points = course["points"] + list(reversed(course["points"][:-1]))
        race = fake_race(make_course({"points": points}))
        row = standings(race, [event(race, 0, 0), event(race, 40, 180)], 40)[0]
        self.assertEqual(row["status"], "Ambiguous position")

    def test_loop_requires_full_traversal(self):
        race = fake_race(geometry(True))
        race.settings["laps"] = 2
        length = race.course_snapshot["length_m"]
        events = []
        t = 0
        for lap in range(2):
            for i in range(21):
                events.append(event(race, t, length * i / 20))
                t += 5
        row = standings(race, events, t)[0]
        self.assertAlmostEqual(row["progress_m"], 2 * length, delta=1)
        self.assertEqual(row["lap"], 2)
        self.assertIsNotNone(row["finish_s"])

    def test_manual_finish_preserves_auditable_result(self):
        race = fake_race()
        events = [
            event(race, 0, 0),
            event(
                race,
                60,
                None,
                kind="correction",
                progress_m=race.course_snapshot["length_m"],
                finish_s=55,
                dnf=False,
                reason="Finish line clock",
            ),
        ]
        row = standings(race, events, 60)[0]
        self.assertTrue(row["manual"])
        self.assertEqual(row["finish_s"], 55)


class RaceApiTests(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)
        self.token = self.client.get("/api/health/").json()["csrf_token"]
        self.course = Course.objects.create(name="Trial", geometry=geometry())
        self.status_patch = patch(
            "api.racing.views.receiver.status", return_value={"state": "disconnected"}
        )
        self.status_patch.start()
        self.addCleanup(self.status_patch.stop)

    def post(self, path, data):
        return self.client.post(
            "/api/racing/" + path,
            data=json.dumps(data),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=self.token,
        )

    def create(self, mode="simulation"):
        result = self.post(
            "races/",
            {
                "name": "Trial race",
                "course_id": self.course.pk,
                "mode": mode,
                "interval_s": 5,
                "roster": [
                    {"node_id": "!42", "name": "A"},
                    {"node_id": "!43", "name": "B", "pace_s_mi": 500},
                ],
            },
        )
        self.assertEqual(result.status_code, 201, result.content)
        return result.json()["id"]

    def action(self, id, action, **kwargs):
        return self.post(f"races/{id}/action/", {"action": action, **kwargs})

    def test_simulation_lifecycle_export_replay_and_archive(self):
        id = self.create()
        self.assertEqual(self.action(id, "start").status_code, 400)
        self.assertEqual(self.action(id, "ready").status_code, 200)
        self.assertEqual(self.action(id, "start").status_code, 200)
        self.assertEqual(
            self.post(f"races/{id}/simulate/", {"seconds": 120}).status_code, 200
        )
        current = self.client.get(f"/api/racing/races/{id}/").json()
        self.assertEqual(len(current["standings"]), 2)
        self.assertIsNotNone(current["standings"][0]["finish_s"])
        self.assertEqual(current["standings"][0]["name"], "A")
        self.assertEqual(TrackerPacket.objects.count(), 0)
        replay = self.client.get(f"/api/racing/races/{id}/?at=5").json()
        self.assertEqual(replay["standings"][0]["progress_m"], 0)
        self.assertEqual(self.action(id, "finish").status_code, 200)
        self.assertEqual(
            self.post(f"races/{id}/simulate/", {"seconds": 30}).status_code, 400
        )
        self.assertEqual(self.action(id, "archive").status_code, 200)
        exported = self.client.get(f"/api/racing/races/{id}/export/").json()
        self.assertEqual(len(exported["events"]), 48)
        self.assertEqual(exported["race"]["state"], "archived")

    def test_live_requires_acknowledgment_and_one_running_race(self):
        id = self.create("live")
        self.action(id, "ready")
        self.assertEqual(self.action(id, "start").status_code, 409)
        self.assertEqual(self.action(id, "start", acknowledge=True).status_code, 200)
        second = self.create("live")
        self.action(second, "ready")
        self.assertEqual(
            self.action(second, "start", acknowledge=True).status_code, 400
        )

    def test_reconnect_packets_persist_and_protect_sessions(self):
        id = self.create("live")
        self.action(id, "ready")
        self.action(id, "start", acknowledge=True)
        race = Race.objects.get(pk=id)
        for i in range(2):
            session = TrackerSession.objects.create(status="completed")
            TrackerPacket.objects.create(
                session=session,
                node_id="!42",
                packet_type="POSITION_APP",
                data=point_at(self.course.geometry, i * 10),
            )
        sync_packets(race)
        sync_packets(race)
        self.assertEqual(race.events.count(), 2)
        result = self.client.post(
            f"/api/tracker/sessions/{session.pk}/delete/", HTTP_X_CSRFTOKEN=self.token
        )
        self.assertEqual(result.status_code, 409)
        self.assertEqual(Race.objects.get(pk=id).state, "running")
        other = TrackerPacket.objects.create(
            session=session, node_id="!other", packet_type="POSITION_APP", data={}
        )
        sync_packets(race)
        self.assertEqual(race.events.count(), 2)

    def test_course_csv_round_trip(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        export = self.client.get(f"/api/racing/courses/{self.course.pk}/export/")
        result = self.client.post(
            "/api/racing/courses/import/",
            {"file": SimpleUploadedFile("course.csv", export.content)},
            HTTP_X_CSRFTOKEN=self.token,
        )
        self.assertEqual(result.status_code, 201, result.content)
        self.assertAlmostEqual(
            result.json()["length_m"], self.course.geometry["length_m"]
        )
        self.assertEqual(result.json()["checkpoints"], [100])

    def test_csrf_and_duplicate_roster_validation(self):
        self.assertEqual(self.client.post("/api/racing/races/").status_code, 403)
        result = self.post(
            "races/",
            {
                "name": "Bad",
                "course_id": self.course.pk,
                "roster": [{"node_id": "!42"}, {"node_id": "!42"}],
            },
        )
        self.assertEqual(result.status_code, 400)

    def test_course_snapshot_survives_source_edit(self):
        id = self.create()
        self.course.geometry["points"][0]["latitude"] = 0
        self.course.save()
        self.assertEqual(
            Race.objects.get(pk=id).course_snapshot["points"][0]["latitude"], 42
        )

    def test_correction_rejects_conflicting_finish_and_dnf(self):
        id = self.create()
        self.action(id, "ready")
        self.action(id, "start")
        self.post(f"races/{id}/simulate/", {"seconds": 30})
        result = self.action(
            id,
            "correct",
            node_id="sim-1",
            distance_mi=0,
            finish_s=20,
            dnf=True,
            reason="Review",
        )
        self.assertEqual(result.status_code, 400)
        self.assertFalse(
            RaceEvent.objects.filter(race_id=id, data__kind="correction").exists()
        )
