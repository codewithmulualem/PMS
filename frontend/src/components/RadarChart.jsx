// Pure-SVG radar chart for competency profiles.
// Items: [{ label, value, target }] where value/target are 0-5 (or 0-100).

const SIZE = 260;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 92;
const LEVELS = 4; // concentric rings

export default function RadarChart({ items, size = SIZE, currentColor = "var(--indigo)", targetColor = "var(--teal)" }) {
  if (!items || items.length < 3) {
    return <div className="empty-state">መገለጫውን ለማሳየት ቢያንስ ሦስት ብቃቶችን ይጨምሩ።</div>;
  }

  const angle = (i) => (Math.PI * 2 * i) / items.length - Math.PI / 2;
  const pt = (i, v) => {
    const a = angle(i);
    const r = (Math.max(0, Math.min(1, v / 5)) || 0) * R;
    return [CX + Math.cos(a) * r, CY + Math.sin(a) * r];
  };

  const ring = (level) =>
    items.map((_, i) => {
      const a = angle(i);
      return `${(CX + Math.cos(a) * (R * level) / LEVELS).toFixed(1)},${(CY + Math.sin(a) * (R * level) / LEVELS).toFixed(1)}`;
    });

  const currentPath = items.map((it, i) => pt(i, it.value).map((n) => n.toFixed(1)).join(",")).join(" ");
  const targetPath = items.map((it, i) => pt(i, it.target || 5).map((n) => n.toFixed(1)).join(",")).join(" ");

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${size} ${size}`} style={{ maxWidth: size }}>
        {[1, 2, 3, 4].map((l) => (
          <polygon key={l} points={ring(l).join(" ")} fill={l === LEVELS ? "rgba(76,95,213,.03)" : "none"} stroke="#e4e7f0" strokeWidth="1" />
        ))}
        {items.map((_, i) => {
          const a = angle(i);
          return (
            <line key={i} x1={CX} y1={CY} x2={CX + Math.cos(a) * R} y2={CY + Math.sin(a) * R} stroke="#e4e7f0" strokeWidth="1" />
          );
        })}

        <polygon points={targetPath} fill="rgba(14,143,126,.08)" stroke={targetColor} strokeWidth="1.4" strokeDasharray="4 3" />
        <polygon points={currentPath} fill="rgba(76,95,213,.14)" stroke={currentColor} strokeWidth="2" />

        {items.map((it, i) => {
          const a = angle(i);
          const [lx, ly] = [CX + Math.cos(a) * (R + 24), CY + Math.sin(a) * (R + 24)];
          const anchor = Math.abs(Math.cos(a)) < 0.2 ? "middle" : Math.cos(a) > 0 ? "start" : "end";
          return (
            <text key={i} x={lx} y={ly + 3} textAnchor={anchor} className="chart-label" fill="var(--text-dim)">
              {it.label}
            </text>
          );
        })}
      </svg>
      <div className="chart-legend">
        <span className="lg"><span className="swatch" style={{ background: "var(--indigo)" }} /> የአሁኑ</span>
        <span className="lg"><span className="swatch" style={{ background: "var(--teal)" }} /> ዒላማ</span>
      </div>
    </div>
  );
}
