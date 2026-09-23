"""Convert GPS CSV recordings into validated samples for the local viewer.

Sensor Logger units: https://github.com/tszheichoi/awesome-sensor-logger/blob/main/UNITS.md
No files or recordings are retained by this endpoint.
"""
import csv
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import io
import math
import re
from statistics import median

MAX_BYTES = 10 * 1024 * 1024
MAX_ROWS = 20_000
GAP_SECONDS = 30
JUMP_SPEED_M_S = 15


class ImportError(ValueError):
    """An error that can be shown directly to the person importing a file."""


def normalise_header(value):
    return re.sub(r"[^a-z0-9]", "", value.strip().lower())


def optional_number(value, maximum):
    try:
        number = float(value)
        return number if math.isfinite(number) and 0 <= number <= maximum else None
    except (TypeError, ValueError):
        return None


def parse_time(value, relative):
    """Use Decimal before subtracting timestamps to retain nanosecond precision."""
    value = value.strip()
    try:
        number = Decimal(value)
    except InvalidOperation:
        if relative:
            raise ValueError("Elapsed time must be numeric.")
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            raise ValueError("ISO timestamps need Z or a UTC offset.")
        if not 1973 <= dt.year <= 2999:
            raise ValueError("Timestamp is outside the supported date range.")
        return Decimal(str(dt.timestamp()))
    if not number.is_finite() or not 0 <= number <= Decimal("1e21"):
        raise ValueError("Invalid timestamp.")
    if relative:
        if number > 31_536_000:
            raise ValueError("Elapsed time must be within a year.")
        return number
    if number >= Decimal("1e17"):
        number /= Decimal("1e9")
    elif number >= Decimal("1e14"):
        number /= Decimal("1e6")
    elif number >= Decimal("1e11"):
        number /= Decimal("1e3")
    # A small counter is ambiguous. Relative seconds have their own column.
    if not Decimal("1e8") <= number <= Decimal("32503680000"):
        raise ValueError("Use seconds_elapsed for relative time.")
    return number


