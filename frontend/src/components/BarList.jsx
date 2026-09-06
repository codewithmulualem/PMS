// Horizontal bar list — used for KPI achievement, department scores, etc.
// Items: [{ label, value (0-100), color?, valueText?, sub? }]

export default function BarList({ items, color = "var(--indigo)" }) {
  if (!items || items.length === 0) {
    return <div className="empty-state">እስካሁን መረጃ የለም።</div>;
  }
  return (
    <div>
      {items.map((it, i) => {
        const pct = it.value == null ? 0 : Math.max(0, Math.min(100, it.value));
        const fillColor = it.color || color;
        return (
          <div className="hbar-row" key={i}>
            <div className="hbar-label">
              {it.label}
              {it.sub && <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{it.sub}</div>}
            </div>
            <div className="hbar-track">
              <div className="hbar-fill" style={{ width: `${pct}%`, background: fillColor }} />
            </div>
            <div className="hbar-val">{it.valueText || (it.value != null ? `${it.value.toFixed(1)}` : "—")}</div>
          </div>
        );
      })}
    </div>
  );
}
