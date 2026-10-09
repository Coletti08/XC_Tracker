"""Normalize Meshtastic events without filling missing fields from stale node data."""

import base64
from datetime import datetime, timedelta, timezone
import math

from google.protobuf.json_format import MessageToDict
from google.protobuf.message import Message


def json_safe(value):
    if isinstance(value, Message):
        return json_safe(MessageToDict(value))

    if isinstance(value, (bytes, bytearray)):
        return {"encoding": "base64", "data": base64.b64encode(value).decode("ascii")}

    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}

    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]

    if isinstance(value, float) and not math.isfinite(value):
        return None

    if value is None or isinstance(value, (str, int, float, bool)):
        return value

    return str(value)


def number(value, minimum=None, maximum=None):
    if isinstance(value, bool) or value is None:
        return None

    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError):
        return None

    if not math.isfinite(result):
        return None
    if minimum is not None and result < minimum:
        return None
    if maximum is not None and result > maximum:
        return None

    return result


def epoch_time(seconds, adjustment_ms=0):
    seconds = number(seconds, minimum=1)
    if seconds is None:
        return None

    try:
        value = datetime.fromtimestamp(seconds, tz=timezone.utc)
        value += timedelta(milliseconds=number(adjustment_ms) or 0)
        return value.isoformat()
    except (ValueError, OverflowError, OSError):
        return None


def coordinate(position, integer_key, decimal_key, limit):
    if integer_key in position:
        value = number(position[integer_key])
        value = value / 10_000_000 if value is not None else None
    else:
        value = number(position.get(decimal_key))

    return number(value, -limit, limit)


def normalize_packet(packet, interface):
    decoded = packet.get("decoded") or {}
    position = decoded.get("position") or {}
    metrics = (decoded.get("telemetry") or {}).get("deviceMetrics") or {}
    sender = packet.get("from")
    node_id = packet.get("fromId")

    if not node_id:
        node_id = f"!{sender:08x}" if isinstance(sender, int) else "unknown"

    # Names may come from the node cache. Measurements always come from this packet.
    node = (getattr(interface, "nodesByNum", None) or {}).get(sender) or {}
    user = decoded.get("user") or node.get("user") or {}
    battery = number(metrics.get("batteryLevel"), 0, 101)
    speed_kmh = number(position.get("groundSpeed"), minimum=0)
    port = decoded.get("portnum")
    packet_type = str(port) if port is not None else "ENCRYPTED" if "encrypted" in packet else "UNKNOWN"

    return {
        "node_id": str(node_id)[:80],
        "packet_type": packet_type[:80],
        "data": {
            "node_name": user.get("longName") or user.get("shortName") or None,
            "packet_id": packet.get("id"),
            "channel": packet.get("channel"),
            "latitude": coordinate(position, "latitudeI", "latitude", 90),
            "longitude": coordinate(position, "longitudeI", "longitude", 180),
            "altitude_m": number(position.get("altitude")),
            # Meshtastic's ground_speed field is km/h, not metres per second.
            "speed_m_s": speed_kmh / 3.6 if speed_kmh is not None else None,
            "gps_fix_at": epoch_time(position.get("timestamp"), position.get("timestampMillisAdjust")),
            "device_time": epoch_time(position.get("time")),
            "radio_received_at": epoch_time(packet.get("rxTime")),
            "satellites": number(position.get("satsInView"), minimum=0),
            "battery_percent": battery if battery is not None and battery <= 100 else None,
            "external_power": battery == 101,
            "voltage": number(metrics.get("voltage"), minimum=0),
            "rssi": number(packet.get("rxRssi")),
            "snr": number(packet.get("rxSnr")),
            "text": decoded.get("text"),
            "raw": json_safe(packet),
        },
    }