def distance_metres(a, b):
    lat1, lat2 = math.radians(a["latitude"]), math.radians(b["latitude"])
    delta_lat = lat2 - lat1
    delta_lon = math.radians(b["longitude"] - a["longitude"])
    h = math.sin(delta_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    return 6_371_000 * 2 * math.asin(math.sqrt(min(1, h)))


def parse_recording(raw, filename):
    if len(raw) > MAX_BYTES:
        raise ImportError("This file is too large. Use a CSV smaller than 10 MB.")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ImportError("Use a UTF-8 CSV file. Unzip the Sensor Logger export and choose Location.csv.")
    if not text.strip():
        raise ImportError("This CSV is empty.")
    if "\x00" in text:
        raise ImportError("This does not look like a UTF-8 CSV file.")
    try:
        dialect = csv.Sniffer().sniff(text[:8192], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text, newline=""), dialect=dialect, strict=True)
    try:
        headers = reader.fieldnames or []
    except csv.Error:
        raise ImportError("The CSV header could not be read. Export the file again as CSV.")
    names = [normalise_header(header) for header in headers]
    if len(set(names)) != len(names):
        raise ImportError("The CSV contains duplicate column names.")
    columns = dict(zip(names, headers))

    def column(*aliases):
        return next((columns[name] for name in aliases if name in columns), None)

    lat_col = column("latitude", "lat")
    lon_col = column("longitude", "lon", "lng")
    time_col = column("time", "timestamputc", "timestamp", "datetime")
    relative = time_col is None
    if relative:
        time_col = column("secondselapsed", "elapsedseconds", "elapseds")
    if not lat_col or not lon_col or not time_col:
        raise ImportError("Choose Location.csv from your Sensor Logger export. Required columns: latitude, longitude, and time (or seconds_elapsed).")
    accuracy_col = column("horizontalaccuracy", "accuracym", "accuracy")
    speed_col = column("speed", "speedms", "speedmps")
    points, invalid_rows = [], []
    count = 0
    try:
        for count, row in enumerate(reader, start=1):
            if count > MAX_ROWS:
                raise ImportError("This CSV has more than 20,000 rows. Import a shorter recording.")
            try:
                if None in row:
                    raise ValueError("Extra fields.")
                lat, lon = float(row[lat_col]), float(row[lon_col])
                if not math.isfinite(lat) or not math.isfinite(lon) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
                    raise ValueError("Invalid coordinates.")
                timestamp = parse_time(row[time_col], relative)
                points.append({
                    "_time": timestamp,
                    "source_row": count + 1,
                    "latitude": lat,
                    "longitude": lon,
                    "accuracy_m": optional_number(row.get(accuracy_col), 20_000_000),
                    "speed_m_s": optional_number(row.get(speed_col), 1_000),
                })
            except (ValueError, TypeError, AttributeError, OverflowError):
                invalid_rows.append(count + 1)
    except csv.Error:
        raise ImportError("Malformed CSV quoting or an oversized field. Export the recording again as CSV.")
    if not points:
        raise ImportError("No valid GPS samples were found. Check latitude/longitude and timestamps. Numeric time can use Unix seconds, milliseconds, microseconds, or nanoseconds; ISO time needs Z or a UTC offset. Use seconds_elapsed for relative seconds.")

    reordered = any(a["_time"] > b["_time"] for a, b in zip(points, points[1:]))
    points.sort(key=lambda point: point["_time"])
    unique = []
    for point in points:
        if not unique or point["_time"] != unique[-1]["_time"]:
            unique.append(point)
    duplicates = len(points) - len(unique)
    points = unique
    first = points[0]["_time"]
    total_distance = 0.0
    gaps = jumps = 0
    intervals = []
    for index, point in enumerate(points):
        point["elapsed_s"] = float(point["_time"] - first)
        point["timestamp"] = None if relative else datetime.fromtimestamp(float(point["_time"]), timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        point["break_before"] = index == 0
        point["derived_speed_m_s"] = None
        if index:
            previous = points[index - 1]
            interval = point["elapsed_s"] - previous["elapsed_s"]
            distance = distance_metres(previous, point)
            intervals.append(interval)
            if interval > GAP_SECONDS:
                gaps += 1
                point["break_before"] = True
            elif interval <= 0 or distance / interval > JUMP_SPEED_M_S:
                jumps += 1
                point["break_before"] = True
            else:
                total_distance += distance
                point["derived_speed_m_s"] = distance / interval
        point["distance_m"] = round(total_distance, 3)
    for point in points:
        del point["_time"]

    duration = points[-1]["elapsed_s"]
    accuracies = [point["accuracy_m"] for point in points if point["accuracy_m"] is not None]
    warnings = []
    if invalid_rows:
        examples = ", ".join(map(str, invalid_rows[:5]))
        warnings.append(f"Skipped {len(invalid_rows)} invalid rows (row numbers: {examples}{'…' if len(invalid_rows) > 5 else ''}).")
    if reordered:
        warnings.append("Samples were sorted by timestamp.")
    if duplicates:
        warnings.append(f"Removed {duplicates} duplicate timestamps, keeping the first sample at each time.")
    if gaps:
        warnings.append(f"{gaps} gaps longer than {GAP_SECONDS} seconds were excluded from the route line and distance.")
    if jumps:
        warnings.append(f"{jumps} jumps above {JUMP_SPEED_M_S} m/s were excluded from the route line and distance. Their GPS samples remain in the table.")
    if len(points) == 1:
        warnings.append("Only one valid sample: distance, duration, and pace cannot be estimated.")
    return {
        "filename": filename,
        "time_basis": "elapsed" if relative else "utc",
        "points": points,
        "warnings": warnings,
        "summary": {
            "sample_count": len(points),
            "row_count": count,
            "skipped_rows": len(invalid_rows),
            "distance_m": round(total_distance, 3),
            "duration_s": duration,
            "average_pace_s_km": duration / (total_distance / 1000) if total_distance > 1 and duration > 0 else None,
            "median_accuracy_m": median(accuracies) if accuracies else None,
            "median_interval_s": median(intervals) if intervals else None,
            "started_at": points[0]["timestamp"],
        },
    }
