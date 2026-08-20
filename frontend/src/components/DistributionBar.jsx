// Stacked horizontal bar showing the distribution of a set of buckets.
// Buckets: [{ label, count, color }]
// Rating colors come from the DB (rating_bands) via /reference/rating-bands.

import { useEffect, useState } from "react";
import { api } from "../api";

const FALLBACK_COLORS = {
  Exceptional: "#1a7f37",
  "Exceeds Expectations": "#2f9e44",
  "Meets Expectations": "#f0a500",
  "Partially Meets Expectations": "#e8590c",
  "Needs Improvement": "#c92a2a",
};

let bandsPromise = null;
function loadBands() {
  if (!bandsPromise) bandsPromise = api.get("/reference/rating-bands").catch(() => []);
  return bandsPromise;
}

export default function DistributionBar({ buckets, total }) {
  const [colors, setColors] = useState(FALLBACK_COLORS);

  useEffect(() => {
    loadBands().then((bands) => {
      if (!Array.isArray(bands) || !bands.length) return;
      const m = { ...FALLBACK_COLORS };
      for (const b of bands) if (b.label) m[b.label] = b.color;
      setColors(m);
    });
  }, []);

  const t = total ?? buckets.reduce((s, b) => s + b.count, 0);
  if (!t || !buckets.length) return <div className="empty-state">No scores calculated yet for this cycle.</div>;

  return (
    <div>
      <div className="hbar-track" style={{ height: 16, display: "flex", gap: 2, background: "#eef0f6" }}>
        {buckets.map((b, i) => (
          <div
            key={i}
            title={`${b.label}: ${b.count}`}
            style={{
              width: `${(b.count / t) * 100}%`,
              background: b.color || colors[b.label] || "var(--indigo)",
              borderRadius: 4,
              transition: "width .5s ease",
            }}
          />
        ))}
      </div>
      <div className="chart-legend">
        {buckets.map((b, i) => (
          <span key={i} className="lg">
            <span className="swatch" style={{ background: b.color || colors[b.label] || "var(--indigo)" }} />
            {b.label}
            <strong style={{ fontFamily: "var(--font-mono)" }}>{b.count}</strong>
          </span>
        ))}
        {t > 0 && <span className="lg" style={{ marginLeft: "auto", color: "var(--text-faint)" }}>{t} total</span>}
      </div>
    </div>
  );
}
