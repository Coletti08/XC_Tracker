import { useMemo, useRef, useState } from "react";
import Button from "react-bootstrap/Button";

const COLORS = [
  "#216e4e",
  "#be3455",
  "#3557be",
  "#965ac7",
  "#bc6b14",
  "#16848d",
];
export const runnerColor = (i) => COLORS[i % COLORS.length];

export default function RaceMap({
  course,
  runners = [],
  selected,
  onSelect = () => {},
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragging = useRef(null);
  const geometry = useMemo(() => {
    const points = course?.points || [];
    if (!points.length) return null;
    const cos = Math.cos((points[0].latitude * Math.PI) / 180);
    const raw = (p) => ({
      x: (p.longitude - points[0].longitude) * cos,
      y: -(p.latitude - points[0].latitude),
    });
    const all = points.map(raw);
    const xs = all.map((p) => p.x),
      ys = all.map((p) => p.y);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minY = Math.min(...ys),
      maxY = Math.max(...ys);
    const scale = Math.min(
      680 / Math.max(0.0001, maxX - minX),
      410 / Math.max(0.0001, maxY - minY),
    );
    const project = (p) => {
      const q = raw(p);
      return {
        x: 380 + (q.x - (maxX + minX) / 2) * scale,
        y: 250 + (q.y - (maxY + minY) / 2) * scale,
      };
    };
    return { project, points: points.map(project) };
  }, [course]);
  if (!geometry) return null;
  return (
    <div>
      <div className="d-flex justify-content-end gap-2 p-2">
        <Button
          size="sm"
          variant="outline-secondary"
          aria-label="Zoom in"
          onClick={() => setZoom((z) => Math.min(8, z * 1.4))}
        >
          +
        </Button>
        <Button
          size="sm"
          variant="outline-secondary"
          aria-label="Zoom out"
          onClick={() => setZoom((z) => Math.max(1, z / 1.4))}
        >
          −
        </Button>
        <Button
          size="sm"
          variant="outline-secondary"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          Fit course
        </Button>
      </div>
      <svg
        viewBox="0 0 760 500"
        className="race-map"
        role="img"
        aria-label="Race course and latest measured runner positions. North is up."
        onPointerDown={(e) => {
          if (e.target.closest("[data-runner]")) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = { x: e.clientX, y: e.clientY, pan };
        }}
        onPointerUp={() => {
          dragging.current = null;
        }}
        onPointerCancel={() => {
          dragging.current = null;
        }}
        onPointerMove={(e) => {
          if (dragging.current) {
            const s = 760 / e.currentTarget.getBoundingClientRect().width;
            setPan({
              x: dragging.current.pan.x + (e.clientX - dragging.current.x) * s,
              y: dragging.current.pan.y + (e.clientY - dragging.current.y) * s,
            });
          }
        }}
      >
        <rect width="760" height="500" fill="#f1f5ed" />
        <text x="720" y="30" fill="#50634e">
          N ↑
        </text>
        <g
          transform={`translate(${pan.x + 380} ${pan.y + 250}) scale(${zoom}) translate(-380 -250)`}
        >
          <polyline
            points={geometry.points.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="#c5d6bc"
            strokeWidth="12"
            strokeLinejoin="round"
          />
          <polyline
            points={geometry.points.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="#4c7352"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          {(course.checkpoints || []).map((d, i) => {
            const index = course.points.findIndex((p) => p.distance_m >= d);
            const p = geometry.points[Math.max(0, index)];
            return (
              <g key={i}>
                <circle
                  {...{ cx: p.x, cy: p.y }}
                  r="7"
                  fill="#fff"
                  stroke="#957128"
                />
                <text x={p.x + 10} y={p.y - 8} fontSize="12">
                  CP {i + 1}
                </text>
              </g>
            );
          })}
          {[0, geometry.points.length - 1].map((index, i) => {
            const p = geometry.points[index];
            return (
              <g key={i}>
                <rect
                  x={p.x - 5}
                  y={p.y - 5}
                  width="10"
                  height="10"
                  fill={i ? "#a05432" : "#226044"}
                />
                <text x={p.x + 9} y={p.y + (i ? 18 : -9)} fontSize="12">
                  {i ? "Finish" : "Start"}
                </text>
              </g>
            );
          })}
          {runners.map((r, i) => {
            if (!r.position) return null;
            const p = geometry.project(r.position);
            return (
              <g
                key={r.node_id}
                data-runner="true"
                role="button"
                tabIndex="0"
                aria-label={`Select ${r.name}`}
                onClick={() => onSelect(r.node_id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSelect(r.node_id);
                }}
                style={{ cursor: "pointer" }}
                opacity={r.gps_recently ? 1 : 0.45}
              >
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={selected === r.node_id ? 11 : 7}
                  fill={runnerColor(r.color_index ?? i)}
                  stroke="white"
                  strokeWidth="2"
                />
                <text x={p.x + 12} y={p.y - 10} fontSize="13" fill="#182f25">
                  {r.bib}
                </text>
                <title>
                  {r.name} · {r.status}
                </title>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
