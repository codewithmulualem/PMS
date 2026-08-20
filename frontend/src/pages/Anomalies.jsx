import { useEffect, useState } from "react";
import { api } from "../api";
import { useCycle } from "../context/CycleContext";
import Topbar from "../components/Topbar";
import EpistemicTag from "../components/EpistemicTag";
import Skeleton from "../components/Skeleton";
import { Icons } from "../components/icons";

export default function AnomaliesPage() {
  const { cycleId, current } = useCycle();
  const [signals, setSignals] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!cycleId) return;
    let cancelled = false;
    setSignals(null);
    api.get(`/ai/anomalies?cycle_id=${cycleId}`)
      .then((d) => !cancelled && setSignals(d))
      .catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [cycleId]);

  return (
    <div>
      <Topbar subtitle={`Flags for ${current?.name || "the selected cycle"} — for human review only`} />

      {error && <div className="error-banner">{error}</div>}

      <div className="card" style={{ marginBottom: 16, borderLeft: "3px solid var(--amber)" }}>
        <div className="flex gap-8">
          <Icons.shield size={18} style={{ color: "var(--amber)", flexShrink: 0 }} />
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            <b>AI is advisory, never decisive.</b> Signals below are statistical patterns that <em>may</em> warrant attention.
            They are not accusations and they never change a score. Investigate, calibrate, and act as a human decision-maker.
          </div>
        </div>
      </div>

      {!cycleId ? (
        <div className="card"><div className="empty-state">Select a performance cycle to scan for anomaly signals.</div></div>
      ) : signals === null && !error ? (
        <Skeleton lines={5} height={18} />
      ) : (
        <div className="card">
          <div className="card-title">
            Detected signals
            <span className="chip chip-neutral">{(signals || []).length} found</span>
          </div>
          {(signals || []).length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">✓</div>
              No anomaly signals detected in this cycle.
              <div style={{ marginTop: 6, fontSize: 12 }}>Identical-score patterns and &gt;25pt swings vs the prior cycle are the current heuristics.</div>
            </div>
          ) : (
            signals.map((s, i) => (
              <div key={i} className="insight-card anomaly">
                <div className="insight-head">
                  <EpistemicTag kind="risk" />
                  <span className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>signal #{i + 1}</span>
                </div>
                <div>{s.content}</div>
                {s.supporting_data && (
                  <div className="insight-src">{JSON.stringify(s.supporting_data)}</div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
