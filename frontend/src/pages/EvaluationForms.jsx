import { useEffect, useState } from "react";
import { api } from "../api";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import Topbar from "../components/Topbar";
import Modal from "../components/Modal";
import Skeleton from "../components/Skeleton";
import { Icons } from "../components/icons";
import { perspectiveLabel, statusLabel } from "../i18n";

const STATUS_CHIP = {
  draft: "chip-neutral", submitted: "chip-indigo", in_review: "chip-warn",
  rejected: "chip-danger", scored: "chip-success",
};
const PERSPECTIVE_LABEL = { self: "የራስ", manager: "የአስተዳዳሪ", peer: "የሥራ ባልደረባ" };

export default function EvaluationForms() {
  const toast = useToast();
  const [tab, setTab] = useState("forms");
  const [forms, setForms] = useState(null);
  const [error, setError] = useState(null);
  const [building, setBuilding] = useState(null);

  async function load() {
    try {
      setForms(await api.get("/evaluation-forms"));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div>
      <Topbar subtitle="የሚደገሙ የግምገማ ቅጾችን ያዘጋጁ፣ በዑደት ይመድቡ እና ሁሉንም ምላሾች ይከታተሉ" />

      {error && <div className="error-banner">{error}</div>}

      <div className="segmented" style={{ marginBottom: 18 }}>
        <button className={tab === "forms" ? "active" : ""} onClick={() => setTab("forms")}>ቅጾች</button>
        <button className={tab === "assignments" ? "active" : ""} onClick={() => setTab("assignments")}>ምደባዎች</button>
      </div>

      {tab === "forms" ? (
        building ? (
          <FormBuilder formId={building} onBack={() => setBuilding(null)} onChanged={load} toast={toast} />
        ) : (
          <FormsList forms={forms} onEdit={setBuilding} onChanged={load} toast={toast} />
        )
      ) : (
        <AssignmentsTable toast={toast} />
      )}
    </div>
  );
}

function FormsList({ forms, onEdit, onChanged, toast }) {
  const [showNew, setShowNew] = useState(false);
  const [showAssign, setShowAssign] = useState(null);

  async function remove(f) {
    if (!confirm(`የ"${f.name}" ቅጽ በቋሚነት ይሰረዝ? ምደባዎቹ፣ መልሶቹና የማጽደቅ ታሪኩ ይወገዳሉ። ይህ መመለስ የማይችል ነው።`)) return;
    try {
      await api.delete(`/evaluation-forms/${f.id}`);
      toast.push(`“${f.name}” ቅጽ ተሰርዟል`, "success");
      onChanged();
    } catch (e) { toast.push(e.message, "error"); }
  }

  if (forms === null) return <Skeleton lines={5} height={24} />;

  return (
    <div className="card">
      <div className="card-title">
        የቅጽ አብነቶች
        <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><Icons.plus size={13} /> አዲስ ቅጽ</button>
      </div>
      {forms.length === 0 ? (
        <div className="empty-state">እስካሁን የግምገማ ቅጽ የለም። የመጀመሪያውን የቅጽ አብነት ይፍጠሩ።</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>ቅጽ</th><th className="num">ክፍሎች</th><th className="num">ጥያቄዎች</th><th className="num">ከፍተኛ ደረጃ</th><th>ሁኔታ</th><th className="num" /></tr>
            </thead>
            <tbody>
              {forms.map((f) => (
                <tr key={f.id}>
                  <td>
                    <div className="cell-strong">{f.name}</div>
                    <div className="cell-sub">{f.description || "—"}</div>
                  </td>
                  <td className="num">{f.section_count}</td>
                  <td className="num">{f.question_count}</td>
                  <td className="num">{f.approval_levels}</td>
                  <td>{f.active ? <span className="chip chip-success">ንቁ</span> : <span className="chip chip-neutral">ተመዝግቧል</span>}</td>
                    <td className="num">
                      <div className="flex gap-8" style={{ justifyContent: "flex-end" }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => setShowAssign(f.id)}><Icons.send size={13} /> መድብ</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => onEdit(f.id)}><Icons.edit size={13} /> አርትዕ</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => remove(f)}><Icons.trash size={13} /> ሰርዝ</button>
                      </div>
                    </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <NewFormModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); onChanged(); }} toast={toast} />
      )}
      {showAssign && (
        <AssignModal formId={showAssign} onClose={() => setShowAssign(null)} onDone={() => { setShowAssign(null); onChanged(); }} toast={toast} />
      )}
    </div>
  );
}

