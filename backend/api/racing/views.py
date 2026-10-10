import csv
import io
import json
import threading
from datetime import timedelta
from functools import wraps

from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST

from api.models import Course, Race, RaceEvent, TrackerPacket
from api.tracker.receiver import receiver
from api.tracker.views import response
from .engine import make_course, number, point_at, standings

LOCK = threading.RLock()


def checked(fn):
    @wraps(fn)
    def wrapped(request, *args, **kwargs):
        try:
            with LOCK:
                return fn(request, *args, **kwargs)
        except (ValueError, TypeError, KeyError, AttributeError) as error:
            return response({"error": str(error) or "Invalid request."}, 400)
        except (Race.DoesNotExist, Course.DoesNotExist):
            return response({"error": "Race or course not found."}, 404)

    return wrapped


def body(request):
    value = json.loads(request.body)
    if not isinstance(value, dict):
        raise ValueError("Send a JSON object.")
    return value


def course_dict(course):
    return {"id": course.pk, "name": course.name, **course.geometry}


def race_dict(race):
    return {
        "id": race.pk,
        "name": race.name,
        "mode": race.mode,
        "state": race.state,
        "course_id": race.course_id,
        "course": race.course_snapshot,
        "roster": race.roster,
        "settings": race.settings,
        "started_at": race.started_at.isoformat() if race.started_at else None,
        "ended_at": race.ended_at.isoformat() if race.ended_at else None,
        "simulation_s": race.simulation_s,
    }


def sync_packets(race):
    """Copy receipts into protected race history, including after process restart."""
    if race.mode != "live" or not race.started_at:
        return
    node_ids = [r["node_id"] for r in race.roster]
    last = (
        race.events.filter(packet__isnull=False)
        .order_by("-packet_id")
        .values_list("packet_id", flat=True)
        .first()
        or 0
    )
    packets = TrackerPacket.objects.filter(
        id__gt=last, node_id__in=node_ids, received_at__gte=race.started_at
    )
    if race.ended_at:
        packets = packets.filter(received_at__lte=race.ended_at)
    RaceEvent.objects.bulk_create(
        [
            RaceEvent(
                race=race,
                packet=p,
                node_id=p.node_id,
                elapsed_s=(p.received_at - race.started_at).total_seconds(),
                data=p.data,
            )
            for p in packets.order_by("id")
        ],
        ignore_conflicts=True,
    )


def protect_captures():
    # Invoked before capture deletion, so even an unviewed race retains its data.
    with LOCK:
        for race in Race.objects.filter(mode="live", started_at__isnull=False):
            sync_packets(race)


def elapsed_time(race):
    if race.mode == "simulation":
        return race.simulation_s
    if not race.started_at:
        return 0
    return max(0, ((race.ended_at or timezone.now()) - race.started_at).total_seconds())


def readiness(race):
    interval = race.settings["interval_s"]
    now = timezone.now()
    result = []
    for runner in race.roster:
        latest = (
            TrackerPacket.objects.filter(node_id=runner["node_id"]).first()
            if race.mode == "live"
            else None
        )
        pos = (
            TrackerPacket.objects.filter(
                node_id=runner["node_id"],
                data__latitude__isnull=False,
                data__longitude__isnull=False,
            ).first()
            if race.mode == "live"
            else None
        )
        recent = (
            latest is not None
            and (now - latest.received_at).total_seconds() <= interval * 3
        )
        gps = (
            pos is not None and (now - pos.received_at).total_seconds() <= interval * 3
        )
        if pos and pos.data.get("gps_fix_at"):
            from datetime import datetime

            try:
                age = (
                    now
                    - datetime.fromisoformat(
                        pos.data["gps_fix_at"].replace("Z", "+00:00")
                    )
                ).total_seconds()
                gps = gps and -5 <= age <= interval * 3
            except (ValueError, TypeError):
                gps = False
        near = False
        if gps:
            from api.csv_import import distance_metres

            try:
                near = (
                    distance_metres(pos.data, race.course_snapshot["points"][0])
                    <= race.settings["tolerance_m"]
                )
            except (TypeError, ValueError):
                gps = False
        result.append(
            {
                **runner,
                "heard_recently": recent,
                "gps_recently": gps,
                "near_start": near,
                "battery_percent": (
                    latest.data.get("battery_percent") if latest else None
                ),
            }
        )
    return result


@require_GET
@checked
def catalog(request):
    nodes = []
    seen = set()
    for packet in TrackerPacket.objects.order_by("-id")[:2000]:
        if packet.node_id not in seen:
            seen.add(packet.node_id)
            nodes.append(
                {
                    "node_id": packet.node_id,
                    "name": packet.data.get("node_name") or packet.node_id,
                }
            )
    return response(
        {
            "courses": [course_dict(c) for c in Course.objects.order_by("-id")],
            "races": [
                {k: v for k, v in race_dict(r).items() if k != "course"}
                for r in Race.objects.order_by("-id")
            ],
            "nodes": nodes,
        }
    )


