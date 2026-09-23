export type Sample = {
  source_row: number;
  latitude: number;
  longitude: number;
  timestamp: string | null;
  elapsed_s: number;
  accuracy_m: number | null;
  speed_m_s: number | null;
  derived_speed_m_s: number | null;
  distance_m: number;
  break_before: boolean;
};

export type Recording = {
  id: string;
  name: string;
  demo: boolean;
  filename: string;
  time_basis: "utc" | "elapsed";
  points: Sample[];
  warnings: string[];
  summary: {
    sample_count: number;
    row_count: number;
    skipped_rows: number;
    distance_m: number;
    duration_s: number;
    average_pace_s_km: number | null;
    median_accuracy_m: number | null;
    median_interval_s: number | null;
    started_at: string | null;
  };
};

export function duration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`;
}

export function speed(sample: Sample): number | null {
  return sample.speed_m_s ?? sample.derived_speed_m_s;
}

export function utc(timestamp: string): string {
  return timestamp.replace("T", " ").replace("Z", " UTC");
}
