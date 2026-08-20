export default function MeterRow({ label, value, color = "var(--indigo)" }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="meter-row">
      <span>{label}</span>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="meter-value">{value != null ? `${value.toFixed(0)}%` : "—"}</span>
    </div>
  );
}