function NewFormModal({ onClose, onCreated, toast }) {
  const [form, setForm] = useState({ name: "", description: "", approval_levels: 2 });
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/evaluation-forms", form);
      toast.push(`“${form.name}” ቅጽ ተፈጥሯል`, "success");
      onCreated();
    } catch (err) {
      toast.push(err.message, "error");
      setSaving(false);
    }
  }

  return (
    <Modal title="አዲስ የግምገማ ቅጽ" subtitle="የሚደገም ቅጽ — ክፍሎቹ የግምገማ አቅጣጫዎች ይሆናሉ" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label>የቅጽ ስም</label>
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ለምሳሌ፦ የ2018 ዓ.ም. የአፈጻጸም ግምገማ" />
        </div>
        <div className="field">
          <label>መግለጫ</label>
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="የዚህ ግምገማ ዓላማ እና ወሰን…" />
        </div>
        <div className="field">
          <label>ከፍተኛ የማጽደቅ ደረጃ</label>
          <select value={form.approval_levels} onChange={(e) => setForm({ ...form, approval_levels: Number(e.target.value) })}>
            <option value={1}>1 — ቀጥተኛ አስተዳዳሪ ብቻ</option>
            <option value={2}>2 — አስተዳዳሪ፣ ከዚያ የእሱ አስተዳዳሪ</option>
            <option value={3}>3 — ሦስት የትዕዛዝ ሰንሰለት ደረጃዎች</option>
          </select>
          <span className="hint">ግምገማው የሚያልፍባቸውን ደረጃዎች ይወስናል። ትክክለኛው ደረጃ ከዚህ ገደብ እና ከሰራተኛው የሪፖርት ሰንሰለት ትንሹ ነው።</span>
        </div>
        <div className="flex gap-8" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>ሰርዝ</button>
          <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "በመፍጠር ላይ…" : "ቅጽ ፍጠር"}</button>
        </div>
      </form>
    </Modal>
  );
}

function defaultDue() {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
}