@require_POST
@checked
def create_course(request):
    data = body(request)
    name = str(data.get("name", "")).strip()[:100]
    if not name:
        raise ValueError("Name the course.")
    course = Course.objects.create(name=name, geometry=make_course(data))
    return response(course_dict(course), 201)


@require_GET
@checked
def export_course(request, course_id):
    course = Course.objects.get(pk=course_id)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "sequence",
            "latitude",
            "longitude",
            "distance_mi",
            "checkpoint",
            "loop",
            "course_name",
        ]
    )
    # Keep checkpoint distances as exact metadata on the first row, rather than
    # rounding them onto a GPS vertex.
    for i, p in enumerate(course.geometry["points"]):
        writer.writerow(
            [
                i,
                p["latitude"],
                p["longitude"],
                p["distance_m"] / 1609.344,
                json.dumps(course.geometry["checkpoints"]) if i == 0 else "",
                int(course.geometry["loop"]),
                course.name,
            ]
        )
    result = HttpResponse(buffer.getvalue(), content_type="text/csv")
    result["Content-Disposition"] = f'attachment; filename="xc-course-{course.pk}.csv"'
    return result


@require_POST
@checked
def import_course(request):
    upload = request.FILES.get("file")
    if not upload or upload.size > 5 * 1024 * 1024:
        raise ValueError("Choose a course CSV smaller than 5 MB.")
    rows = list(csv.DictReader(io.StringIO(upload.read().decode("utf-8-sig"))))
    if not rows or len(rows) > 20000:
        raise ValueError("Course CSV must contain 2–20,000 points.")
    course = Course.objects.create(
        name=str(rows[0].get("course_name") or upload.name)[:100],
        geometry=make_course(
            {
                "points": rows,
                "loop": rows[0].get("loop") == "1",
                "checkpoints": json.loads(rows[0].get("checkpoint") or "[]"),
            }
        ),
    )
    return response(course_dict(course), 201)


def validate_race(data):
    course = Course.objects.get(pk=data.get("course_id"))
    roster = data.get("roster", [])
    if not isinstance(roster, list) or not 1 <= len(roster) <= 200:
        raise ValueError("Assign 1–200 runners.")
    mode = data.get("mode", "live")
    if mode not in {"live", "simulation"}:
        raise ValueError("Choose live or simulation.")
    result = []
    ids = set()
    for i, row in enumerate(roster):
        node_id = str(row.get("node_id", "")).strip().lower()
        if mode == "simulation":
            node_id = f"sim-{i+1}"
        if not node_id or len(node_id) > 80 or node_id in ids:
            raise ValueError("Each runner needs a unique node ID.")
        ids.add(node_id)
        result.append(
            {
                "node_id": node_id,
                "name": str(row.get("name") or f"Runner {i+1}")[:80],
                "bib": str(row.get("bib") or i + 1)[:20],
                "team": str(row.get("team", ""))[:80],
                "pace_s_mi": number(
                    row.get("pace_s_mi", 420 + i * 10), 120, 1800, "simulation pace"
                ),
                "start_offset_s": number(
                    row.get("start_offset_s", 0), 0, 3600, "start offset"
                ),
            }
        )
    laps = int(number(data.get("laps", 1), 1, 50, "laps"))
    if laps > 1 and not course.geometry["loop"]:
        raise ValueError("Multiple laps require a loop course.")
    name = str(data.get("name", "")).strip()[:100]
    if not name:
        raise ValueError("Name the race.")
    return {
        "name": name,
        "course": course,
        "course_snapshot": {"name": course.name, **course.geometry},
        "roster": result,
        "mode": mode,
        "settings": {
            "laps": laps,
            "interval_s": number(data.get("interval_s", 30), 1, 600, "update interval"),
            "tolerance_m": number(
                data.get("tolerance_ft", 100), 10, 1000, "course tolerance in feet"
            )
            * 0.3048,
        },
    }


@require_POST
@checked
def create_race(request):
    race = Race.objects.create(**validate_race(body(request)))
    return response(race_dict(race), 201)


@require_GET
@checked
def race_detail(request, race_id):
    race = Race.objects.get(pk=race_id)
    sync_packets(race)
    elapsed = elapsed_time(race)
    at = number(request.GET.get("at", elapsed), 0, max(0, elapsed), "replay time")
    events = list(race.events.filter(elapsed_s__lte=at))
    rows = standings(race, events, at)
    return response(
        {
            "race": race_dict(race),
            "elapsed_s": elapsed,
            "view_s": at,
            "standings": rows,
            "readiness": readiness(race) if race.state in {"draft", "ready"} else [],
            "receiver": receiver.status(),
            "event_count": len(events),
        }
    )


