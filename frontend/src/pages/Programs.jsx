import { useEffect, useState, useCallback } from "react";
import { api } from "../api";
import { useCycle } from "../context/CycleContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import Topbar from "../components/Topbar";
import Modal from "../components/Modal";
import Skeleton from "../components/Skeleton";
import ScoreRing from "../components/ScoreRing";
import { Icons } from "../components/icons";
import { statusLabel } from "../i18n";

const STATUS_COLORS = {
  planning: "var(--slate)", in_progress: "var(--indigo)", on_hold: "var(--amber)",
  completed: "var(--teal)", cancelled: "var(--muted)",
};
const ACTIVITY_STATUS = ["not_started", "in_progress", "on_hold", "completed"];
const ACTIVITY_STATUS_LABELS = { not_started: "አልተጀመረም", in_progress: "በሂደት ላይ", on_hold: "ቆሟል", completed: "ተጠናቋል" };
const KPI_TYPES = ["percentage", "numeric", "milestone"];
const KPI_TYPE_LABELS = { percentage: "መቶኛ", numeric: "ቁጥር", milestone: "የደረጃ ምልክት" };
const MAX_ACTIVITY_DEPTH = 5;

function kpiAchievementPct(kpi) {
  if (kpi.kpi_type === "milestone") return (kpi.actual_value || 0) >= 1 ? 100 : 0;
  const target = kpi.target_value;
  const actual = kpi.actual_value;
  if (!target || actual == null) return null;
  if (kpi.direction === "lower_is_better") return Math.min(100, Math.round((target / actual) * 100));
  if (kpi.direction === "target_is_best") return Math.max(0, Math.round(100 - (Math.abs(actual - target) / target) * 100));
  return Math.min(100, Math.round((actual / target) * 100));
}

function weightAwareActivityProgress(activity) {
  if (activity.kpis && activity.kpis.length > 0) {
    let totalW = 0, totalS = 0;
    for (const k of activity.kpis) {
      const ach = kpiAchievementPct(k);
      if (ach != null) { const w = k.weight || 1; totalW += w; totalS += ach * w; }
    }
    if (totalW > 0) return Math.round(totalS / totalW);
  }
  if (activity.children && activity.children.length > 0) {
    let totalW = 0, totalS = 0;
    for (const c of activity.children) {
      const w = c.weight || 1;
      totalW += w;
      totalS += weightAwareActivityProgress(c) * w;
    }
    return totalW > 0 ? Math.round(totalS / totalW) : (activity.progress_pct || 0);
  }
  return activity.progress_pct || 0;
}

