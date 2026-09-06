import EpistemicTag from "./EpistemicTag";

export default function StatCard({
  label,
  value,
  foot,
  accent = "var(--indigo)",
  tag,
  valueSuffix,
  children,
}) {
  return (
    <div className="stat-card" style={{ "--stat-accent": accent }}>
      <div className="stat-label">
        <span>{label}</span>
        {tag && <EpistemicTag kind={tag} />}
      </div>
      <div className="stat-value">
        {value}
        {valueSuffix && <small> {valueSuffix}</small>}
      </div>
      {foot && <div className="stat-foot">{foot}</div>}
      {children}
    </div>
  );
}

export function StatTrend({ delta, invert = false }) {
  if (delta == null) return <span className="trend-flat">የቀድሞ መረጃ የለም</span>;
  const up = invert ? delta < 0 : delta > 0;
  const flat = Math.abs(delta) < 0.05;
  const cls = flat ? "trend-flat" : up ? "trend-up" : "trend-down";
  const arrow = flat ? "→" : up ? "▲" : "▼";
  return (
    <span className={`trend-arrow ${cls}`}>
      {arrow} {Math.abs(delta).toFixed(1)}
    </span>
  );
}
