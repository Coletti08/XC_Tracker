import json

from django.db.models import Count, Q
from django.http import JsonResponse
from django.views.decorators.http import require_GET, require_POST

from api.models import TrackerPacket
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
    latest = TrackerPacket.objects.first()
    rows = TrackerPacket.objects.filter(id__lte=latest.pk) if latest else TrackerPacket.objects.none()
    summary = rows.aggregate(
        packets=Count("id"),
        devices=Count("node_id", distinct=True),
        positions=Count("id", filter=Q(packet_type="POSITION_APP")),
    )
    summary["last_received_at"] = latest.received_at.isoformat() if latest else None

    return response({
        "receiver": receiver.status(),
        "summary": summary,
        "packets": [packet.as_dict() for packet in rows[:limit]],
    })