@require_POST
@checked
def race_action(request, race_id):
    data = body(request)
    race = Race.objects.get(pk=race_id)
    action = data.get("action")
    if action == "update" and race.state in {"draft", "ready"}:
        for key, value in validate_race(data).items():
            setattr(race, key, value)
        race.state = "draft"
    elif action == "ready" and race.state == "draft":
        race.state = "ready"
    elif action == "start" and race.state == "ready":
        if race.mode == "live":
            if (
                Race.objects.filter(mode="live", state="running")
                .exclude(pk=race.pk)
                .exists()
            ):
                raise ValueError("Finish the other live race first.")
            missing = any(
                not r["gps_recently"] or not r["near_start"] for r in readiness(race)
            )
            if (receiver.status()["state"] != "connected" or missing) and not data.get(
                "acknowledge"
            ):
                return response(
                    {
                        "error": "Some trackers are not ready or the receiver is disconnected. Confirm to start anyway.",
                        "needs_confirmation": True,
                    },
                    409,
                )
        countdown = number(data.get("countdown_s", 0), 0, 60, "countdown")
        race.started_at = timezone.now() + timedelta(
            seconds=countdown if race.mode == "live" else 0
        )
        race.state = "running"
    elif action == "finish" and race.state == "running":
        if race.started_at > timezone.now() and race.mode == "live":
            raise ValueError("The countdown has not finished.")
        race.ended_at = timezone.now()
        sync_packets(race)
        race.state = "finished"
    elif action == "archive" and race.state == "finished":
        race.state = "archived"
    elif action == "correct" and race.state in {"running", "finished"}:
        node = data.get("node_id")
        if node not in {r["node_id"] for r in race.roster}:
            raise ValueError("Unknown runner.")
        reason = str(data.get("reason", "")).strip()[:500]
        if not reason:
            raise ValueError("Enter a reason for the correction.")
        total = race.course_snapshot["length_m"] * race.settings["laps"]
        progress = (
            number(data.get("distance_mi"), 0, total / 1609.344, "corrected distance")
            * 1609.344
        )
        finish = data.get("finish_s")
        if finish not in (None, ""):
            if data.get("dnf"):
                raise ValueError(
                    "A runner cannot have both a finish time and DNF status."
                )
            finish = number(finish, 0, elapsed_time(race), "finish seconds")
            progress = total
        else:
            finish = None
        sync_packets(race)
        RaceEvent.objects.create(
            race=race,
            node_id=node,
            elapsed_s=elapsed_time(race),
            data={
                "kind": "correction",
                "progress_m": progress,
                "finish_s": finish,
                "dnf": bool(data.get("dnf")),
                "reason": reason,
            },
        )
    else:
        raise ValueError("This action is unavailable in the current race state.")
    race.save()
    return response(race_dict(race))


@require_POST
@checked
def simulate(request, race_id):
    race = Race.objects.get(pk=race_id)
    if race.mode != "simulation" or race.state != "running":
        raise ValueError("Start a simulation race first.")
    data = body(request)
    seconds = number(data.get("seconds", 30), 1, 300, "simulation advance")
    dropout = set(data.get("dropout", []))
    delay = number(data.get("delay_s", 0), 0, 300, "packet delay")
    jump = data.get("jump_node")
    interval = race.settings["interval_s"]
    end = race.simulation_s + seconds
    tick = int(race.simulation_s // interval) + 1
    events = []
    while tick * interval <= end:
        arrival = tick * interval
        fix_time = max(0, arrival - delay)
        for row in race.roster:
            if row["node_id"] in dropout:
                continue
            traveled = (
                max(0, fix_time - row["start_offset_s"]) * 1609.344 / row["pace_s_mi"]
            )
            length = race.course_snapshot["length_m"]
            total = length * race.settings["laps"]
            # Start at the first position on every simulated capture, allowing
            # the same initial-position validation as physical trackers.
            distance = (
                0 if tick == 1 else (length if traveled >= total else traveled % length)
            )
            position = point_at(race.course_snapshot, distance)
            if row["node_id"] == jump:
                position["latitude"] += 0.01
            events.append(
                RaceEvent(
                    race=race,
                    node_id=row["node_id"],
                    elapsed_s=arrival,
                    data={
                        **position,
                        "packet_id": tick,
                        "gps_fix_at": (
                            race.started_at + timedelta(seconds=fix_time)
                        ).isoformat(),
                        "battery_percent": 90,
                        "raw": {"simulated": True, "delayed_s": delay},
                    },
                )
            )
        tick += 1
    with transaction.atomic():
        RaceEvent.objects.bulk_create(events)
        race.simulation_s = end
        race.save(update_fields=["simulation_s"])
    return response({"elapsed_s": end})


@require_GET
@checked
def export_race(request, race_id):
    race = Race.objects.get(pk=race_id)
    sync_packets(race)
    events = list(race.events.all())
    result = response(
        {
            "schema_version": 1,
            "race": race_dict(race),
            "results": standings(race, events, elapsed_time(race)),
            "events": [
                {
                    "id": e.pk,
                    "packet_id": e.packet_id,
                    "node_id": e.node_id,
                    "elapsed_s": e.elapsed_s,
                    "data": e.data,
                }
                for e in events
            ],
        }
    )
    result["Content-Disposition"] = f'attachment; filename="xc-race-{race.pk}.json"'
    return result
