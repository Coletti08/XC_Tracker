import assert from "node:assert/strict";
import test from "node:test";
import { duration, feet, miles, pacePerMile, speedMph, utc, warningText } from "./format.js";

test("distance and pace convert to miles, with missing values preserved", () => {
  assert.equal(miles(1609.344), 1);
  assert.equal(miles(5000).toFixed(2), "3.11");
  assert.equal(duration(pacePerMile(300)), "8:03");
  assert.equal(pacePerMile(null), null);
  assert.equal(feet(3.048).toFixed(1), "10.0");
  assert.equal(feet(null), null);
});

test("reported and estimated speeds use mph, preserving zero and unknown speed", () => {
  assert.equal(speedMph({ speed_m_s: 4.4704, derived_speed_m_s: 2 }).toFixed(2), "10.00");
  assert.equal(speedMph({ speed_m_s: null, derived_speed_m_s: 4.4704 }).toFixed(2), "10.00");
  assert.equal(speedMph({ speed_m_s: 0, derived_speed_m_s: 4.4704 }), 0);
  assert.equal(speedMph({ speed_m_s: null, derived_speed_m_s: null }), null);
});

test("durations round to whole seconds including minute and hour boundaries", () => {
  assert.equal(duration(0.49), "0:00");
  assert.equal(duration(0.5), "0:01");
  assert.equal(duration(59.5), "1:00");
  assert.equal(duration(3599.5), "1:00:00");
});

test("GPS clock hides the date, rounds seconds, and handles UTC midnight", () => {
  assert.equal(utc("2026-09-23T12:34:56.499Z", { includeDate: false }), "12:34:56");
  assert.equal(utc("2026-09-23T12:34:56.500Z", { includeDate: false }), "12:34:57");
  assert.equal(utc("2026-09-23T23:59:59.750Z", { includeDate: false }), "00:00:00");
  assert.equal(utc("2026-09-23T23:59:59.750Z"), "2026-09-24 00:00:00");
  assert.equal(utc("2026-09-23T08:30:59.700-04:00", { includeDate: false }), "12:31:00");
  assert.equal(utc(null), "—");
});

test("saved metric warnings display their thresholds in mph", () => {
  assert.equal(warningText("1 jumps above 15 m/s were excluded."), "1 jumps above 33.6 mph were excluded.");
  assert.equal(warningText("Samples were sorted by timestamp."), "Samples were sorted by timestamp.");
});
