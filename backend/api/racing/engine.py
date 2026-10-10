"""Deterministic course matching shared by live tracking, simulation, and replay.

All calculations use SI units. A displayed place is provisional, never a
substitute for finish-line timing. Uncertain fixes retain the last good progress.
"""

import bisect
import math
from datetime import datetime
from api.csv_import import distance_metres


def number(value, low, high, label):
    if isinstance(value, bool):
        raise ValueError(f"Invalid {label}.")
    try:
        value = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"Invalid {label}.")
    if not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f"{label} must be between {low} and {high}.")
    return value


def make_course(body):
    points = body.get("points", [])
    if not isinstance(points, list) or not 2 <= len(points) <= 20000:
        raise ValueError("A course needs 2–20,000 ordered GPS points.")
    clean = []
    for index, point in enumerate(points):
        if not isinstance(point, dict):
            raise ValueError("Invalid course point.")
        if index and point.get("break_before"):
            raise ValueError(
                "This selection has GPS gaps. Trim to a continuous section before saving."
            )
        p = {
            "latitude": number(point.get("latitude"), -90, 90, "latitude"),
            "longitude": number(point.get("longitude"), -180, 180, "longitude"),
        }
        if not clean or distance_metres(clean[-1], p) >= 0.5:
            clean.append(p)
    if len(clean) < 2:
        raise ValueError("The route is too short.")
    loop = bool(body.get("loop"))
    if loop:
        gap = distance_metres(clean[-1], clean[0])
        if gap > 50:
            raise ValueError(
                "Loop start and finish must be within 164 ft. Trim the route or use a single route."
            )
        if gap > 0.01:
            clean.append(dict(clean[0]))
    total = 0
    for i, p in enumerate(clean):
        if i:
            total += distance_metres(clean[i - 1], p)
        p["distance_m"] = total
    if total < 30:
        raise ValueError("Course must be at least 98 ft long.")
    checkpoints = sorted(
        set(
            number(x, 1, total - 1, "checkpoint distance")
            for x in body.get("checkpoints", [])
        )
    )
    warnings = []
    # Sample nonadjacent sections; this is a prompt for review, not proof that
    # an arbitrary route has no self-intersections or parallel trail ambiguity.
    stride = max(1, len(clean) // 250)
    sampled = clean[::stride]
    for i, a in enumerate(sampled):
        if any(
            abs(a["distance_m"] - b["distance_m"]) > 100 and distance_metres(a, b) < 20
            for b in sampled[i + 1 :]
        ):
            warnings.append(
                "Nearby nonadjacent route sections detected. Review checkpoints at crossings and turnarounds."
            )
            break
    return {
        "points": clean,
        "length_m": total,
        "loop": loop,
        "checkpoints": checkpoints,
        "warnings": warnings,
    }


def point_at(course, distance):
    points = course["points"]
    distances = [p["distance_m"] for p in points]
    i = max(1, min(len(points) - 1, bisect.bisect_left(distances, distance)))
    a, b = points[i - 1], points[i]
    fraction = max(
        0, min(1, (distance - a["distance_m"]) / (b["distance_m"] - a["distance_m"]))
    )
    return {
        key: a[key] + fraction * (b[key] - a[key]) for key in ("latitude", "longitude")
    }


def candidates(course, fix, low, high):
    origin = course["points"][0]
    scale = math.cos(math.radians(origin["latitude"]))

    def xy(p):
        return (
            (p["longitude"] - origin["longitude"]) * 111195 * scale,
            (p["latitude"] - origin["latitude"]) * 111195,
        )

    x, y = xy(fix)
    result = []
    for a, b in zip(course["points"], course["points"][1:]):
        if b["distance_m"] < low or a["distance_m"] > high:
            continue
        ax, ay = xy(a)
        bx, by = xy(b)
        dx, dy = bx - ax, by - ay
        size = dx * dx + dy * dy
        fraction = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / size)) if size else 0
        progress = a["distance_m"] + fraction * (b["distance_m"] - a["distance_m"])
        result.append(
            (math.hypot(x - ax - fraction * dx, y - ay - fraction * dy), progress)
        )
    return sorted(result)


