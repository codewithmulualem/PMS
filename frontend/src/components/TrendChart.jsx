// Pure-SVG line/area trend chart — no charting dependency.
// Points: [{ label, value }]. Values are on a 0-100 scale.

const W = 560;
const H = 180;
const PAD = { top: 18, right: 18, bottom: 28, left: 34 };

function niceTicks(max) {
  return [0, 25, 50, 75, 100].filter((t) => t <= max);
}

export default function TrendChart({ points, color = "var(--indigo)", benchmark = null }) {
  if (!points || points.length < 2) {
    return <div className="empty-state">Not enough data points to plot a trend.</div>;
  }

  const vals = points.map((p) => p.value ?? 0);
  const yMax = Math.max(100, ...vals);
  const maxTick = Math.max(...niceTicks(yMax).filter((t) => t <= yMax));
  const ticks = niceTicks(maxTick);

  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (i / (points.length - 1)) * iw;
  const y = (v) => PAD.top + ih - (Math.max(0, Math.min(maxTick, v)) / maxTick) * ih;

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${x(points.length - 1)},${PAD.top + ih} L${x(0)},${PAD.top + ih} Z`;

  const last = points[points.length - 1];

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="#eef0f6" strokeWidth="1" />
            <text x={PAD.left - 7} y={y(t) + 3} textAnchor="end" className="chart-label">{t}</text>
          </g>
        ))}

        {benchmark != null && benchmark <= maxTick && (
          <line x1={PAD.left} x2={W - PAD.right} y1={y(benchmark)} y2={y(benchmark)} stroke="var(--slate)" strokeWidth="1.4" strokeDasharray="5 4" opacity=".7" />
        )}

        <path d={areaPath} fill="url(#trendFill)" />
        <path d={linePath} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />

        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.value)} r={i === points.length - 1 ? 4.5 : 3} fill="#fff" stroke={color} strokeWidth="2" />
        ))}

        <text x={x(points.length - 1)} y={H - 6} textAnchor="middle" className="chart-label" fill="var(--text)">
          {last.label}
        </text>
        {points.slice(0, -1).map((p, i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className="chart-label">
            {p.label}
          </text>
        ))}

        {last.value != null && (
          <text x={x(points.length - 1)} y={Math.max(PAD.top + 4, y(last.value) - 10)} textAnchor="middle" className="chart-label" fill={color}>
            <tspan fontWeight="700">{last.value.toFixed ? last.value.toFixed(1) : last.value}</tspan>
          </text>
        )}
      </svg>
    </div>
  );
}