function AssignModal({ formId, onClose, onDone, toast }) {
  const [form, setForm] = useState(null);
  const [cycles, setCycles] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [cycle, setCycle] = useState(null);
  const [due, setDue] = useState(defaultDue());
  const [selected, setSelected] = useState({});
  const [mgrOn, setMgrOn] = useState({});
  const [peersOn, setPeersOn] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api.get("/evaluation-forms/" + formId), api.get("/cycles"), api.get("/employees")])
      .then(([f, c, e]) => {
        setForm(f);
        setCycles(c);
        setEmployees(e.filter((x) => x.employment_status === "active"));
        setCycle(c.find((x) => x.status === "active")?.id || c[0]?.id || null);
      })
      .catch((err) => toast.push(err.message, "error"));
  }, [formId, toast]);

  if (!form) return <Modal title="በመጫን ላይ…" onClose={onClose}><div className="empty-state">በመጫን ላይ…</div></Modal>;

  const perspectives = new Set(form.sections.map((s) => s.perspective));
  const needsManager = perspectives.has("manager");
  const needsPeer = perspectives.has("peer");
  const selectedIds = Object.entries(selected).filter(([, v]) => v).map(([k]) => Number(k));

  const empById = Object.fromEntries(employees.map((e) => [e.id, e]));

  function toggleEmployee(id) {
    setSelected((s) => {
      const next = { ...s, [id]: !s[id] };
      if (next[id] && needsManager) {
        const mgrId = empById[id]?.manager_id;
        setMgrOn((m) => ({ ...m, [id]: mgrId ? true : false }));
      }
      if (!next[id]) {
        setMgrOn((m) => ({ ...m, [id]: false }));
        setPeersOn((p) => ({ ...p, [id]: [] }));
      }
      return next;
    });
  }

  function togglePeer(subjectId, peerId) {
    setPeersOn((p) => {
      const cur = p[subjectId] || [];
      return { ...p, [subjectId]: cur.includes(peerId) ? cur.filter((x) => x !== peerId) : [...cur, peerId] };
    });
  }

  async function assign() {
    if (!selectedIds.length || !cycle) return;
    setSaving(true);
    try {
      const payload = {
        cycle_id: cycle,
        due_date: due || undefined,
        assignments: selectedIds.map((id) => ({
          employee_id: id,
          with_manager: !!mgrOn[id],
          peer_ids: peersOn[id] || [],
        })),
      };
      const res = await api.post(`/evaluation-forms/${formId}/assign`, payload);
      const createdN = res.created?.length || 0;
      const blockedN = res.blocked?.length || 0;
      let msg = `${createdN} ምደባ(ዎች) ተፈጥረዋል`;
      if (res.skipped) msg += ` · ${res.skipped} ተዘልለዋል`;
      if (blockedN) msg += ` · ${blockedN} የአመራር ሚና(ዎች) ተገልለዋል (በእጅ ግምገማ የለም)`;
      toast.push(msg, blockedN ? "info" : "success");
      onDone();
    } catch (err) {
      toast.push(err.message, "error");
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`“${form.name}” መድብ`}
      subtitle="ይህን ቅጽ ለተመረጡ ሰራተኞች በተመረጠው ዑደት ይስጡ — የ360 ገምጋሚዎች ከራስ ግምገማቸው ጋር አብረው ይፈጠራሉ"
      onClose={onClose}
      wide
      footer={
        <div className="flex gap-8" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-secondary" onClick={onClose}>ሰርዝ</button>
          <button className="btn btn-primary" onClick={assign} disabled={saving || !cycle || !selectedIds.length}>
            <Icons.send size={14} /> {saving ? "በመመደብ ላይ…" : `ለ${selectedIds.length} ሰራተኛ መድብ`}
          </button>
        </div>
      }
    >
      <div className="form-grid" style={{ marginBottom: 8 }}>
        <div className="field">
          <label>ዑደት</label>
          <select value={cycle || ""} onChange={(e) => setCycle(Number(e.target.value))}>
            {cycles.map((c) => <option key={c.id} value={c.id}>{c.name} {c.status === "active" ? "• ንቁ" : ""}</option>)}
          </select>
        </div>
        <div className="field">
          <label>የመጨረሻ ቀን</label>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
      </div>

      <div className="flex-between" style={{ margin: "6px 0 4px" }}>
        <span className="text-dim" style={{ fontSize: 12.5, fontWeight: 600 }}>ሰራተኞች</span>
        <button className="btn-ghost btn btn-sm" onClick={() => {
          const all = Object.fromEntries(employees.map((e) => [e.id, true]));
          setSelected(all);
          if (needsManager) {
            const mg = Object.fromEntries(employees.map((e) => [e.id, !!e.manager_id]));
            setMgrOn(mg);
          }
        }}>ሁሉንም ምረጥ</button>
      </div>
      <div className="assign-grid">
        {employees.map((e) => (
          <label key={e.id} className={`assign-item ${selected[e.id] ? "on" : ""}`}>
            <input type="checkbox" checked={!!selected[e.id]} onChange={() => toggleEmployee(e.id)} />
            <div>
              <div className="cell-strong" style={{ fontSize: 13 }}>{e.full_name}</div>
              <div className="cell-sub">{e.position || "—"} {e.department_name ? `· ${e.department_name}` : ""}</div>
            </div>
          </label>
        ))}
      </div>

      {(needsManager || needsPeer) && selectedIds.length > 0 && (
        <div className="reviewer-block">
          <div className="card-title" style={{ margin: "14px 0 4px" }}>የ360 ገምጋሚዎች</div>
          <div className="text-faint" style={{ fontSize: 12, marginBottom: 8 }}>
            ቅጹ {[needsManager && "የአስተዳዳሪ", needsPeer && "የሥራ ባልደረባ"].filter(Boolean).join(" + ")} አቅጣጫ(ዎች)ን ይዟል። ከዚህ በታች ለእያንዳንዱ ሰራተኛ ይመድቡ።
          </div>
          {selectedIds.map((id) => {
            const emp = empById[id];
            if (!emp) return null;
            const mgr = emp.manager_id ? empById[emp.manager_id] : null;
            return (
              <div key={id} className="reviewer-row">
                <div className="reviewer-subject">
                  <div className="cell-strong">{emp.full_name}</div>
                  <div className="cell-sub">{emp.position}</div>
                </div>
                <div className="reviewer-opts">
                  {needsManager && (
                    <label className={`reviewer-toggle ${mgrOn[id] ? "on" : ""}`}>
                      <input type="checkbox" checked={!!mgrOn[id]} disabled={!emp.manager_id} onChange={() => setMgrOn((m) => ({ ...m, [id]: !m[id] }))} />
                      <span>
                        <b>የአስተዳዳሪ ግምገማ</b>
                        <div className="cell-sub">{emp.manager_id ? `በ ${mgr?.full_name || "አስተዳዳሪው"}` : "በድርጅቱ ውስጥ አስተዳዳሪ የለም"}</div>
                      </span>
                    </label>
                  )}
                  {needsPeer && (
                    <div className="reviewer-peers">
                      <span className="text-dim" style={{ fontSize: 12, fontWeight: 600 }}>የሥራ ባልደረባ ገምጋሚዎች</span>
                      <div className="peer-chips">
                        {employees.filter((p) => p.id !== id).map((p) => {
                          const on = (peersOn[id] || []).includes(p.id);
                          return (
                            <button key={p.id} type="button" className={`peer-chip ${on ? "active" : ""}`} onClick={() => togglePeer(id, p.id)}>
                              {p.full_name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

function FormBuilder({ formId, onBack, onChanged, toast }) {
  const [form, setForm] = useState(null);

  useEffect(() => {
    api.get(`/evaluation-forms/${formId}`).then(setForm).catch((e) => toast.push(e.message, "error"));
  }, [formId, toast]);

  if (!form) return <Skeleton lines={6} height={20} />;

  async function updateMeta(patch) {
    const next = { ...form, ...patch };
    setForm(next);
    try { await api.put(`/evaluation-forms/${formId}`, patch); } catch (e) { toast.push(e.message, "error"); }
  }

  async function addSection(perspective = "self") {
    try {
      await api.post(`/evaluation-forms/${formId}/sections`, { title: "New perspective", weight: 1, perspective });
      toast.push("ክፍሉ ተጨምሯል", "success");
      setForm(await api.get(`/evaluation-forms/${formId}`));
      onChanged();
    } catch (e) { toast.push(e.message, "error"); }
  }

  async function addQuestion(sectionId, kind) {
    try {
      await api.post(`/evaluation-form-sections/${sectionId}/questions`, {
        text: "አዲስ ጥያቄ", kind,
        max_score: kind === "rating" ? 5 : kind === "scale" ? 100 : null,
      });
      setForm(await api.get(`/evaluation-forms/${formId}`));
      onChanged();
    } catch (e) { toast.push(e.message, "error"); }
  }

  async function refresh() {
    setForm(await api.get(`/evaluation-forms/${formId}`));
  }

  return (
    <div className="card">
      <div className="flex-between" style={{ marginBottom: 16 }}>
        <button className="back-btn" onClick={onBack}><Icons.chevronLeft size={15} /> ሁሉም ቅጾች</button>
        <div className="flex gap-8">
          <button className="btn btn-secondary btn-sm" onClick={() => updateMeta({ active: form.active ? 0 : 1 })}>
            {form.active ? "ወደ መዝገብ አስገባ" : "እንደገና አንቃ"}
          </button>
        </div>
      </div>

      <div className="form-grid" style={{ marginBottom: 8 }}>
        <div className="field">
          <label>የቅጽ ስም</label>
          <input value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onBlur={() => updateMeta({ name: form.name })} />
        </div>
        <div className="field">
          <label>ከፍተኛ የማጽደቅ ደረጃ</label>
          <select value={form.approval_levels} onChange={(e) => updateMeta({ approval_levels: Number(e.target.value) })}>
            <option value={1}>1 — ቀጥተኛ አስተዳዳሪ</option>
            <option value={2}>2 — አስተዳዳሪ + የእሱ አስተዳዳሪ</option>
            <option value={3}>3 — ሦስት ደረጃዎች</option>
          </select>
          <span className="hint">ለእያንዳንዱ ሰራተኛ የሚሠራው ደረጃ ከዚህ ገደብ እና ከሪፖርት ሰንሰለቱ ትንሹ ነው።</span>
        </div>
      </div>
      <div className="field">
        <label>መግለጫ</label>
        <input value={form.description || ""}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          onBlur={() => updateMeta({ description: form.description })} />
      </div>

      <div className="divider" />

      <div className="form-grid" style={{ marginBottom: 14 }}>
        <div className="field">
          <label>የግምገማ አቅጣጫ ክብደቶች</label>
          <div className="flex gap-8">
            {["self", "manager", "peer"].map((p) => (
              <label key={p} className="weight-chip">
                <span className="text-faint" style={{ fontSize: 11, textTransform: "capitalize" }}>{p}</span>
                <input
                  type="number" step="0.05" min="0" max="1" className="mono"
                  value={form[`weight_${p}`]}
                  onChange={(e) => setForm({ ...form, [`weight_${p}`]: Number(e.target.value) })}
                  onBlur={() => updateMeta({ [`weight_${p}`]: form[`weight_${p}`] })}
                />
              </label>
            ))}
          </div>
          <span className="hint">የተገምጋሚው የ360 ነጥብ የተሟሉትን የግምገማ አቅጣጫዎች በእነዚህ ክብደቶች በማጣመር ይሰላል።</span>
        </div>
      </div>

      {form.sections.map((s, si) => (
        <div key={s.id} className="builder-section">
          <div className="flex-between" style={{ gap: 12 }}>
            <input
              className="builder-title-input"
              value={s.title}
              onChange={(e) => {
                setForm({ ...form, sections: form.sections.map((x) => x.id === s.id ? { ...x, title: e.target.value } : x) });
              }}
              onBlur={() => api.put(`/evaluation-form-sections/${s.id}`, { title: s.title }).catch((e) => toast.push(e.message, "error"))}
            />
            <div className="flex gap-8">
              <select
                className="builder-select"
                value={s.perspective}
                onChange={(e) => api.put(`/evaluation-form-sections/${s.id}`, { perspective: e.target.value })
                  .then(() => { setForm({ ...form, sections: form.sections.map((x) => x.id === s.id ? { ...x, perspective: e.target.value } : x) }); })
                  .catch((e) => toast.push(e.message, "error"))}
              >
                {["self", "manager", "peer"].map((p) => <option key={p} value={p}>{PERSPECTIVE_LABEL[p]}</option>)}
              </select>
              <div className="builder-weight">
                <span className="text-faint" style={{ fontSize: 11 }}>ክብደት</span>
                <input
                  type="number" step="0.05" min="0" max="1" className="mono"
                  value={s.weight}
                  onChange={(e) => setForm({ ...form, sections: form.sections.map((x) => x.id === s.id ? { ...x, weight: Number(e.target.value) } : x) })}
                  onBlur={() => api.put(`/evaluation-form-sections/${s.id}`, { weight: s.weight }).catch((e) => toast.push(e.message, "error"))}
                />
              </div>
              <button className="btn-icon btn btn-ghost" title="ወደ ላይ አንቀሳቅስ" disabled={si === 0}
                onClick={() => api.post(`/evaluation-form-sections/${s.id}/move`, { direction: "up" }).then(refresh).catch((e) => toast.push(e.message, "error"))}>
                <Icons.chevronUp size={15} />
              </button>
              <button className="btn-icon btn btn-ghost" title="ወደ ታች አንቀሳቅስ" disabled={si === form.sections.length - 1}
                onClick={() => api.post(`/evaluation-form-sections/${s.id}/move`, { direction: "down" }).then(refresh).catch((e) => toast.push(e.message, "error"))}>
                <Icons.chevronDown size={15} />
              </button>
              <button className="btn-icon btn btn-ghost" title="ክፍል ድገም"
                onClick={() => api.post(`/evaluation-form-sections/${s.id}/duplicate`).then(() => { refresh(); onChanged(); }).catch((e) => toast.push(e.message, "error"))}>
                <Icons.copy size={15} />
              </button>
              <button className="btn-icon btn btn-ghost" title="ክፍል ሰርዝ"
                onClick={async () => { if (confirm(`የ"${s.title}" ክፍል ይሰረዝ?`)) { await api.delete(`/evaluation-form-sections/${s.id}`); await refresh(); onChanged(); } }}>
                <Icons.trash size={15} />
              </button>
            </div>
          </div>
          <input
            className="builder-desc-input"
            placeholder="የክፍሉ መግለጫ (አማራጭ)"
            value={s.description || ""}
            onChange={(e) => setForm({ ...form, sections: form.sections.map((x) => x.id === s.id ? { ...x, description: e.target.value } : x) })}
            onBlur={() => api.put(`/evaluation-form-sections/${s.id}`, { description: s.description }).catch((e) => toast.push(e.message, "error"))}
          />
          <div className="builder-questions">
            {s.questions.map((q, qi) => (
              <BuilderQuestion key={q.id} q={q} qi={qi} count={s.questions.length} sectionId={s.id} formId={formId} setForm={setForm} refresh={refresh} toast={toast} onChanged={onChanged} />
            ))}
            <div className="flex gap-8" style={{ marginTop: 6 }}>
              <button className="btn-ghost btn btn-sm" onClick={() => addQuestion(s.id, "rating")}><Icons.plus size={13} /> ደረጃ (1–5)</button>
              <button className="btn-ghost btn btn-sm" onClick={() => addQuestion(s.id, "scale")}><Icons.plus size={13} /> ሚዛን</button>
              <button className="btn-ghost btn btn-sm" onClick={() => addQuestion(s.id, "select")}><Icons.plus size={13} /> ምርጫ</button>
              <button className="btn-ghost btn btn-sm" onClick={() => addQuestion(s.id, "multi")}><Icons.plus size={13} /> ብዙ ምርጫ</button>
              <button className="btn-ghost btn btn-sm" onClick={() => addQuestion(s.id, "text")}><Icons.plus size={13} /> ጽሑፍ</button>
            </div>
          </div>
        </div>
      ))}

      <div className="flex gap-8" style={{ marginTop: 10 }}>
        <button className="btn btn-secondary" onClick={() => addSection("self")}><Icons.plus size={14} /> የራስ ክፍል ጨምር</button>
        <button className="btn btn-secondary" onClick={() => addSection("manager")}><Icons.plus size={14} /> የአስተዳዳሪ ክፍል ጨምር</button>
        <button className="btn btn-secondary" onClick={() => addSection("peer")}><Icons.plus size={14} /> የሥራ ባልደረባ ክፍል ጨምር</button>
      </div>

      <div className="text-faint" style={{ fontSize: 12, marginTop: 14, lineHeight: 1.6 }}>
        ክፍሎች በገምጋሚ አቅጣጫ ይመደባሉ፦ <b>የራስ</b>፣ <b>የአስተዳዳሪ</b> ወይም <b>የሥራ ባልደረባ</b>። እያንዳንዱ አቅጣጫ በተለየ ገምጋሚ ይሞላል።
      </div>
    </div>
  );
}

function BuilderQuestion({ q, qi, count, sectionId, formId, setForm, refresh, toast, onChanged }) {
  const [optionsText, setOptionsText] = useState((q.options || []).join(", "));

  useEffect(() => { setOptionsText((q.options || []).join(", ")); }, [q.options]);

  function setLocal(p) {
    setForm((f) => ({
      ...f,
      sections: f.sections.map((s) => s.id === sectionId ? { ...s, questions: s.questions.map((x) => x.id === q.id ? { ...x, ...p } : x) } : s),
    }));
  }

  async function patch(p, after) {
    setLocal(p);
    try {
      await api.put(`/evaluation-form-questions/${q.id}`, p);
      if (after) await refresh();
    } catch (e) { toast.push(e.message, "error"); }
  }

  async function changeKind(kind) {
    const p = { kind };
    if (kind === "rating") p.max_score = 5;
    if (kind === "scale") p.max_score = 100;
    if (kind === "select" || kind === "multi") p.options = (q.options || ["Option 1", "Option 2"]).slice(0, 4);
    await patch(p, true);
  }

  return (
    <div className="builder-question">
      <div className="builder-q-row">
        <input className="builder-question-text" value={q.text}
          onChange={(e) => setLocal({ text: e.target.value })}
          onBlur={() => patch({ text: q.text })} />
        <select className="builder-select" value={q.kind} onChange={(e) => changeKind(e.target.value)}>
          {["rating", "scale", "select", "multi", "text"].map((k) => <option key={k} value={k}>{{ rating: "ደረጃ", scale: "ሚዛን", select: "ምርጫ", multi: "ብዙ ምርጫ", text: "ጽሑፍ" }[k]}</option>)}
        </select>
        {(q.kind === "rating" || q.kind === "scale") && (
          <input
            className="builder-max mono"
            title="ከፍተኛ ነጥብ"
            type="number" min="1" max="1000"
            value={q.max_score || 5}
            onChange={(e) => setLocal({ max_score: Number(e.target.value) || 5 })}
            onBlur={() => patch({ max_score: Number(q.max_score) || 5 })}
          />
        )}
        <label className="required-toggle" title="አስፈላጊ ጥያቄ">
          <input type="checkbox" checked={!!q.required} onChange={(e) => patch({ required: e.target.checked ? 1 : 0 })} />
          <span>አስፈላጊ</span>
        </label>
        <button className="btn-icon btn btn-ghost" title="ወደ ላይ አንቀሳቅስ" disabled={qi === 0}
          onClick={() => api.post(`/evaluation-form-questions/${q.id}/move`, { direction: "up" }).then(refresh).catch((e) => toast.push(e.message, "error"))}>
          <Icons.chevronUp size={14} />
        </button>
        <button className="btn-icon btn btn-ghost" title="ወደ ታች አንቀሳቅስ" disabled={qi === count - 1}
          onClick={() => api.post(`/evaluation-form-questions/${q.id}/move`, { direction: "down" }).then(refresh).catch((e) => toast.push(e.message, "error"))}>
          <Icons.chevronDown size={14} />
        </button>
        <button className="btn-icon btn btn-ghost" title="ጥያቄ ድገም"
          onClick={() => api.post(`/evaluation-form-questions/${q.id}/duplicate`).then(() => { refresh(); onChanged(); }).catch((e) => toast.push(e.message, "error"))}>
          <Icons.copy size={14} />
        </button>
        <button className="btn-icon btn btn-ghost" title="ጥያቄ ሰርዝ"
          onClick={async () => {
            if (confirm("ይህ ጥያቄ ይሰረዝ?")) {
              await api.delete(`/evaluation-form-questions/${q.id}`);
              await refresh();
              onChanged();
            }
          }}>
          <Icons.trash size={14} />
        </button>
      </div>
      <input
        className="builder-desc-input"
        placeholder="የጥያቄው ፍንጭ / መግለጫ (አማራጭ)"
        value={q.description || ""}
        onChange={(e) => setLocal({ description: e.target.value })}
        onBlur={() => patch({ description: q.description })}
      />
      {(q.kind === "select" || q.kind === "multi") && (
        <input
          className="builder-desc-input"
          placeholder="ምርጫዎችን በኮማ ይለያዩ (ለምሳሌ፦ በቅርቡ ያሳድጉ፣ ሚና ያስፋፉ፣ በመንገድ ላይ)"
          value={optionsText}
          onChange={(e) => setOptionsText(e.target.value)}
          onBlur={() => {
            const opts = optionsText.split(",").map((s) => s.trim()).filter(Boolean);
            if (opts.length) api.put(`/evaluation-form-questions/${q.id}`, { options: opts }).catch((e) => toast.push(e.message, "error"));
          }}
        />
      )}
    </div>
  );
}

function AssignmentsTable({ toast }) {
  const { user } = useAuth();
  const isAdmin = user.role === "admin";
  const [status, setStatus] = useState("all");
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    setRows(null);
    api.get(`/evaluation-assignments?status=${status}`).then(setRows).catch((e) => toast.push(e.message, "error"));
  }, [status, toast]);

  async function reload() {
    try { setRows(await api.get(`/evaluation-assignments?status=${status}`)); } catch (e) { toast.push(e.message, "error"); }
  }

  async function remove(a) {
    if (!confirm(`የ${a.subject_name} "${a.form_name}" የ${PERSPECTIVE_LABEL[a.evaluator_type] || a.evaluator_type} ምደባ ይሰረዝ? መልሶቹና የማጽደቅ መዝገቦቹም ይወገዳሉ።`)) return;
    try {
      await api.delete(`/evaluation-assignments/${a.id}`);
      toast.push("ምደባው ተሰርዟል", "success");
      reload();
    } catch (e) { toast.push(e.message, "error"); }
  }

  return (
    <div className="card">
      <div className="card-title">ሁሉም ምደባዎች</div>
      <div className="chip-row" style={{ marginBottom: 12 }}>
        {["all", "draft", "submitted", "in_review", "rejected", "scored"].map((s) => (
          <button key={s} className={`chip chip-btn ${status === s ? "active" : ""}`} onClick={() => setStatus(s)}>
            {s === "all" ? "ሁሉም" : statusLabel(s)}
          </button>
        ))}
      </div>
      {rows === null ? (
        <Skeleton lines={4} height={20} />
      ) : rows.length === 0 ? (
        <div className="empty-state">ከዚህ ማጣሪያ ጋር የሚዛመድ ምደባ የለም።</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>ተገምጋሚ</th><th>ገምጋሚ</th><th>ቅጽ</th><th>ዑደት</th><th className="num">የመጨረሻ ቀን</th><th>ሁኔታ</th><th className="num">ነጥብ</th>{isAdmin && <th className="num" />}</tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>
                    <div className="cell-strong">{a.subject_name}</div>
                    <div className="cell-sub">{a.subject_position}</div>
                  </td>
                  <td>
                    <div className="cell-sub">
                      <span className={`chip perspective-chip chip-${a.evaluator_type}`}>{PERSPECTIVE_LABEL[a.evaluator_type]}</span>{" "}
                      {a.evaluator_name || "—"}
                    </div>
                  </td>
                  <td>{a.form_name}</td>
                  <td>{a.cycle_name}</td>
                  <td className="num">
                    {a.due_date ? <span className={`mono ${isOverdue(a) ? "overdue" : ""}`}>{a.due_date}</span> : "—"}
                  </td>
                  <td><span className={`chip ${STATUS_CHIP[a.status]}`}>{statusLabel(a.status)}</span></td>
                  <td className="num cell-strong">
                    {a.overall_score != null ? <span className="mono">{a.overall_score.toFixed(1)}</span>
                      : a.score != null ? <span className="mono">{a.score.toFixed(1)}</span> : "—"}
                  </td>
                  {isAdmin && (
                    <td className="num">
                      <div className="flex gap-8" style={{ justifyContent: "flex-end" }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => setEditing(a)}><Icons.edit size={13} /> አርትዕ</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => remove(a)}><Icons.trash size={13} /> ሰርዝ</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EditAssignmentModal
          assignment={editing}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); reload(); }}
          toast={toast}
        />
      )}
    </div>
  );
}

function EditAssignmentModal({ assignment, onClose, onDone, toast }) {
  const [cycles, setCycles] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [due, setDue] = useState(assignment.due_date || "");
  const [cycle, setCycle] = useState(assignment.cycle_id);
  const [evaluatorType, setEvaluatorType] = useState(assignment.evaluator_type);
  const [evaluator, setEvaluator] = useState(assignment.evaluator_id);
  const [saving, setSaving] = useState(false);
  const [reopening, setReopening] = useState(false);

  useEffect(() => {
    Promise.all([api.get("/cycles"), api.get("/employees")])
      .then(([c, e]) => {
        setCycles(c);
        setEmployees(e.filter((x) => x.employment_status === "active"));
      })
      .catch((err) => toast.push(err.message, "error"));
  }, [toast]);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { due_date: due || null, cycle_id: cycle, evaluator_type: evaluatorType };
      if (evaluatorType !== "self") payload.evaluator_id = evaluator;
      const res = await api.put(`/evaluation-assignments/${assignment.id}`, payload);
      toast.push(res.status === "draft" && assignment.status !== "draft"
        ? "ተቀምጧል — ገምጋሚው/ዑደቱ ስለተቀየረ የሥራ ሂደቱ ወደ ረቂቅ ተመልሷል"
        : "ምደባው ተሻሽሏል", "success");
      onDone();
    } catch (err) {
      toast.push(err.message, "error");
      setSaving(false);
    }
  }

  async function reopen() {
    setReopening(true);
    try {
      await api.put(`/evaluation-assignments/${assignment.id}`, { action: "reopen" });
      toast.push("እንደገና ተከፍቷል — ምላሾቹ ተጠብቀው ወደ ረቂቅ ተመልሷል", "success");
      onDone();
    } catch (err) {
      toast.push(err.message, "error");
      setReopening(false);
    }
  }

  return (
    <Modal
      title={`ምደባ አርትዕ — ${assignment.subject_name}`}
      subtitle={`${assignment.form_name} · ${PERSPECTIVE_LABEL[assignment.evaluator_type] || assignment.evaluator_type} ግምገማ${assignment.evaluator_name ? ` · በ ${assignment.evaluator_name}` : ""}`}
      onClose={onClose}
      footer={
        <div className="flex gap-8" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-secondary" onClick={onClose}>ሰርዝ</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "በማስቀመጥ ላይ…" : "ለውጦችን አስቀምጥ"}</button>
        </div>
      }
    >
      <form onSubmit={save}>
        <div className="form-grid">
          <div className="field">
            <label>የመጨረሻ ቀን</label>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <div className="field">
            <label>ዑደት</label>
            <select value={cycle || ""} onChange={(e) => setCycle(Number(e.target.value))}>
              {cycles.map((c) => <option key={c.id} value={c.id}>{c.name} {c.status === "active" ? "• ንቁ" : ""}</option>)}
            </select>
          </div>
          <div className="field">
            <label>የግምገማ አቅጣጫ</label>
            <select value={evaluatorType} onChange={(e) => setEvaluatorType(e.target.value)}>
              {["self", "manager", "peer"].map((p) => <option key={p} value={p}>{PERSPECTIVE_LABEL[p]}</option>)}
            </select>
            <span className="hint">የግምገማ አቅጣጫውን ወይም ገምጋሚውን መቀየር የሥራ ሂደቱን ወደ ረቂቅ ይመልሰዋል።</span>
          </div>
          {evaluatorType !== "self" && (
            <div className="field">
              <label>ገምጋሚ</label>
              <select value={evaluator || ""} onChange={(e) => setEvaluator(Number(e.target.value))}>
                <option value="">ገምጋሚ ይምረጡ…</option>
                {employees.map((em) => <option key={em.id} value={em.id}>{em.full_name}{em.position ? ` · ${em.position}` : ""}</option>)}
              </select>
            </div>
          )}
        </div>

        {assignment.status !== "draft" && (
          <div className="field" style={{ marginTop: 4 }}>
            <button type="button" className="btn btn-secondary" onClick={reopen} disabled={reopening}>
              <Icons.swap size={14} /> {reopening ? "በመክፈት ላይ…" : "ወደ ረቂቅ እንደገና ክፈት (ምላሾችን ያስቀምጣል)"}
            </button>
            <span className="hint" style={{ marginLeft: 8 }}>ሰራተኛው እንደገና አርትዖ ማቅረብ እንዲችል ማጽደቆችንና ነጥቦችን ያጸዳል።</span>
          </div>
        )}
      </form>
    </Modal>
  );
}

function isOverdue(a) {
  if (!a.due_date || !["draft", "submitted", "in_review", "rejected"].includes(a.status)) return false;
  return new Date(a.due_date + "T23:59:59") < new Date();
}
