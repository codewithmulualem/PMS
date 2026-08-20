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

const STATUS_COLORS = {
  planning: "var(--slate)", in_progress: "var(--indigo)", on_hold: "var(--amber)",
  completed: "var(--teal)", cancelled: "var(--muted)",
};
const ACTIVITY_STATUS = ["not_started", "in_progress", "on_hold", "completed"];
const ACTIVITY_STATUS_LABELS = { not_started: "Not started", in_progress: "In progress", on_hold: "On hold", completed: "Completed" };
const KPI_TYPES = ["percentage", "numeric", "milestone"];
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
  const isManager = user?.role === "manager" || user?.role === "admin" || user?.role === "executive";

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

  const loadPrograms = useCallback(async () => {
    try {
      const qs = cycleId ? `?cycle_id=${cycleId}` : "";
      setPrograms(await api.get(`/programs${qs}`));
    } catch (err) { toast.push(err.message, "error"); }
  }, [cycleId]);

  const loadDetail = useCallback(async (id) => {
    try { setDetail(await api.get(`/programs/${id}`)); } catch (err) { toast.push(err.message, "error"); }
  }, []);

  useEffect(() => { loadPrograms(); }, [loadPrograms]);
  useEffect(() => { if (selectedId) loadDetail(selectedId); }, [selectedId, loadDetail]);

  if (programs === null) return <Skeleton rows={6} />;

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
      <Topbar title={selectedId && detail ? detail.name : "Programs"}>
        {isManager && !selectedId && (
          <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
            <Icons.plus size={14} /> New Program
          </button>
        )}
      </Topbar>

      {!selectedId && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
            <input
              className="input"
              placeholder="Search programs…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, maxWidth: 320 }}
            />
            <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 160 }}>
              <option value="all">All statuses</option>
              {["planning", "in_progress", "on_hold", "completed"].map((s) => (
                <option key={s} value={s}>{s.replace("_", " ")}</option>
              ))}
            </select>
          </div>
          <div className="card-stack">
            {filtered.length === 0 && <div className="text-faint" style={{ padding: 20 }}>No programs{cycleId ? " in this cycle" : ""}{search ? " match your search" : ""}.</div>}
            {filtered.map((p) => (
              <div key={p.id} className="card" style={{ cursor: "pointer" }} onClick={() => setSelectedId(p.id)}>
                <div className="flex-between" style={{ marginBottom: 6 }}>
                  <div className="cell-strong">{p.name}</div>
                  <span className="chip" style={{ color: STATUS_COLORS[p.status] || "var(--text)", borderColor: STATUS_COLORS[p.status] || "var(--border)" }}>{p.status}</span>
                </div>
                {p.description && <div className="text-faint" style={{ fontSize: 13, marginBottom: 6 }}>{p.description}</div>}
                <div className="flex-between" style={{ fontSize: 13 }}>
                  <span className="text-faint">Owner: {p.owner_name || "—"}</span>
                  <span className="text-faint">{p.completed_activities}/{p.activity_count} activities</span>
                </div>
                {p.activity_count > 0 && (
                  <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-dim)" }}>
                    {p.completed_activities} of {p.activity_count} activities completed ({Math.round(p.completed_activities / p.activity_count * 100)}%)
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {selectedId && !detail && <Skeleton rows={4} />}

      {selectedId && detail && (
        <ProgramDetail
          program={detail}
          onBack={() => { setSelectedId(null); setDetail(null); }}
          onRefresh={() => loadDetail(selectedId)}
          onListRefresh={loadPrograms}
          isManager={isManager} toast={toast} user={user}
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

function ProgramDetail({ program, onBack, onRefresh, onListRefresh, isManager, toast, user, addingActivity, setAddingActivity, editActivity, setEditActivity, editKpi, setEditKpi, progressActivity, setProgressActivity, editProj, setEditProj }) {
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
    if (!window.confirm("Delete this program and all its activities? This cannot be undone.")) return;
    try {
      await api.delete(`/programs/${program.id}`);
      toast.push("Program deleted", "success");
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
        <button className="btn btn-sm" onClick={onBack}><Icons.chevronLeft size={14} /> Back</button>
        {isManager && (
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-sm" onClick={() => setEditProj(program)} title="Edit program"><Icons.edit size={14} /></button>
            {canDelete && (
              <button className="btn btn-sm" onClick={() => setConfirmDelete(true)} title="Delete program" style={{ color: "var(--rose)" }}><Icons.trash size={14} /></button>
            )}
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="cell-strong" style={{ fontSize: 18, marginBottom: 4 }}>{program.name}</div>
        {program.description && <div className="text-faint" style={{ marginBottom: 8 }}>{program.description}</div>}
        <div className="text-faint" style={{ fontSize: 13 }}>
          Owner: {program.owner_name || "—"} · Status: <span style={{ color: STATUS_COLORS[program.status] }}>{program.status}</span>
          {program.start_date && ` · Start: ${program.start_date}`}{program.due_date && ` · Due: ${program.due_date}`}
          {program.weight > 1 && ` · Weight: ${program.weight}`}
        </div>

        {loadingScore && <div className="text-faint" style={{ marginTop: 10, fontSize: 13 }}>Computing score…</div>}
        {scoreData && scoreData.score != null && (
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
            <ScoreRing score={scoreData.score} size={40} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{scoreData.score}%</div>
              <div className="text-faint" style={{ fontSize: 12 }}>Automated KPI-derived accomplishment</div>
            </div>
          </div>
        )}
        {scoreData && scoreData.score == null && (
          <div className="text-faint" style={{ marginTop: 10, fontSize: 13 }}>No scored activities yet — assign activities with KPIs to generate a score.</div>
        )}
      </div>

      {isManager && (
        <div style={{ marginBottom: 10 }}>
          <button className="btn btn-sm btn-primary" onClick={() => setAddingActivity("root")}><Icons.plus size={14} /> Add Activity</button>
        </div>
      )}

      {(!program.activities || program.activities.length === 0) && <div className="text-faint" style={{ padding: 12 }}>No activities yet.</div>}
      {program.activities && program.activities.map((t) => (
        <TaskNode key={t.id} activity={t} depth={0} isManager={isManager} toast={toast} user={user}
          onRefresh={wrappedRefresh} setAddingActivity={setAddingActivity} setEditActivity={setEditActivity} setEditKpi={setEditKpi} setProgressActivity={setProgressActivity} />
      ))}

      {confirmDelete && (
        <Modal title="Delete Program" onClose={() => setConfirmDelete(false)}>
          <p style={{ fontSize: 14, marginBottom: 12 }}>Are you sure you want to delete <strong>{program.name}</strong> and all its activities? This cannot be undone.</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" onClick={deleteProgram} style={{ background: "var(--rose)" }}>Delete</button>
            <button className="btn btn-sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
          </div>
        </Modal>
      )}

      {addingActivity === "root" && <TaskForm programId={program.id} onClose={() => setAddingActivity(null)} onSaved={() => { setAddingActivity(null); wrappedRefresh(); }} toast={toast} />}
      {addingActivity && addingActivity !== "root" && (
        <TaskForm parentId={addingActivity} programId={program.id} onClose={() => setAddingActivity(null)} onSaved={() => { setAddingActivity(null); wrappedRefresh(); }} toast={toast} />
      )}
      {editActivity && <TaskForm activity={editActivity} programId={program.id} onClose={() => setEditActivity(null)} onSaved={() => { setEditActivity(null); wrappedRefresh(); }} toast={toast} />}
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
              <button className="btn btn-sm" onClick={() => setEditActivity(activity)} title="Edit"><Icons.edit size={13} /></button>
              {canAddSubactivity
                ? <button className="btn btn-sm" onClick={() => setAddingActivity(activity.id)} title="Add subactivity"><Icons.plus size={13} /></button>
                : <span title="Maximum nesting depth reached" style={{ cursor: "not-allowed", opacity: 0.35 }}><Icons.plus size={13} /></span>
              }
              {(!activity.kpis || activity.kpis.length === 0) && (
                <button className="btn btn-sm" onClick={() => setProgressActivity(activity)} title="Log progress"><Icons.chart size={13} /></button>
              )}
              <button className="btn btn-sm" onClick={() => deleteActivity(activity.id, toast, onRefresh)} title="Delete activity"><Icons.trash size={13} /></button>
            </>
          )}
          <button className="btn btn-sm" onClick={toggleHistory} title="Progress history"><Icons.clock size={13} /></button>
        </div>
      </div>
      <div className="text-faint" style={{ fontSize: 12, marginLeft: 26 }}>
        {activity.assignee_name ? `Assigned to: ${activity.assignee_name}` : "Unassigned"}
        {activity.weight > 1 ? ` · Weight: ${activity.weight}` : ""}
        {activity.assigned_by_name ? ` · Delegated by: ${activity.assigned_by_name}` : ""}
      </div>

      {open && (
        <div style={{ marginTop: 8, marginLeft: 26 }}>
            {activity.kpis && activity.kpis.length > 0 && activity.kpis.map((k) => (
              <KpiRow key={k.id} kpi={k} isManager={isManager} setEditKpi={setEditKpi} onRefresh={onRefresh} toast={toast} user={user} activity={activity} />
            ))}
          {isManager && (
            <button className="btn btn-sm" style={{ marginTop: 4 }} onClick={() => setEditKpi({ activity_id: activity.id })}>
              <Icons.plus size={12} /> Add KPI
            </button>
          )}
          {hasChildren && activity.children.map((c) => (
            <TaskNode key={c.id} activity={c} depth={depth + 1} isManager={isManager} toast={toast} user={user}
              onRefresh={onRefresh} setAddingActivity={setAddingActivity} setEditActivity={setEditActivity} setEditKpi={setEditKpi} setProgressActivity={setProgressActivity} />
          ))}
          {history && (
            <div style={{ marginTop: 6, padding: 8, background: "var(--bg-muted)", borderRadius: 6, fontSize: 12 }}>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>Progress History</div>
              {history.length === 0 && <div className="text-faint">No entries yet.</div>}
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
  { label: "Not started", value: 0 },
  { label: "25%", value: 25 },
  { label: "50%", value: 50 },
  { label: "75%", value: 75 },
  { label: "Done", value: 100 },
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
      toast.push(`Progress set to ${pct}%`, "success");
      if (onRefresh) onRefresh();
    } catch (err) { toast.push(err.message, "error"); }
  }

  async function deleteKpi(e) {
    e.stopPropagation();
    if (!window.confirm(`Delete KPI "${kpi.name}"?`)) return;
    try {
      await api.delete(`/programs/kpis/${kpi.id}`);
      toast.push("KPI deleted", "success");
      if (onRefresh) onRefresh();
    } catch (err) { toast.push(err.message, "error"); }
  }

  if (kpi.kpi_type === "milestone") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13, borderBottom: "1px solid var(--border-light)" }}>
        <span style={{ fontWeight: 500 }}>{kpi.name}</span>
        <span className="chip" style={{ fontSize: 11 }}>milestone</span>
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
              ? <span className="chip chip-success" style={{ fontSize: 11 }}>complete</span>
              : <span className="chip chip-warning" style={{ fontSize: 11 }}>incomplete</span>}
          </>
        )}
        {isManager && (
          <span style={{ display: "flex", gap: 4 }}>
            <button className="btn btn-sm" onClick={() => setEditKpi(kpi)} title="Edit KPI"><Icons.edit size={12} /></button>
            <button className="btn btn-sm" onClick={deleteKpi} title="Delete KPI" style={{ color: "var(--rose)" }}><Icons.trash size={12} /></button>
          </span>
        )}
      </div>
    );
  }
  const dirLabel = kpi.direction === "lower_is_better" ? "lower better" : kpi.direction === "target_is_best" ? "target best" : "higher better";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13, borderBottom: "1px solid var(--border-light)" }}>
      <span style={{ fontWeight: 500 }}>{kpi.name}</span>
      <span className="chip" style={{ fontSize: 11 }}>{kpi.kpi_type}</span>
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
          <button className="btn btn-sm" onClick={() => setEditKpi(kpi)} title="Edit KPI"><Icons.edit size={12} /></button>
          <button className="btn btn-sm" onClick={deleteKpi} title="Delete KPI" style={{ color: "var(--rose)" }}><Icons.trash size={12} /></button>
        </span>
      ) : null}
    </div>
  );
}

