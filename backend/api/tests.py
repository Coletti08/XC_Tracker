"""Regression checks for time conversion, route metrics, and file upload errors."""
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, SimpleTestCase

from .csv_import import ImportError, parse_recording


class ImportTests(SimpleTestCase):
    def parse(self, text):
        return parse_recording(text.encode("utf-8"), "Location.csv")

    def test_sensor_logger_nanoseconds_keep_subsecond_precision(self):
        result = self.parse("time,seconds_elapsed,latitude,longitude,speed,horizontalAccuracy\n"
                            "1700000000000000000,0,0,0,-1,-1\n"
                            "1700000000123456789,.123456789,0,.000001,2,4\n")
        self.assertEqual(result["summary"]["duration_s"], .123456789)
        self.assertEqual(result["summary"]["started_at"], "2023-11-14T22:13:20.000Z")
        self.assertIsNone(result["points"][0]["speed_m_s"])
        self.assertIsNone(result["points"][0]["accuracy_m"])
        self.assertAlmostEqual(result["summary"]["distance_m"], .111, places=3)

    def test_absolute_units_and_iso_offsets(self):
        for first, last in [
            ("1700000000", "1700000001"),
            ("1700000000000", "1700000001000"),
            ("1700000000000000", "1700000001000000"),
            ("2023-11-14T17:13:20-05:00", "2023-11-14T17:13:21-05:00"),
        ]:
            with self.subTest(first=first):
                result = self.parse(f"timestamp,latitude,longitude\n{first},42,-72\n{last},42.00001,-72\n")
                self.assertEqual(result["summary"]["duration_s"], 1)
                self.assertEqual(result["summary"]["started_at"], "2023-11-14T22:13:20.000Z")

    def test_relative_bom_semicolon_and_known_distance(self):
        result = self.parse("\ufeffseconds_elapsed;Latitude;Longitude\n10;0;0\n20;0;0.0001\n")
        self.assertEqual(result["time_basis"], "elapsed")
        self.assertIsNone(result["summary"]["started_at"])
        self.assertEqual(result["summary"]["duration_s"], 10)
        self.assertAlmostEqual(result["summary"]["distance_m"], 11.119, places=3)
        self.assertAlmostEqual(result["summary"]["average_pace_s_km"], 899.32, places=2)

    def test_invalid_rows_sorting_and_duplicates_are_reported(self):
        result = self.parse("seconds_elapsed,latitude,longitude\n"
                            "2,42.00002,-72\n0,42,-72\n1,NaN,-72\n1,91,-72\n2,42,-72\n")
        self.assertEqual(result["summary"]["skipped_rows"], 2)
        self.assertEqual(result["summary"]["sample_count"], 2)
        self.assertEqual(len(result["warnings"]), 3)

    def test_gap_and_jump_are_not_counted_as_distance(self):
        result = self.parse("seconds_elapsed,latitude,longitude\n"
                            "0,42,-72\n1,43,-72\n100,42,-72\n")
        self.assertEqual(result["summary"]["distance_m"], 0)
        self.assertIsNone(result["summary"]["average_pace_s_km"])
        self.assertTrue(all(point["break_before"] for point in result["points"]))
        self.assertEqual(len(result["warnings"]), 2)

    def test_bad_headers_empty_files_and_malformed_csv_fail_clearly(self):
        for text in ["", "time,x,y\n1,2,3\n", "time,time,latitude,longitude\n1,1,2,3",
                     'seconds_elapsed,latitude,longitude\n0,"42,-72\n',
                     "time,latitude,longitude\n2026-09-23T12:00:00,42,-72\n",
                     "seconds_elapsed,latitude,longitude\n1e999999,42,-72\n"]:
            with self.subTest(text=text), self.assertRaises(ImportError):
                self.parse(text)

    def test_missing_optional_values_and_one_point(self):
        result = self.parse('seconds_elapsed,latitude,longitude,speed,horizontalAccuracy,note\n'
                            '0,42,-72,NaN,1e309,"a quoted, comma"\n')
        self.assertEqual(result["summary"]["sample_count"], 1)
        self.assertIsNone(result["points"][0]["speed_m_s"])
        self.assertIsNone(result["points"][0]["accuracy_m"])

    def test_row_limit(self):
        with patch("api.csv_import.MAX_ROWS", 1), self.assertRaises(ImportError):
            self.parse("seconds_elapsed,latitude,longitude\n0,42,-72\n1,42,-72\n")

    def test_endpoint_requires_csrf_and_accepts_valid_multipart(self):
        client = Client(enforce_csrf_checks=True)
        url = "/api/recordings/import/"
        self.assertEqual(client.post(url).status_code, 403)
        health = client.get("/api/health/").json()
        token = health["csrf_token"]
        csv = b"seconds_elapsed,latitude,longitude\n0,42,-72\n1,42.00001,-72\n"
        response = client.post(url, {"file": SimpleUploadedFile("Location.csv", csv)},
                               HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN="http://127.0.0.1:5173",
                               HTTP_HOST="127.0.0.1:8000")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["summary"]["sample_count"], 2)
        self.assertEqual(client.post(url, HTTP_X_CSRFTOKEN=token).status_code, 400)
        response = client.post(url, {"file": SimpleUploadedFile("export.zip", b"PK")}, HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 400)
        with patch("api.views.MAX_BYTES", 2):
            response = client.post(url, {"file": SimpleUploadedFile("large.csv", csv)}, HTTP_X_CSRFTOKEN=token)
            self.assertEqual(response.status_code, 413)
