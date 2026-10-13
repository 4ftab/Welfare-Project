import { useEffect, useRef, useState } from "react";
import { compactMoney, money, monthLabel } from "../api";

const CHART_COLORS = ["#087f5b", "#3b82f6", "#f5b942", "#12a89d", "#8b5cf6", "#ef6b6b"];

/** Grouped bar chart: donations vs expenses per month. */
export function TrendChart({ series, labels }) {
  const height = 190;
  const max = Math.max(1, ...series.flatMap((s) => [s.donations, s.expenses]));
  const barW = 16;
  const groupW = 70;
  const width = series.length * groupW + 10;

  return (
    <div className="chart-wrap">
      <svg
        viewBox={`0 0 ${width} ${height + 30}`}
        role="img"
        aria-label={labels.title}
        className="trend-chart"
      >
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1="0" x2={width} y1={height - t * height + 4} y2={height - t * height + 4} className="grid-line" />
          </g>
        ))}
        {series.map((s, i) => {
          const x = i * groupW + 14;
          const hD = (s.donations / max) * height;
          const hE = (s.expenses / max) * height;
          return (
            <g key={s.month}>
              <rect x={x} y={height - hD + 4} width={barW} height={Math.max(hD, 1)} rx="4" fill="#087f5b">
                <title>{`${monthLabel(s.month)}: ${labels.donations} ${money(s.donations)}`}</title>
              </rect>
              <rect x={x + barW + 4} y={height - hE + 4} width={barW} height={Math.max(hE, 1)} rx="4" fill="#f5b942">
                <title>{`${monthLabel(s.month)}: ${labels.expenses} ${money(s.expenses)}`}</title>
              </rect>
              <text x={x + barW + 2} y={height + 22} textAnchor="middle" className="axis-label">
                {monthLabel(s.month)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="chart-legend">
        <span><i style={{ background: "#087f5b" }} />{labels.donations}</span>
        <span><i style={{ background: "#f5b942" }} />{labels.expenses}</span>
        <span className="muted">{labels.peak}: PKR {compactMoney(max)}</span>
      </div>
    </div>
  );
}

/** Donut chart for a list of { label, value }. */
export function DonutChart({ data, emptyText }) {
  const total = data.reduce((sum, d) => sum + Number(d.value), 0);

  if (!total) return <p className="muted">{emptyText}</p>;

  const stops = data.map((d, i) => {
    const before = data.slice(0, i).reduce((sum, x) => sum + Number(x.value), 0);
    const start = (before / total) * 100;
    const end = ((before + Number(d.value)) / total) * 100;
    return `${CHART_COLORS[i % CHART_COLORS.length]} ${start}% ${end}%`;
  });

  return (
    <div className="donut-row">
      <div className="donut" style={{ background: `conic-gradient(${stops.join(", ")})` }}>
        <div className="donut-hole">
          <strong>PKR {compactMoney(total)}</strong>
        </div>
      </div>
      <ul className="donut-legend">
        {data.map((d, i) => (
          <li key={d.label}>
            <i style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
            <span>{d.label}</span>
            <strong>{Math.round((Number(d.value) / total) * 100)}%</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProgressBar({ value, tone = "green", label }) {
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin="0"
      aria-valuemax="100"
      aria-label={label}
    >
      <span className={`progress-fill ${tone}`} style={{ width: `${value}%` }} />
    </div>
  );
}

/** Animated number that counts up once visible. */
export function CountUp({ value, format = (n) => Math.round(n).toLocaleString("en-PK") }) {
  const [shown, setShown] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    const target = Number(value) || 0;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || target === 0) {
      const id = requestAnimationFrame(() => setShown(target));
      return () => cancelAnimationFrame(id);
    }
    let frame;
    const start = performance.now();
    const duration = 1100;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      setShown(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <span ref={ref}>{format(shown)}</span>;
}