export default function Programs() {
  const { cycleId } = useCycle();
  const { user } = useAuth();
  const toast = useToast();
  const canCreateProgram = ["admin", "executive", "director"].includes(user?.role);
  const canEditProgram = ["admin", "executive", "director"].includes(user?.role);
  const canManageActivities = ["admin", "dept_head", "team_leader"].includes(user?.role);
  const canAddTeamActivity = ["admin", "dept_head"].includes(user?.role);

  const [programs, setPrograms] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [creating, setCreating] = useState(false);
  const [editProj, setEditProj] = useState(null);
  const [addingActivity, setAddingActivity] = useState(null);
  const [editActivity, setEditActivity] = useState(null);
  const [editKpi, setEditKpi] = useState(null);
  const [progressActivity, setProgressActivity] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loadError, setLoadError] = useState(null);

  const loadPrograms = useCallback(async () => {
    setLoadError(null);
    try {
      const qs = cycleId ? `?cycle_id=${cycleId}` : "";
      const rows = await api.get(`/programs${qs}`);
      setPrograms(Array.isArray(rows) ? rows : []);
      if (selectedId && !rows.some((p) => p.id === selectedId)) {
        setSelectedId(null);
        setDetail(null);
      }
    } catch (err) {
      setPrograms([]);
      setLoadError(err.message);
      toast.push(err.message, "error");
    }
  }, [cycleId]);

  const loadDetail = useCallback(async (id) => {
    try { setDetail(await api.get(`/programs/${id}`)); }
    catch (err) {
      setDetail(null);
      setSelectedId(null);
      toast.push(err.message, "error");
    }
  }, []);

  useEffect(() => { loadPrograms(); }, [loadPrograms]);
  useEffect(() => { if (selectedId) loadDetail(selectedId); }, [selectedId, loadDetail]);

  if (programs === null) return <Skeleton lines={6} />;

  const filtered = programs.filter((p) => {
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (p.name || "").toLowerCase().includes(q) || (p.description || "").toLowerCase().includes(q) || (p.owner_name || "").toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <>
      <Topbar title={selectedId && detail ? detail.name : "ፕሮግራሞች"}>
        {canCreateProgram && !selectedId && (
          <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
            <Icons.plus size={14} /> አዲስ ፕሮግራም
          </button>
        )}
      </Topbar>

      {!selectedId && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
            <input
              className="input"
              placeholder="ፕሮግራሞችን ፈልግ…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, maxWidth: 320 }}
            />
            <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 160 }}>
              <option value="all">ሁሉም ሁኔታዎች</option>
              {["planning", "in_progress", "on_hold", "completed"].map((s) => (
                <option key={s} value={s}>{statusLabel(s)}</option>
              ))}
            </select>
          </div>
          <div className="card-stack">
            {loadError && <div className="error-banner">{loadError}</div>}
            {filtered.length === 0 && !loadError && <div className="text-faint" style={{ padding: 20 }}>ምንም ፕሮግራም የለም።</div>}
            {filtered.map((p) => (
              <div key={p.id} className="card" style={{ cursor: "pointer" }} onClick={() => setSelectedId(p.id)}>
                <div className="flex-between" style={{ marginBottom: 6 }}>
                  <div className="cell-strong">{p.name}</div>
                  <span className="chip" style={{ color: STATUS_COLORS[p.status] || "var(--text)", borderColor: STATUS_COLORS[p.status] || "var(--border)" }}>{statusLabel(p.status)}</span>
                </div>
                {p.description && <div className="text-faint" style={{ fontSize: 13, marginBottom: 6 }}>{p.description}</div>}
                <div className="flex-between" style={{ fontSize: 13 }}>
                  <span className="text-faint">ባለቤት፦ {p.owner_name || "—"}</span>
                  <span className="text-faint">{p.completed_activities}/{p.activity_count} ተግባራት</span>
                </div>
                {p.activity_count > 0 && (
                  <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-dim)" }}>
                    {p.completed_activities} ከ {p.activity_count} ተግባራት ተጠናቀዋል ({Math.round(p.completed_activities / p.activity_count * 100)}%)
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {selectedId && !detail && <Skeleton lines={4} />}

      {selectedId && detail && (
        <ProgramDetail
          program={detail}
          onBack={() => { setSelectedId(null); setDetail(null); }}
          onRefresh={() => loadDetail(selectedId)}
          onListRefresh={loadPrograms}
          canManageActivities={canManageActivities} canEditProgram={canEditProgram}
          canAddTeamActivity={canAddTeamActivity} toast={toast} user={user}
          addingActivity={addingActivity} setAddingActivity={setAddingActivity}
          editActivity={editActivity} setEditActivity={setEditActivity}
          editKpi={editKpi} setEditKpi={setEditKpi}
          progressActivity={progressActivity} setProgressActivity={setProgressActivity}
          editProj={editProj} setEditProj={setEditProj}
        />
      )}

      {creating && <ProgramForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); loadPrograms(); }} toast={toast} cycleId={cycleId} />}
    </>
  );
}