async function deleteActivity(id, toast, onRefresh) {
  if (!window.confirm("Delete this activity and all subactivities?")) return;
  try { await api.delete(`/programs/activities/${id}`); toast.push("Activity deleted", "success"); onRefresh(); }
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
      toast.push(program ? "Program updated" : "Program created", "success"); onSaved();
    } catch (err) { toast.push(err.message, "error"); } finally { setSaving(false); }
  }

  return (
    <Modal title={program ? "Edit Program" : "New Program"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field"><label>Program name</label><input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Clear ESIA Backlog" /></div>
        <div className="field"><label>Description</label><textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} placeholder="Scope and objectives…" /></div>
        <div className="grid grid-3">
          <div className="field">
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {["planning", "in_progress", "on_hold", "completed", "cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="field"><label>Due date</label><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
          <div className="field"><label>Weight</label><input type="number" min="0" step="0.5" value={weight} onChange={(e) => setWeight(e.target.value)} /></div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className="btn btn-primary" type="submit" disabled={saving || !name}>{saving ? "Saving…" : program ? "Update" : "Create"}</button>
          <button className="btn btn-sm" type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

function TaskForm({ activity, parentId, programId, onClose, onSaved, toast }) {
  const [title, setTitle] = useState(activity?.title || "");
  const [desc, setDesc] = useState(activity?.description || "");
  const [assignee, setAssignee] = useState(activity?.assignee_id || "");
  const [status, setStatus] = useState(activity?.status || "not_started");
  const [weight, setWeight] = useState(activity?.weight ?? 1);
  const [startDate, setStartDate] = useState(activity?.start_date || "");
  const [due, setDue] = useState(activity?.due_date || "");
  const [saving, setSaving] = useState(false);
  const [assignable, setAssignable] = useState([]);
  const [assignErr, setAssignErr] = useState(null);

  useEffect(() => {
    api.get("/programs/assignable").then(setAssignable).catch((err) => setAssignErr(err.message));
  }, []);

  async function submit(e) {
    e.preventDefault(); setSaving(true);
    try {
      const body = {
        title, description: desc || null,
        assignee_id: assignee ? Number(assignee) : null,
        status, weight: Number(weight),
        start_date: startDate || null, due_date: due || null,
        parent_id: activity ? (activity.parent_id || null) : (parentId !== "root" ? parentId : null),
      };
      if (activity) await api.put(`/programs/activities/${activity.id}`, body);
      else await api.post(`/programs/${programId}/activities`, body);
      toast.push(activity ? "Task updated" : "Task added", "success"); onSaved();
    } catch (err) { toast.push(err.message, "error"); } finally { setSaving(false); }
  }

  return (
    <Modal title={activity ? "Edit Task" : "Add Activity"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field"><label>Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Design landing page" /></div>
        <div className="field"><label>Description</label><textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} placeholder="Details…" /></div>
        <div className="grid grid-2">
          <div className="field">
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {ACTIVITY_STATUS.map((s) => <option key={s} value={s}>{ACTIVITY_STATUS_LABELS[s]}</option>)}
            </select>
          </div>
          <div className="field"><label>Weight</label><input type="number" min="0" step="0.5" value={weight} onChange={(e) => setWeight(e.target.value)} /></div>
        </div>
        <div className="grid grid-2">
          <div className="field">
            <label>Assign to (direct reports)</label>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value || "")}>
              <option value="">Unassigned</option>
              {assignable.map((e) => <option key={e.id} value={e.id}>{e.full_name}{e.department_name ? ` (${e.department_name})` : ""}</option>)}
            </select>
            {assignErr && <span className="hint" style={{ color: "var(--rose)" }}>{assignErr}</span>}
            {!assignErr && assignable.length === 0 && <span className="hint">No direct reports found</span>}
          </div>
          <div className="field"><label>Due date</label><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
        </div>
        <div className="field"><label>Start date</label><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className="btn btn-primary" type="submit" disabled={saving || !title}>{saving ? "Saving…" : activity ? "Update" : "Add"}</button>
          <button className="btn btn-sm" type="button" onClick={onClose}>Cancel</button>
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
      toast.push(kpi?.id ? "KPI updated" : "KPI added", "success"); onSaved();
    } catch (err) { toast.push(err.message, "error"); } finally { setSaving(false); }
  }

  return (
    <Modal title={isNew ? "Add Activity KPI" : "Edit KPI"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Story points delivered" /></div>
        <div className="grid grid-2">
          <div className="field">
            <label>Type</label>
            <select value={kpiType} onChange={(e) => setKpiType(e.target.value)}>
              {KPI_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Direction</label>
            <select value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="higher_is_better">Higher is better</option>
              <option value="lower_is_better">Lower is better</option>
              <option value="target_is_best">Target is best</option>
            </select>
          </div>
        </div>
        <div className="grid grid-3">
          <div className="field"><label>Target</label><input type="number" min="0" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="100" /></div>
          <div className="field"><label>Actual</label><input type="number" min="0" value={actual} onChange={(e) => setActual(e.target.value)} placeholder="85" /></div>
          <div className="field"><label>Unit</label><input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="points" /></div>
        </div>
        <div className="field"><label>Weight</label><input type="number" min="0" step="0.5" value={weight} onChange={(e) => setWeight(e.target.value)} /></div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className="btn btn-primary" type="submit" disabled={saving || !name}>{saving ? "Saving…" : isNew ? "Add" : "Update"}</button>
          <button className="btn btn-sm" type="button" onClick={onClose}>Cancel</button>
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
      toast.push("Progress logged", "success"); onSaved();
    } catch (err) { toast.push(err.message, "error"); } finally { setSaving(false); }
  }

  if (hasKpis) {
    return (
      <Modal title={`Progress — ${activity.title}`} onClose={onClose}>
        <div style={{ padding: "8px 0", fontSize: 13 }}>
          <div style={{ marginBottom: 8, color: "var(--text-dim)" }}>
            Progress is automatically calculated from KPI actual values.
          </div>
          <div style={{ fontWeight: 500, fontSize: 24, textAlign: "center", padding: "16px 0" }}>
            {activity.progress_pct ?? 0}%
          </div>
          <div style={{ textAlign: "center", color: "var(--text-dim)", fontSize: 12 }}>
            Update KPI actual values to change progress
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-sm" type="button" onClick={onClose}>Close</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Log Progress — ${activity.title}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label>Progress: {pct}%</label>
          <input type="range" min="0" max="100" step="5" value={pct} onChange={(e) => setPct(e.target.value)} style={{ width: "100%" }} />
        </div>
        <div className="field"><label>Notes</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="What was accomplished…" /></div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Log"}</button>
          <button className="btn btn-sm" type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}
