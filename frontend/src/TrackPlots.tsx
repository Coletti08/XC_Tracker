import { useId, useMemo } from "react";
import { duration, speed, type Sample } from "./types";

export function RoutePlot({ points, selected }: { points: Sample[]; selected: number }) {
  const gridId = useId();
  const geometry = useMemo(() => {
    const origin = points[0];
    const longitudeScale = Math.max(0.001, Math.cos(origin.latitude * Math.PI / 180));
    const projected = points.map((point) => ({
      x: (((point.longitude - origin.longitude + 540) % 360) - 180) * 111195 * longitudeScale,
      y: -(point.latitude - origin.latitude) * 111195,
    }));
    const bounds = projected.reduce((box, point) => ({
      minX: Math.min(box.minX, point.x), maxX: Math.max(box.maxX, point.x),
      minY: Math.min(box.minY, point.y), maxY: Math.max(box.maxY, point.y),
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    const scale = Math.min(680 / Math.max(40, bounds.maxX - bounds.minX), 250 / Math.max(40, bounds.maxY - bounds.minY));
    const positions = projected.map((point) => ({
      x: 400 + (point.x - (bounds.minX + bounds.maxX) / 2) * scale,
      y: 180 + (point.y - (bounds.minY + bounds.maxY) / 2) * scale,
    }));
    const path = positions.map((point, index) => `${points[index].break_before ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
    return { positions, path };
  }, [points]);
  const first = geometry.positions[0];
  const last = geometry.positions[geometry.positions.length - 1];
  const current = geometry.positions[selected];
  return (
    <svg className="route-plot" viewBox="0 0 800 360" role="img" aria-label={`GPS route with ${points.length} samples. Selected sample ${selected + 1}. North is up.`}>
      <defs>
        <pattern id={gridId} width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#dde5da" strokeWidth="0.6" />
        </pattern>
      </defs>
      <rect width="800" height="360" fill="#f4f7ef" />
      <rect width="800" height="360" fill={`url(#${gridId})`} />
      <text x="767" y="27" textAnchor="middle" className="plot-label">N</text>
      <path d="M767 38 L767 65 M761 45 L767 38 L773 45" fill="none" stroke="#6d806a" strokeWidth="1.5" />
      <path d={geometry.path} fill="none" stroke="#d3dec9" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
      <path d={geometry.path} fill="none" stroke="#34704f" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={first.x} cy={first.y} r="7" fill="#fff" stroke="#34704f" strokeWidth="3" />
      <rect x={last.x - 6} y={last.y - 6} width="12" height="12" rx="2" fill="#a16639" stroke="#fff" strokeWidth="2" />
      <circle cx={current.x} cy={current.y} r="14" fill="#163e32" opacity="0.12" />
      <circle cx={current.x} cy={current.y} r="6" fill="#163e32" stroke="white" strokeWidth="2.5" />
      <text x="22" y="338" className="plot-label">Local route view · north up</text>
    </svg>
  );
}

export function SpeedPlot({ points, selected }: { points: Sample[]; selected: number }) {
  const graph = useMemo(() => {
    const speeds = points.map(speed);
    const max = Math.max(1, ...speeds.map((value) => value ?? 0));
    const total = points[points.length - 1].elapsed_s || 1;
    let penDown = false;
    const path = points.map((point, index) => {
      const value = speeds[index];
      if (value === null) { penDown = false; return ""; }
      const command = penDown && !point.break_before ? "L" : "M";
      penDown = true;
      return `${command}${(48 + point.elapsed_s / total * 724).toFixed(2)},${(116 - value / max * 92).toFixed(2)}`;
    }).join(" ");
    return { max, total, path, hasSpeed: speeds.some((value) => value !== null) };
  }, [points]);
  const value = speed(points[selected]);
  const x = 48 + points[selected].elapsed_s / graph.total * 724;
  if (!graph.hasSpeed) return <p className="chart-empty">There are not enough samples to show speed.</p>;
  return (
    <svg className="speed-plot" viewBox="0 0 800 150" role="img" aria-label="Speed in metres per second over elapsed time">
      {[0, 0.5, 1].map((fraction) => <g key={fraction}>
        <line x1="48" y1={116 - 92 * fraction} x2="772" y2={116 - 92 * fraction} stroke="#e4e9e1" />
        <text x="38" y={120 - 92 * fraction} textAnchor="end" className="plot-label">{(graph.max * fraction).toFixed(1)}</text>
      </g>)}
      <path d={graph.path} fill="none" stroke="#34704f" strokeWidth="2" strokeLinejoin="round" />
      <line x1={x} y1="18" x2={x} y2="116" stroke="#a16639" strokeDasharray="4 3" />
      {value !== null && <circle cx={x} cy={116 - value / graph.max * 92} r="4" fill="#163e32" />}
      <text x="48" y="139" className="plot-label">0:00</text>
      <text x="772" y="139" textAnchor="end" className="plot-label">{duration(points[points.length - 1].elapsed_s)}</text>
    </svg>
  );
}
