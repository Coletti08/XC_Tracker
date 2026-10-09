import json

from django.db import transaction
from django.db.models import Count, Q
from django.http import JsonResponse, StreamingHttpResponse
from django.views.decorators.http import require_GET, require_POST

from api.models import TrackerPacket, TrackerSession
from .receiver import ReceiverBusy, available_ports, receiver


def response(data, status=200):
    result = JsonResponse(data, status=status, json_dumps_params={"allow_nan": False})
    result["Cache-Control"] = "no-store"
    return result


@require_GET
def ports(request):
    try:
        return response({"ports": available_ports()})
    except OSError:
        return response({"error": "Could not list serial ports. Check USB permissions."}, 503)


@require_POST
def connect(request):
    try:
        body = json.loads(request.body)
    except (ValueError, UnicodeError):
        return response({"error": "Send a JSON object with a serial port."}, 400)

    port = body.get("port") if isinstance(body, dict) else None
    if not isinstance(port, str) or not port:
        return response({"error": "Choose a USB serial port."}, 400)

    try:
        if port not in {item["device"] for item in available_ports()}:
            return response({"error": "That port is unavailable. Refresh the ports and try again."}, 400)
        return response({"receiver": receiver.connect(port)}, 202)
    except ReceiverBusy as error:
        return response({"error": str(error)}, 409)
    except OSError:
        return response({"error": "Could not access USB serial ports."}, 503)


@require_POST
def disconnect(request):
    return response({"receiver": receiver.disconnect()}, 202)


@require_GET
def packets(request):
    try:
        limit = int(request.GET.get("limit", "100"))
        if not 1 <= limit <= 200:
            raise ValueError
    except ValueError:
        return response({"error": "limit must be between 1 and 200."}, 400)

    # Capture a consistent upper bound while new packets arrive in the background.
    state = receiver.status()
    active = state["state"] in {"connecting", "connected", "stopping"}
    rows = TrackerPacket.objects.filter(session_id=state.get("session_id")) if active else TrackerPacket.objects.none()
    latest = rows.first()
    rows = rows.filter(id__lte=latest.pk) if latest else rows.none()
    summary = rows.aggregate(
        packets=Count("id"),
        devices=Count("node_id", distinct=True),
        positions=Count("id", filter=Q(packet_type="POSITION_APP")),
    )
    summary["last_received_at"] = latest.received_at.isoformat() if latest else None

    return response({
        "receiver": state,
        "summary": summary,
        "packets": [packet.as_dict() for packet in rows[:limit]],
    })


@require_GET
def sessions(request):
    receiver.status()  # Recover unfinished captures after a backend restart.
    rows = TrackerSession.objects.exclude(status="open").annotate(packet_count=Count("packets")).order_by("-id")
    try:
        before = request.GET.get("before")
        if before is not None:
            before = int(before)
            if before < 1:
                raise ValueError
            rows = rows.filter(id__lt=before)
    except ValueError:
        return response({"error": "before must be a positive session ID."}, 400)

    page = list(rows[:21])
    return response({
        "sessions": [session.as_dict() for session in page[:20]],
        "next_before": page[19].pk if len(page) > 20 else None,
    })


@require_GET
def download_session(request, session_id):
    receiver.status()
    session = TrackerSession.objects.annotate(packet_count=Count("packets")).filter(pk=session_id).first()
    if session is None:
        return response({"error": "Session not found."}, 404)
    if session.status == "open":
        return response({"error": "Disconnect and wait for the session to finish saving before downloading."}, 409)

    def content():
        # Closed sessions are immutable. Stream every saved reception, not just
        # the latest rows shown on the live page, and retain original precision.
        metadata = {"schema_version": 1, "session": session.as_dict()}
        yield json.dumps(metadata, allow_nan=False)[:-1] + ', "packets": ['
        separator = ""
        for packet in session.packets.order_by("id").iterator(chunk_size=500):
            yield separator + json.dumps(packet.as_dict(), allow_nan=False)
            separator = ",\n"
        yield "]}\n"

    result = StreamingHttpResponse(content(), content_type="application/json")
    result["Content-Disposition"] = f'attachment; filename="xc-session-{session.pk}.json"'
    result["Cache-Control"] = "no-store"
    return result


@require_POST
def delete_session(request, session_id):
    receiver.status()
    with transaction.atomic():
        session = TrackerSession.objects.filter(pk=session_id).first()
        if session is None:
            return response({"error": "Session not found."}, 404)
        if session.status == "open":
            return response({"error": "An active session cannot be deleted. Disconnect and wait for it to finish saving."}, 409)
        session.packets.all().delete()
        session.delete()
    return response({"deleted": session_id})
