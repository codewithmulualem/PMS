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
      <Topbar subtitle={`የ${current?.name || "የተመረጠው ዑደት"} ምልክቶች — ለሰው ግምገማ ብቻ`} />

      {error && <div className="error-banner">{error}</div>}

      <div className="card" style={{ marginBottom: 16, borderLeft: "3px solid var(--amber)" }}>
        <div className="flex gap-8">
          <Icons.shield size={18} style={{ color: "var(--amber)", flexShrink: 0 }} />
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            <b>AI አማካሪ ነው፣ ውሳኔ ሰጪ አይደለም።</b> ከታች ያሉት ምልክቶች ትኩረት ሊፈልጉ የሚችሉ ስታቲስቲካዊ አዝማሚያዎች ናቸው።
            ክስ አይደሉም እና ነጥብን በፍጹም አይቀይሩም። ይመርምሩ፣ ያስተካክሉ እና እንደ ሰው ውሳኔ ሰጪ ይወስኑ።
          </div>
        </div>
      </div>

      {!cycleId ? (
        <div className="card"><div className="empty-state">የማስጠንቀቂያ ምልክቶችን ለመፈለግ የአፈጻጸም ዑደት ይምረጡ።</div></div>
      ) : signals === null && !error ? (
        <Skeleton lines={5} height={18} />
      ) : (
        <div className="card">
          <div className="card-title">
            የተገኙ ምልክቶች
            <span className="chip chip-neutral">{(signals || []).length} ተገኝተዋል</span>
          </div>
          {(signals || []).length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">✓</div>
              በዚህ ዑደት ምንም የማስጠንቀቂያ ምልክት አልተገኘም።
              <div style={{ marginTop: 6, fontSize: 12 }}>ተመሳሳይ ነጥብ እና ከቀደመው ዑደት የ25 ነጥብ በላይ ለውጥ የአሁኑ መመዘኛዎች ናቸው።</div>
            </div>
          ) : (
            signals.map((s, i) => (
              <div key={i} className="insight-card anomaly">
                <div className="insight-head">
                  <EpistemicTag kind="risk" />
                  <span className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>ምልክት #{i + 1}</span>
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