function ProgramDetail({ program, onBack, onRefresh, onListRefresh, canManageActivities, canEditProgram, canAddTeamActivity, toast, user, addingActivity, setAddingActivity, editActivity, setEditActivity, editKpi, setEditKpi, progressActivity, setProgressActivity, editProj, setEditProj }) {
  const [scoreData, setScoreData] = useState(null);
  const [loadingScore, setLoadingScore] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refreshScore = useCallback(() => {
    setLoadingScore(true);
    api.get(`/programs/${program.id}/score`).then(setScoreData).catch((err) => toast.push(err.message, "error")).finally(() => setLoadingScore(false));
  }, [program.id, toast]);

  useEffect(() => { refreshScore(); }, [refreshScore]);

  const wrappedRefresh = useCallback(() => {
    onRefresh();
    refreshScore();
  }, [onRefresh, refreshScore]);

  async function deleteProgram() {
    if (!window.confirm("ይህን ፕሮግራም እና ሁሉንም ተግባሮቹን ማጥፋት ይፈልጋሉ? ይህ እርምጃ አይመለስም።")) return;
    try {
      await api.delete(`/programs/${program.id}`);
      toast.push("ፕሮግራሙ ተሰርዟል", "success");
      onBack();
      if (onListRefresh) onListRefresh();
    } catch (err) { toast.push(err.message, "error"); }
    setConfirmDelete(false);
  }

  const isOwner = user?.employee_id === program.owner_id;
  const canDelete = isOwner || user?.role === "admin";

  return (
    <>
      <div className="flex-between" style={{ marginBottom: 12 }}>
            <button className="btn btn-sm" onClick={onBack}><Icons.chevronLeft size={14} /> ተመለስ</button>
        {canEditProgram && (
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-sm" onClick={() => setEditProj(program)} title="ፕሮግራም አርትዕ"><Icons.edit size={14} /></button>
            {canDelete && (
              <button className="btn btn-sm" onClick={() => setConfirmDelete(true)} title="ፕሮግራም ሰርዝ" style={{ color: "var(--rose)" }}><Icons.trash size={14} /></button>
            )}
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="cell-strong" style={{ fontSize: 18, marginBottom: 4 }}>{program.name}</div>
        {program.description && <div className="text-faint" style={{ marginBottom: 8 }}>{program.description}</div>}
        <div className="text-faint" style={{ fontSize: 13 }}>
          ባለቤት፦ {program.owner_name || "—"} · ሁኔታ፦ <span style={{ color: STATUS_COLORS[program.status] }}>{statusLabel(program.status)}</span>
          {program.start_date && ` · መጀመሪያ፦ ${program.start_date}`}{program.due_date && ` · መጨረሻ፦ ${program.due_date}`}
          {program.weight > 1 && ` · ክብደት፦ ${program.weight}`}
        </div>

        {loadingScore && <div className="text-faint" style={{ marginTop: 10, fontSize: 13 }}>ነጥብ በማስላት ላይ…</div>}
        {scoreData && scoreData.score != null && (
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
            <ScoreRing score={scoreData.score} size={40} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{scoreData.score}%</div>
              <div className="text-faint" style={{ fontSize: 12 }}>በKPI የተሰላ አፈጻጸም</div>
            </div>
          </div>
        )}
        {scoreData && scoreData.score == null && (
          <div className="text-faint" style={{ marginTop: 10, fontSize: 13 }}>እስካሁን ነጥብ የተሰጠው ተግባር የለም። ነጥብ ለማስላት KPI ያላቸውን ተግባሮች ይመድቡ።</div>
        )}
      </div>

      {canAddTeamActivity && (
        <div style={{ marginBottom: 10 }}>
          <button className="btn btn-sm btn-primary" onClick={() => setAddingActivity("root")}><Icons.plus size={14} /> ተግባር ጨምር</button>
        </div>
      )}

      {(!program.activities || program.activities.length === 0) && <div className="text-faint" style={{ padding: 12 }}>እስካሁን ምንም ተግባር የለም።</div>}
      {program.activities && program.activities.map((t) => (
        <TaskNode key={t.id} activity={t} depth={0} isManager={canManageActivities} toast={toast} user={user}
          onRefresh={wrappedRefresh} setAddingActivity={setAddingActivity} setEditActivity={setEditActivity} setEditKpi={setEditKpi} setProgressActivity={setProgressActivity} />
      ))}

      {confirmDelete && (
          <Modal title="ፕሮግራም ሰርዝ" onClose={() => setConfirmDelete(false)}>
          <p style={{ fontSize: 14, marginBottom: 12 }}>ይህን <strong>{program.name}</strong> ፕሮግራም እና ሁሉንም ተግባሮቹን ማጥፋት ይፈልጋሉ? ይህ እርምጃ አይመለስም።</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" onClick={deleteProgram} style={{ background: "var(--rose)" }}>ሰርዝ</button>
            <button className="btn btn-sm" onClick={() => setConfirmDelete(false)}>ዝጋ</button>
          </div>
        </Modal>
      )}

      {addingActivity === "root" && <TaskForm programId={program.id} role={user?.role} onClose={() => setAddingActivity(null)} onSaved={() => { setAddingActivity(null); wrappedRefresh(); }} toast={toast} />}
      {addingActivity && addingActivity !== "root" && (
        <TaskForm parentId={addingActivity} programId={program.id} role={user?.role} onClose={() => setAddingActivity(null)} onSaved={() => { setAddingActivity(null); wrappedRefresh(); }} toast={toast} />
      )}
      {editActivity && <TaskForm activity={editActivity} programId={program.id} role={user?.role} onClose={() => setEditActivity(null)} onSaved={() => { setEditActivity(null); wrappedRefresh(); }} toast={toast} />}
      {progressActivity && <ProgressForm activity={progressActivity} onClose={() => setProgressActivity(null)} onSaved={() => { setProgressActivity(null); wrappedRefresh(); }} toast={toast} />}
      {editKpi && <KpiForm kpi={editKpi} onClose={() => setEditKpi(null)} onSaved={() => { setEditKpi(null); wrappedRefresh(); }} toast={toast} />}
      {editProj && <ProgramForm program={editProj} onClose={() => setEditProj(null)} onSaved={() => { setEditProj(null); wrappedRefresh(); }} toast={toast} />}
    </>
  );
}

function TaskNode({ activity, depth, isManager, toast, user, onRefresh, setAddingActivity, setEditActivity, setEditKpi, setProgressActivity }) {
  const [open, setOpen] = useState(depth < 2);
  const [history, setHistory] = useState(null);
  const hasChildren = activity.children && activity.children.length > 0;
  const pct = weightAwareActivityProgress(activity);
  const statusKey = ACTIVITY_STATUS.includes(activity.status) ? activity.status : "not_started";
  const hasMilestoneKpi = activity.kpis && activity.kpis.some((k) => k.kpi_type === "milestone" && (k.actual_value || 0) < 1);
  const canAddSubactivity = depth < MAX_ACTIVITY_DEPTH - 1;

  function toggleHistory() {
    if (history !== null) { setHistory(null); return; }
    api.get(`/programs/activities/${activity.id}/progress`).then(setHistory).catch((err) => toast.push(err.message, "error"));
  }

  return (
    <div className="card" style={{ marginLeft: depth * 20, marginBottom: 8, borderLeft: `3px solid ${hasMilestoneKpi ? "var(--amber)" : STATUS_COLORS[statusKey]}` }}>
      <div className="flex-between">
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {hasChildren ? (
            <button className="btn btn-sm" style={{ padding: 2, minWidth: 0 }} onClick={() => setOpen(!open)}>
              {open ? <Icons.chevronDown size={14} /> : <Icons.chevronRight size={14} />}
            </button>
          ) : <span style={{ width: 20 }} />}
          {hasMilestoneKpi && <Icons.alert size={14} style={{ color: "var(--amber)" }} />}
          <span style={{ fontWeight: 500, fontSize: 14 }}>{activity.title}</span>
          <span className="chip" style={{ fontSize: 11, color: STATUS_COLORS[statusKey], borderColor: STATUS_COLORS[statusKey] }}>
            {ACTIVITY_STATUS_LABELS[activity.status] || activity.status}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{pct}%</span>
          {isManager && (
            <>
              <button className="btn btn-sm" onClick={() => setEditActivity(activity)} title="አርትዕ"><Icons.edit size={13} /></button>
              {canAddSubactivity
                ? <button className="btn btn-sm" onClick={() => setAddingActivity(activity.id)} title="ንዑስ ተግባር ጨምር"><Icons.plus size={13} /></button>
                : <span title="ከፍተኛው የመደራረብ ደረጃ ደርሷል" style={{ cursor: "not-allowed", opacity: 0.35 }}><Icons.plus size={13} /></span>
              }
              {(!activity.kpis || activity.kpis.length === 0) && (
                <button className="btn btn-sm" onClick={() => setProgressActivity(activity)} title="አፈጻጸም መዝግብ"><Icons.chart size={13} /></button>
              )}
              <button className="btn btn-sm" onClick={() => deleteActivity(activity.id, toast, onRefresh)} title="ተግባር ሰርዝ"><Icons.trash size={13} /></button>
            </>
          )}
          <button className="btn btn-sm" onClick={toggleHistory} title="የአፈጻጸም ታሪክ"><Icons.clock size={13} /></button>
        </div>
      </div>
      <div className="text-faint" style={{ fontSize: 12, marginLeft: 26 }}>
        {activity.assignee_name ? `ተመድቧል፦ ${activity.assignee_name}` : (activity.org_unit_name ? `ቡድን፦ ${activity.org_unit_name}` : "አልተመደበም")}
        {activity.weight > 1 ? ` · ክብደት፦ ${activity.weight}` : ""}
        {activity.assigned_by_name ? ` · የመደበው፦ ${activity.assigned_by_name}` : ""}
        {activity.strategic_goal_title && (
          <span className="chip" style={{ fontSize: 11, marginLeft: 6, color: "var(--indigo)", borderColor: "var(--indigo)" }}>
            የሚያገለግለው፦ {activity.strategic_goal_title}{activity.strategic_goal_scope ? ` (${activity.strategic_goal_scope})` : ""}
          </span>
        )}
      </div>

      {open && (
        <div style={{ marginTop: 8, marginLeft: 26 }}>
            {activity.kpis && activity.kpis.length > 0 && activity.kpis.map((k) => (
              <KpiRow key={k.id} kpi={k} isManager={isManager} setEditKpi={setEditKpi} onRefresh={onRefresh} toast={toast} user={user} activity={activity} />
            ))}
          {isManager && (
            <button className="btn btn-sm" style={{ marginTop: 4 }} onClick={() => setEditKpi({ activity_id: activity.id })}>
              <Icons.plus size={12} /> KPI ጨምር
            </button>
          )}
          {hasChildren && activity.children.map((c) => (
            <TaskNode key={c.id} activity={c} depth={depth + 1} isManager={isManager} toast={toast} user={user}
              onRefresh={onRefresh} setAddingActivity={setAddingActivity} setEditActivity={setEditActivity} setEditKpi={setEditKpi} setProgressActivity={setProgressActivity} />
          ))}
          {history && (
            <div style={{ marginTop: 6, padding: 8, background: "var(--bg-muted)", borderRadius: 6, fontSize: 12 }}>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>የአፈጻጸም ታሪክ</div>
              {history.length === 0 && <div className="text-faint">እስካሁን መዝገብ የለም።</div>}
              {history.map((h) => (
                <div key={h.id} style={{ padding: "2px 0", borderBottom: "1px solid var(--border-light)" }}>
                  <span style={{ fontWeight: 500 }}>{h.progress_pct}%</span>
                  <span className="text-faint" style={{ marginLeft: 6 }}>{h.recorded_by_name || "—"}</span>
                  <span className="text-faint" style={{ marginLeft: 6 }}>{new Date(h.created_at).toLocaleString()}</span>
                  {h.notes && <span className="text-faint" style={{ marginLeft: 6 }}>— {h.notes}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const PROGRESS_OPTIONS = [
  { label: "አልተጀመረም", value: 0 },
  { label: "25%", value: 25 },
  { label: "50%", value: 50 },
  { label: "75%", value: 75 },
  { label: "ተጠናቋል", value: 100 },
];

function KpiRow({ kpi, isManager, setEditKpi, onRefresh, toast, user, activity }) {
  const ach = kpiAchievementPct(kpi);
  const isAssignee = user && activity && activity.assignee_id === user.employee_id;
  const canProgress = isAssignee && !isManager;
  const currentPct = kpi.kpi_type === "milestone"
    ? ((kpi.actual_value || 0) >= 1 ? 100 : 0)
    : (kpi.actual_value != null && kpi.target_value ? Math.round((kpi.actual_value / kpi.target_value) * 100) : 0);

  async function setProgress(pct) {
    const newVal = kpi.target_value ? (kpi.target_value * pct) / 100 : (pct >= 100 ? 1 : 0);
    try {
      await api.put(`/programs/kpis/${kpi.id}`, { actual_value: newVal });
      toast.push(`አፈጻጸም ${pct}% ሆኖ ተመዝግቧል`, "success");
      if (onRefresh) onRefresh();
    } catch (err) { toast.push(err.message, "error"); }
  }

  async function deleteKpi(e) {
    e.stopPropagation();
    if (!window.confirm(`KPI "${kpi.name}" ይሰረዝ?`)) return;
    try {
      await api.delete(`/programs/kpis/${kpi.id}`);
      toast.push("KPI ተሰርዟል", "success");
      if (onRefresh) onRefresh();
    } catch (err) { toast.push(err.message, "error"); }
  }

  if (kpi.kpi_type === "milestone") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13, borderBottom: "1px solid var(--border-light)" }}>
        <span style={{ fontWeight: 500 }}>{kpi.name}</span>
        <span className="chip" style={{ fontSize: 11 }}>የደረጃ ምልክት</span>
        {canProgress ? (
          <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
            {PROGRESS_OPTIONS.map((opt) => (
              <button key={opt.value} className={`btn btn-sm ${currentPct === opt.value ? "btn-primary" : ""}`}
                onClick={() => setProgress(opt.value)} title={opt.label}>
                {opt.label}
              </button>
            ))}
          </span>
        ) : (
          <>
            {currentPct >= 100
              ? <span className="chip chip-success" style={{ fontSize: 11 }}>ተጠናቋል</span>
              : <span className="chip chip-warning" style={{ fontSize: 11 }}>አልተጠናቀቀም</span>}
          </>
        )}
        {isManager && (
          <span style={{ display: "flex", gap: 4 }}>
            <button className="btn btn-sm" onClick={() => setEditKpi(kpi)} title="KPI አርትዕ"><Icons.edit size={12} /></button>
            <button className="btn btn-sm" onClick={deleteKpi} title="KPI ሰርዝ" style={{ color: "var(--rose)" }}><Icons.trash size={12} /></button>
          </span>
        )}
      </div>
    );
  }
  const dirLabel = kpi.direction === "lower_is_better" ? "ዝቅ ያለ ይሻላል" : kpi.direction === "target_is_best" ? "የታለመው ይሻላል" : "ከፍ ያለ ይሻላል";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13, borderBottom: "1px solid var(--border-light)" }}>
      <span style={{ fontWeight: 500 }}>{kpi.name}</span>
      <span className="chip" style={{ fontSize: 11 }}>{KPI_TYPE_LABELS[kpi.kpi_type] || kpi.kpi_type}</span>
      <span className="text-faint" style={{ fontSize: 11 }}>{dirLabel}</span>
      {kpi.actual_value != null && kpi.target_value && (
        <span className="text-faint">{kpi.actual_value}/{kpi.target_value}{kpi.unit ? ` ${kpi.unit}` : ""}</span>
      )}
      {ach != null && <span style={{ fontSize: 12, color: ach >= 100 ? "var(--teal)" : "var(--text-dim)" }}>{ach}%</span>}
      {canProgress ? (
        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {PROGRESS_OPTIONS.map((opt) => (
            <button key={opt.value} className={`btn btn-sm ${currentPct === opt.value ? "btn-primary" : ""}`}
              onClick={() => setProgress(opt.value)} title={opt.label}>
              {opt.label}
            </button>
          ))}
        </span>
      ) : isManager ? (
        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <button className="btn btn-sm" onClick={() => setEditKpi(kpi)} title="KPI አርትዕ"><Icons.edit size={12} /></button>
          <button className="btn btn-sm" onClick={deleteKpi} title="KPI ሰርዝ" style={{ color: "var(--rose)" }}><Icons.trash size={12} /></button>
        </span>
      ) : null}
    </div>
  );
}

async function deleteActivity(id, toast, onRefresh) {
  if (!window.confirm("ይህ ተግባር እና ሁሉም ንዑስ ተግባሮቹ ይሰረዙ?")) return;
  try { await api.delete(`/programs/activities/${id}`); toast.push("ተግባሩ ተሰርዟል", "success"); onRefresh(); }
  catch (err) { toast.push(err.message, "error"); }
}

/* ---- Forms ---- */

function ProgramForm({ program, onClose, onSaved, toast, cycleId }) {
  const [name, setName] = useState(program?.name || "");
  const [desc, setDesc] = useState(program?.description || "");
  const [status, setStatus] = useState(program?.status || "planning");
  const [due, setDue] = useState(program?.due_date || "");
  const [weight, setWeight] = useState(program?.weight ?? 1);
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault(); setSaving(true);
    try {
      const body = { name, description: desc, status, due_date: due || null, weight: Number(weight) };
      if (program) await api.put(`/programs/${program.id}`, body);
      else await api.post("/programs", { ...body, cycle_id: cycleId });
      toast.push(program ? "ፕሮግራሙ ተሻሽሏል" : "ፕሮግራሙ ተፈጥሯል", "success"); onSaved();
    } catch (err) { toast.push(err.message, "error"); } finally { setSaving(false); }
  }

  return (
    <Modal title={program ? "ፕሮግራም አርትዕ" : "አዲስ ፕሮግራም"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field"><label>የፕሮግራም ስም</label><input value={name} onChange={(e) => setName(e.target.value)} required placeholder="ለምሳሌ፦ የESIA የሥራ ዝርዝር ማጽዳት" /></div>
        <div className="field"><label>መግለጫ</label><textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} placeholder="ወሰን እና ዓላማዎች…" /></div>
        <div className="grid grid-3">
          <div className="field">
            <label>ሁኔታ</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {["planning", "in_progress", "on_hold", "completed", "cancelled"].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          </div>
          <div className="field"><label>የመጨረሻ ቀን</label><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
          <div className="field"><label>ክብደት</label><input type="number" min="0" step="0.5" value={weight} onChange={(e) => setWeight(e.target.value)} /></div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className="btn btn-primary" type="submit" disabled={saving || !name}>{saving ? "በማስቀመጥ ላይ…" : program ? "አሻሽል" : "ፍጠር"}</button>
          <button className="btn btn-sm" type="button" onClick={onClose}>ሰርዝ</button>
        </div>
      </form>
    </Modal>
  );
}

function TaskForm({ activity, parentId, programId, role, onClose, onSaved, toast }) {
  const isEdit = !!activity?.id;
  const parentForSubmit = parentId === "root" ? null : (parentId ?? (activity?.parent_id || null));
  const canAssignTeams = ["dept_head", "admin"].includes(role);
  const showAssignee = role === "team_leader" || !!activity?.assignee_id;

  const [title, setTitle] = useState(activity?.title || "");
  const [desc, setDesc] = useState(activity?.description || "");
  const [status, setStatus] = useState(activity?.status || "not_started");
  const [weight, setWeight] = useState(activity?.weight ?? 1);
  const [startDate, setStartDate] = useState(activity?.start_date || "");
  const [due, setDue] = useState(activity?.due_date || "");
  const [saving, setSaving] = useState(false);
  const [teams, setTeams] = useState([]);
  const [team, setTeam] = useState(activity?.org_unit_id || "");
  const [members, setMembers] = useState([]);
  const [assignee, setAssignee] = useState(activity?.assignee_id || "");
  const [kpis, setKpis] = useState(activity?.kpis || []);
  const [goals, setGoals] = useState([]);
  const [goal, setGoal] = useState(activity?.strategic_goal_id || "");
  const [errMsg, setErrMsg] = useState(null);

  useEffect(() => {
    if (canAssignTeams) {
      api.get("/programs/assignable-teams").then(setTeams).catch((err) => setErrMsg(err.message));
    }
  }, [canAssignTeams]);

  useEffect(() => {
    if (showAssignee) {
      api.get("/strategic-goals/team")
        .then((d) => setMembers(d.members || []))
        .catch((err) => setErrMsg(err.message));
    }
  }, [showAssignee]);

  useEffect(() => {
    const q = [];
    if (team) q.push(`org_unit_id=${team}`);
    else if (assignee) q.push(`assignee_id=${assignee}`);
    api.get(`/programs/${programId}/assignable-goals${q.length ? `?${q.join("&")}` : ""}`)
      .then((rows) => {
        let list = rows || [];
        if (activity?.strategic_goal_id && !list.some((g) => g.id === activity.strategic_goal_id)) {
          list = [{ id: activity.strategic_goal_id, title: activity.strategic_goal_title || "የአሁኑ ግብ", scope: activity.strategic_goal_scope || "" }, ...list];
        }
        setGoals(list);
        setErrMsg(null);
      })
      .catch((err) => setErrMsg(err.message));
  }, [programId, team, assignee]);

  function updateKpi(idx, patch) {
    setKpis((prev) => prev.map((k, i) => (i === idx ? { ...k, ...patch } : k)));
  }

  async function submit(e) {
    e.preventDefault(); setSaving(true);
    try {
      const body = {
        title, description: desc || null,
        org_unit_id: team ? Number(team) : null,
        assignee_id: assignee ? Number(assignee) : null,
        status, weight: Number(weight),
        start_date: startDate || null, due_date: due || null,
        strategic_goal_id: goal ? Number(goal) : null,
        parent_id: parentForSubmit,
      };
      if (!isEdit && kpis.length > 0) {
        body.kpis = kpis.map((k) => ({
          name: k.name,
          kpi_type: k.kpi_type || "numeric",
          target_value: k.target_value === "" ? null : Number(k.target_value),
          actual_value: k.actual_value === "" ? null : Number(k.actual_value),
          weight: Number(k.weight || 1),
        }));
      }
      if (isEdit) await api.put(`/programs/activities/${activity.id}`, body);
      else await api.post(`/programs/${programId}/activities`, body);
      toast.push(isEdit ? "ተግባሩ ተሻሽሏል" : "ተግባሩ ተጨምሯል", "success"); onSaved();
    } catch (err) { toast.push(err.message, "error"); } finally { setSaving(false); }
  }

  return (
    <Modal title={isEdit ? "ተግባር አርትዕ" : "ተግባር ጨምር"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field"><label>ርዕስ</label><input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="ለምሳሌ፦ የESIA የመስክ ምርመራ" /></div>
        <div className="field"><label>መግለጫ</label><textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} placeholder="ዝርዝሮች…" /></div>
        <div className="grid grid-2">
          <div className="field">
            <label>ሁኔታ</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {ACTIVITY_STATUS.map((s) => <option key={s} value={s}>{ACTIVITY_STATUS_LABELS[s]}</option>)}
            </select>
          </div>
          <div className="field"><label>ክብደት</label><input type="number" min="0" step="0.5" value={weight} onChange={(e) => setWeight(e.target.value)} /></div>
        </div>
        {canAssignTeams && (
          <div className="field">
            <label>የተመደበ ቡድን</label>
            <select value={team} onChange={(e) => setTeam(e.target.value || "")}>
              <option value="">ቡድን ይምረጡ…</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
        {showAssignee && (
          <div className="field">
            <label>ለ (የቡድን አባል) መድብ</label>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value || "")}>
              <option value="">አባል ይምረጡ…</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}{m.position ? ` (${m.position})` : ""}</option>)}
            </select>
            {members.length === 0 && role === "team_leader" && <span className="hint">የቡድንዎ አባላት እየተጫኑ ነው…</span>}
          </div>
        )}
        {canAssignTeams && !showAssignee && (
          <div className="field"><label>የመጨረሻ ቀን</label><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
        )}
        {!canAssignTeams && !showAssignee && (
          <div className="field"><label>የመጨረሻ ቀን</label><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
        )}
        {showAssignee && (
          <div className="field"><label>የመጨረሻ ቀን</label><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
        )}
        <div className="field">
          <label>የሚያገለግለው ግብ / ዕቅድ (አማራጭ)</label>
          <select value={goal} onChange={(e) => setGoal(e.target.value || "")}>
            <option value="">የለም</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>{g.title}{g.scope ? ` (${g.scope})` : ""}</option>
            ))}
          </select>
          {errMsg && <span className="hint" style={{ color: "var(--rose)" }}>{errMsg}</span>}
          {!errMsg && goals.length === 0 && <span className="hint">በዚህ ወሰን ውስጥ እስካሁን ግብ የለም።</span>}
        </div>
        {canAssignTeams && (
          <div className="field">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <label style={{ margin: 0 }}>የውጤት KPIዎች</label>
              <button type="button" className="btn btn-sm" onClick={() => setKpis([...kpis, { name: "", kpi_type: "numeric", target_value: "", actual_value: "", weight: 1 }])}><Icons.plus size={12} /> KPI ጨምር</button>
            </div>
            {kpis.map((k, i) => (
              <div key={i} className="grid grid-3" style={{ marginBottom: 6 }}>
                <input className="input" placeholder="የKPI ስም" value={k.name} onChange={(e) => updateKpi(i, { name: e.target.value })} />
                <select className="input" value={k.kpi_type} onChange={(e) => updateKpi(i, { kpi_type: e.target.value })}>
                  {KPI_TYPES.map((t) => <option key={t} value={t}>{KPI_TYPE_LABELS[t]}</option>)}
                </select>
                <div style={{ display: "flex", gap: 4 }}>
                  <input className="input" type="number" placeholder="ዒላማ" value={k.target_value} onChange={(e) => updateKpi(i, { target_value: e.target.value })} />
                  <input className="input" type="number" placeholder="ትክክለኛ" value={k.actual_value} onChange={(e) => updateKpi(i, { actual_value: e.target.value })} />
                  <button type="button" className="btn btn-sm" title="አስወግድ" aria-label="አስወግድ" style={{ color: "var(--rose)" }} onClick={() => setKpis(kpis.filter((_, j) => j !== i))}><Icons.trash size={12} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className="btn btn-primary" type="submit" disabled={saving || !title}>{saving ? "በማስቀመጥ ላይ…" : isEdit ? "አሻሽል" : "ጨምር"}</button>
          <button className="btn btn-sm" type="button" onClick={onClose}>ዝጋ</button>
        </div>
      </form>
    </Modal>
  );
}

function KpiForm({ kpi, onClose, onSaved, toast }) {
  const isNew = !kpi?.id;
  const [name, setName] = useState(kpi?.name || "");
  const [kpiType, setKpiType] = useState(kpi?.kpi_type || "percentage");
  const [target, setTarget] = useState(kpi?.target_value ?? "");
  const [actual, setActual] = useState(kpi?.actual_value ?? "");
  const [unit, setUnit] = useState(kpi?.unit || "");
  const [weight, setWeight] = useState(kpi?.weight ?? 1);
  const [direction, setDirection] = useState(kpi?.direction || "higher_is_better");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault(); setSaving(true);
    try {
      const body = {
        name, kpi_type: kpiType,
        target_value: target === "" ? null : Number(target),
        actual_value: actual === "" ? null : Number(actual),
        unit: unit || null, weight: Number(weight), direction,
      };
      if (kpi?.id) await api.put(`/programs/kpis/${kpi.id}`, body);
      else await api.post(`/programs/activities/${kpi.activity_id}/kpis`, body);
      toast.push(kpi?.id ? "KPI ተሻሽሏል" : "KPI ተጨምሯል", "success"); onSaved();
    } catch (err) { toast.push(err.message, "error"); } finally { setSaving(false); }
  }

  return (
    <Modal title={isNew ? "የተግባር KPI ጨምር" : "KPI አርትዕ"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field"><label>ስም</label><input value={name} onChange={(e) => setName(e.target.value)} required placeholder="ለምሳሌ፦ የተላለፉ የሥራ ነጥቦች" /></div>
        <div className="grid grid-2">
          <div className="field">
            <label>ዓይነት</label>
            <select value={kpiType} onChange={(e) => setKpiType(e.target.value)}>
              {KPI_TYPES.map((t) => <option key={t} value={t}>{KPI_TYPE_LABELS[t]}</option>)}
            </select>
          </div>
          <div className="field">
            <label>አቅጣጫ</label>
            <select value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="higher_is_better">ከፍ ያለ ይሻላል</option>
              <option value="lower_is_better">ዝቅ ያለ ይሻላል</option>
              <option value="target_is_best">የታለመው ይሻላል</option>
            </select>
          </div>
        </div>
        <div className="grid grid-3">
          <div className="field"><label>ዒላማ</label><input type="number" min="0" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="100" /></div>
          <div className="field"><label>ትክክለኛ</label><input type="number" min="0" value={actual} onChange={(e) => setActual(e.target.value)} placeholder="85" /></div>
          <div className="field"><label>መለኪያ</label><input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="ነጥቦች" /></div>
        </div>
        <div className="field"><label>ክብደት</label><input type="number" min="0" step="0.5" value={weight} onChange={(e) => setWeight(e.target.value)} /></div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className="btn btn-primary" type="submit" disabled={saving || !name}>{saving ? "በማስቀመጥ ላይ…" : isNew ? "ጨምር" : "አሻሽል"}</button>
          <button className="btn btn-sm" type="button" onClick={onClose}>ዝጋ</button>
        </div>
      </form>
    </Modal>
  );
}

function ProgressForm({ activity, onClose, onSaved, toast }) {
  const [pct, setPct] = useState(activity.progress_pct ?? 0);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const hasKpis = activity.kpis && activity.kpis.length > 0;

  async function submit(e) {
    e.preventDefault(); setSaving(true);
    try {
      await api.post(`/programs/activities/${activity.id}/progress`, { progress_pct: Number(pct), notes: notes || null });
      toast.push("አፈጻጸሙ ተመዝግቧል", "success"); onSaved();
    } catch (err) { toast.push(err.message, "error"); } finally { setSaving(false); }
  }

  if (hasKpis) {
    return (
      <Modal title={`አፈጻጸም — ${activity.title}`} onClose={onClose}>
        <div style={{ padding: "8px 0", fontSize: 13 }}>
          <div style={{ marginBottom: 8, color: "var(--text-dim)" }}>
            አፈጻጸም ከKPI ትክክለኛ ዋጋዎች በራስ-ሰር ይሰላል።
          </div>
          <div style={{ fontWeight: 500, fontSize: 24, textAlign: "center", padding: "16px 0" }}>
            {activity.progress_pct ?? 0}%
          </div>
          <div style={{ textAlign: "center", color: "var(--text-dim)", fontSize: 12 }}>
            አፈጻጸሙን ለመቀየር የKPI ትክክለኛ ዋጋዎችን ያሻሽሉ
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-sm" type="button" onClick={onClose}>ዝጋ</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`አፈጻጸም መዝግብ — ${activity.title}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label>አፈጻጸም፦ {pct}%</label>
          <input type="range" min="0" max="100" step="5" value={pct} onChange={(e) => setPct(e.target.value)} style={{ width: "100%" }} />
        </div>
        <div className="field"><label>ማስታወሻ</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="ምን ተከናወነ? …" /></div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "በማስቀመጥ ላይ…" : "መዝግብ"}</button>
          <button className="btn btn-sm" type="button" onClick={onClose}>ዝጋ</button>
        </div>
      </form>
    </Modal>
  );
}
