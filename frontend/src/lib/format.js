const METRES_PER_MILE = 1609.344;
const METRES_PER_FOOT = 0.3048;

// Keep imported and saved measurements in their original units; convert for display.
export function miles(metres) {
  return metres / METRES_PER_MILE;
}

export function feet(metres) {
  return metres == null ? null : metres / METRES_PER_FOOT;
}

export function pacePerMile(secondsPerKm) {
  return secondsPerKm == null ? null : secondsPerKm * METRES_PER_MILE / 1000;
}

export function speedMph(sample) {
  const metresPerSecond = sample.speed_m_s ?? sample.derived_speed_m_s;
  return metresPerSecond == null ? null : metresPerSecond * 3600 / METRES_PER_MILE;
}

export function duration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`;
}

// Round the timestamp before formatting so seconds carry into the next minute/day.
export function utc(timestamp, { includeDate = true } = {}) {
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) return "—";
  const rounded = new Date(Math.round(milliseconds / 1000) * 1000).toISOString();
  const clock = rounded.slice(11, 19);
  return includeDate ? `${rounded.slice(0, 10)} ${clock}` : clock;
}

// API warnings and older saved recordings contain thresholds in metres per second.
export function warningText(message) {
  return message.replace(/(\d+(?:\.\d+)?) m\/s\b/g, (_, value) =>
    `${(Number(value) * 3600 / METRES_PER_MILE).toFixed(1)} mph`);
}