def standings(race, events, elapsed):
    course = race.course_snapshot
    length = course["length_m"]
    laps = race.settings["laps"]
    total = length * laps
    interval = race.settings["interval_s"]
    tolerance = race.settings["tolerance_m"]
    gates = [
        lap * length + d
        for lap in range(laps)
        for d in course["checkpoints"] + [length]
    ]
    runners = {
        r["node_id"]: {
            **r,
            "progress_m": None,
            "lap": 1,
            "last_heard_s": None,
            "last_position_s": None,
            "last_fix_s": None,
            "position": None,
            "status": "No position",
            "finish_s": None,
            "splits": [],
            "trace": [],
            "battery_percent": None,
            "manual": False,
            "rejected_updates": 0,
            "_seen": set(),
        }
        for r in race.roster
    }
    for event in events:
        if event.elapsed_s > elapsed or event.node_id not in runners:
            continue
        row = runners[event.node_id]
        data = event.data
        if data.get("kind") == "correction":
            row["manual"] = True
            row["progress_m"] = data["progress_m"]
            row["finish_s"] = data.get("finish_s")
            row["status"] = "DNF" if data.get("dnf") else "Manual correction"
            row["last_fix_s"] = event.elapsed_s
            row["splits"] = []  # Do not invent times for manually skipped gates.
            row["trace"] = [(event.elapsed_s, data["progress_m"])]
            continue
        row["last_heard_s"] = event.elapsed_s
        if data.get("battery_percent") is not None:
            row["battery_percent"] = data["battery_percent"]
        try:
            fix = {
                k: number(
                    data.get(k),
                    -90 if k == "latitude" else -180,
                    90 if k == "latitude" else 180,
                    k,
                )
                for k in ("latitude", "longitude")
            }
        except ValueError:
            continue
        # Prefer GPS solution time when present; never interpret a device clock
        # alone as a fresh fix. Receipt time is an explicitly weaker fallback.
        fix_s = event.elapsed_s
        stamp = data.get("gps_fix_at")
        if stamp and race.started_at:
            try:
                fix_s = (
                    datetime.fromisoformat(stamp.replace("Z", "+00:00"))
                    - race.started_at
                ).total_seconds()
            except (ValueError, TypeError):
                row["rejected_updates"] += 1
                continue
        identity = (data.get("packet_id"), stamp)
        if (
            (identity[0] is not None and identity in row["_seen"])
            or fix_s < 0
            or fix_s > event.elapsed_s + 5
            or event.elapsed_s - fix_s > max(60, interval * 3)
        ):
            row["rejected_updates"] += 1
            continue
        if identity[0] is not None:
            row["_seen"].add(identity)
        if row["last_fix_s"] is not None and fix_s <= row["last_fix_s"]:
            row["rejected_updates"] += 1
            continue
        row["last_position_s"] = fix_s
        row["position"] = fix
        if row["finish_s"] is not None or row["status"] == "DNF":
            continue
        previous = row["progress_m"]
        dt = fix_s - (row["last_fix_s"] if row["last_fix_s"] is not None else 0)
        base_lap = min(laps - 1, int((previous or 0) / length))
        local = (previous or 0) - base_lap * length
        # If the last fix reached a lap end, the next search begins on the next lap.
        high = (
            min(length, local + 15 * min(dt, 120) + tolerance)
            if previous is not None
            else min(length, 100)
        )
        options = candidates(course, fix, max(0, local - 30), high)
        if not options or options[0][0] > tolerance:
            row["status"] = "Off course / GPS jump"
            row["rejected_updates"] += 1
            continue
        near = [x for x in options if x[0] <= options[0][0] + 5]
        if any(abs(x[1] - options[0][1]) > max(60, tolerance * 2) for x in near):
            row["status"] = "Ambiguous position"
            row["rejected_updates"] += 1
            continue
        progress = base_lap * length + options[0][1]
        if previous is not None and progress - previous > 15 * dt + tolerance:
            row["status"] = "GPS jump"
            row["rejected_updates"] += 1
            continue
        # End proximity alone is insufficient: require traversal of the final
        # section. End times remain estimates (a tolerance gate, not chip timing).
        end = (base_lap + 1) * length
        if (
            end - progress <= min(10, length * 0.02)
            and previous is not None
            and previous >= base_lap * length + length * 0.8
        ):
            progress = end
        progress = max(previous or 0, progress)
        crossed = [g for g in gates if (previous or 0) < g <= progress]
        if dt > max(60, interval * 3) and crossed:
            row["status"] = "Checkpoint crossing uncertain"
            row["rejected_updates"] += 1
            continue
        for gate in crossed:
            crossing = None
            if (
                previous is not None
                and dt <= max(60, interval * 2)
                and progress > previous
            ):
                crossing = row["last_fix_s"] + dt * (gate - previous) / (
                    progress - previous
                )
            row["splits"].append(
                {"distance_m": gate, "elapsed_s": crossing, "estimated": True}
            )
        row["progress_m"] = min(total, progress)
        row["last_fix_s"] = fix_s
        row["trace"].append((fix_s, row["progress_m"]))
        row["status"] = "Tracking"
        if progress >= total:
            row["finish_s"] = row["splits"][-1]["elapsed_s"] if row["splits"] else None
            row["status"] = (
                "Finished (estimated)"
                if row["finish_s"] is not None
                else "Finish uncertain"
            )
    rows = list(runners.values())
    rows.sort(
        key=lambda r: (
            r["status"] == "DNF",
            r["finish_s"] is None,
            (
                r["finish_s"]
                if r["finish_s"] is not None
                else -(r["progress_m"] if r["progress_m"] is not None else -1)
            ),
        )
    )
    leader = next(
        (r for r in rows if r["progress_m"] is not None and r["status"] != "DNF"), None
    )
    for index, row in enumerate(rows):
        row.pop("_seen")
        row["place"] = (
            index + 1
            if row["progress_m"] is not None and row["status"] != "DNF"
            else None
        )
        row["heard_recently"] = (
            row["last_heard_s"] is not None
            and elapsed - row["last_heard_s"] <= interval * 3
        )
        row["gps_recently"] = (
            row["last_position_s"] is not None
            and elapsed - row["last_position_s"] <= interval * 3
        )
        row["age_s"] = (
            max(0, elapsed - row["last_position_s"])
            if row["last_position_s"] is not None
            else None
        )
        row["lap"] = min(laps, int((row["progress_m"] or 0) / length) + 1)
        row["remaining_m"] = (
            max(0, total - row["progress_m"]) if row["progress_m"] is not None else None
        )
        row["gap_m"] = (
            max(0, leader["progress_m"] - row["progress_m"])
            if leader and row["progress_m"] is not None
            else None
        )
        row["gap_s"] = None
        if (
            leader
            and row is not leader
            and row["progress_m"] is not None
            and row["trace"]
        ):
            for a, b in zip(leader["trace"], leader["trace"][1:]):
                if (
                    a[1] <= row["progress_m"] <= b[1]
                    and b[1] > a[1]
                    and b[0] - a[0] <= max(60, interval * 2)
                ):
                    leader_time = a[0] + (b[0] - a[0]) * (row["progress_m"] - a[1]) / (
                        b[1] - a[1]
                    )
                    row["gap_s"] = max(0, row["trace"][-1][0] - leader_time)
                    break
        if row["status"] == "Tracking" and not row["gps_recently"]:
            row["status"] = "Stale position"
    for row in rows:
        row.pop("trace")
    return rows
