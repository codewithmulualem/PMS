import { useEffect, useState } from "react";
import { Icons } from "../icons";
import { api } from "../../api";

const DEFAULT_TYPES = ["primary", "secondary", "functional", "administrative", "acting", "temporary"];
const RELATIONSHIP_LABELS = { primary: "ዋና", secondary: "ሁለተኛ", functional: "ተግባራዊ", administrative: "አስተዳደራዊ", acting: "ተጠባባቂ", temporary: "ጊዜያዊ" };
const EMPTY = { employee_id: "", supervisor_id: "", relationship_type: "primary", start_date: "", end_date: "", reason: "" };

export default function ReportingPanel({ relationships, employees, onChanged, toast, canEdit }) {
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [types, setTypes] = useState(DEFAULT_TYPES);

  useEffect(() => {
    api.get("/reference/relationship-types").then((rows) => {
      if (Array.isArray(rows) && rows.length) setTypes(rows.map((r) => r.code));
    }).catch(() => {});
  }, []);

  const sorted = [...relationships].sort((a, b) => a.employee_name.localeCompare(b.employee_name));

  async function save(e) {
    e.preventDefault();
    if (!form.employee_id || !form.supervisor_id) return;
    try {
      if (editingId) {
        await api.put(`/org/reporting-relationships/${editingId}`, form);
        toast.push("ግንኙነቱ ተሻሽሏል", "success");
      } else {
        await api.post("/org/reporting-relationships", form);
        toast.push("የሪፖርት ግንኙነቱ ተጨምሯል", "success");
      }
      setForm(EMPTY);
      setEditingId(null);
      onChanged();
    } catch (err) {
      toast.push(err.message, "error");
    }
  }

  function startEdit(r) {
    setEditingId(r.id);
    setForm({
      employee_id: r.employee_id,
      supervisor_id: r.supervisor_id,
      relationship_type: r.relationship_type,
      start_date: r.start_date || "",
      end_date: r.end_date || "",
      reason: r.reason || "",
    });
  }

  async function toggleActive(r) {
    try {
      await api.put(`/org/reporting-relationships/${r.id}`, { is_active: r.is_active ? 0 : 1 });
      toast.push(r.is_active ? "ግንኙነቱ ጡረታ ወጥቷል" : "ግንኙነቱ ነቅቷል", "success");
      onChanged();
    } catch (err) {
      toast.push(err.message, "error");
    }
  }

  async function remove(r) {
    if (!window.confirm("ይህ የሪፖርት ግንኙነት ይሰረዝ?")) return;
    try {
      await api.delete(`/org/reporting-relationships/${r.id}`);
      toast.push("ግንኙነቱ ተሰርዟል", "success");
      onChanged();
    } catch (err) {
      toast.push(err.message, "error");
    }
  }

  return (
    <div>
      <div className="text-faint" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 14 }}>
        <b>ዋና</b> ግንኙነት የትዕዛዝ ሰንሰለቱንና ማጽደቆችን ይመራል። ሁለተኛ፣ ተግባራዊ፣ አስተዳደራዊ፣ ተጠባባቂ እና ጊዜያዊ ግንኙነቶች የማትሪክስ እና ጊዜያዊ መዋቅሮችን ይደግፋሉ። በአንድ ጊዜ አንድ ዋና ግንኙነት ብቻ ንቁ ይሆናል።
      </div>
      <div className="grid grid-2">
        <div className="card">
          <div className="card-title">{editingId ? "ግንኙነት አርትዕ" : "የሪፖርት ግንኙነት ጨምር"}</div>
          {canEdit ? (
            <form onSubmit={save}>
              <div className="form-grid">
                <div className="field">
                  <label>ሰራተኛ</label>
                  <select required value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: Number(e.target.value) })}>
                    <option value="">— ይምረጡ —</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>አስተዳዳሪ</label>
                  <select required value={form.supervisor_id} onChange={(e) => setForm({ ...form, supervisor_id: Number(e.target.value) })}>
                    <option value="">— ይምረጡ —</option>
                    {employees.filter((emp) => emp.id !== form.employee_id).map((emp) => (
                      <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="field">
                <label>ዓይነት</label>
                <select value={form.relationship_type} onChange={(e) => setForm({ ...form, relationship_type: e.target.value })}>
                  {types.map((t) => <option key={t} value={t}>{RELATIONSHIP_LABELS[t] || t}</option>)}
                </select>
              </div>
              <div className="form-grid">
                <div className="field">
                  <label>የመጀመሪያ ቀን</label>
                  <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
                </div>
                <div className="field">
                  <label>የመጨረሻ ቀን (አማራጭ)</label>
                  <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label>ምክንያት</label>
                <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="ለምሳሌ፦ የሥራ ተግባር ማስማማት ቡድን" />
              </div>
              <div className="flex gap-8">
                <button className="btn btn-primary btn-sm" type="submit"><Icons.plus size={13} /> {editingId ? "አስቀምጥ" : "ጨምር"}</button>
                {editingId && <button type="button" className="btn btn-sm" onClick={() => { setEditingId(null); setForm(EMPTY); }}>ሰርዝ</button>}
              </div>
            </form>
          ) : (
            <div className="empty-state">የሪፖርት ግንኙነቶችን ማርትዕ የሚችሉት አስተዳዳሪዎች ብቻ ናቸው።</div>
          )}
        </div>
        <div className="card">
          <div className="card-title">ግንኙነቶች</div>
          {sorted.length === 0 && <div className="empty-state">እስካሁን የሪፖርት ግንኙነት የለም።</div>}
          {sorted.map((r) => (
            <div key={r.id} className="flex-between" style={{ padding: "10px 2px", borderBottom: "1px solid #f0f2f7" }}>
              <div style={{ minWidth: 0 }}>
                <div className="cell-strong" style={{ fontSize: 13 }}>
                  {r.employee_name} <span className="text-faint">→</span> {r.supervisor_name}
                </div>
                <div className="cell-sub">
                  <span className={`chip ${r.is_active ? "chip-success" : "chip-neutral"}`}>{RELATIONSHIP_LABELS[r.relationship_type] || r.relationship_type}</span>
                  {r.is_active ? <span className="text-faint" style={{ marginLeft: 8 }}>ንቁ</span> : <span className="text-faint" style={{ marginLeft: 8 }}>ጡረታ ወጥቷል</span>}
                  {(r.start_date || r.end_date) && <span className="mono text-faint" style={{ marginLeft: 8, fontSize: 11.5 }}>{r.start_date || "…"} → {r.end_date || "…"}</span>}
                  {r.reason && <div className="text-faint" style={{ fontSize: 11.5, marginTop: 3 }}>{r.reason}</div>}
                </div>
              </div>
              {canEdit && (
                <div className="tree-actions">
                  <button title="ንቁ/ንቁ አይደለም ቀይር" onClick={() => toggleActive(r)}><Icons.check size={14} /></button>
                  <button title="አርትዕ" onClick={() => startEdit(r)}><Icons.edit size={14} /></button>
                  <button title="ሰርዝ" onClick={() => remove(r)}><Icons.trash size={14} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
