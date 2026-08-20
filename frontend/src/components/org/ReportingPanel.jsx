import { useEffect, useState } from "react";
import { Icons } from "../icons";
import { api } from "../../api";

const DEFAULT_TYPES = ["primary", "secondary", "functional", "administrative", "acting", "temporary"];
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
        toast.push("Relationship updated", "success");
      } else {
        await api.post("/org/reporting-relationships", form);
        toast.push("Reporting relationship added", "success");
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
      toast.push(r.is_active ? "Relationship retired" : "Relationship activated", "success");
      onChanged();
    } catch (err) {
      toast.push(err.message, "error");
    }
  }

  async function remove(r) {
    if (!window.confirm("Delete this reporting relationship?")) return;
    try {
      await api.delete(`/org/reporting-relationships/${r.id}`);
      toast.push("Relationship deleted", "success");
      onChanged();
    } catch (err) {
      toast.push(err.message, "error");
    }
  }

  return (
    <div>
      <div className="text-faint" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 14 }}>
        The <b>primary</b> relationship drives the chain of command and approvals. Secondary / functional /
        administrative / acting / temporary relationships support matrix and temp structures. Only one primary
        is active at a time; creating a new one retires the previous.
      </div>
      <div className="grid grid-2">
        <div className="card">
          <div className="card-title">{editingId ? "Edit relationship" : "Add reporting relationship"}</div>
          {canEdit ? (
            <form onSubmit={save}>
              <div className="form-grid">
                <div className="field">
                  <label>Employee</label>
                  <select required value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: Number(e.target.value) })}>
                    <option value="">— select —</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Supervisor</label>
                  <select required value={form.supervisor_id} onChange={(e) => setForm({ ...form, supervisor_id: Number(e.target.value) })}>
                    <option value="">— select —</option>
                    {employees.filter((emp) => emp.id !== form.employee_id).map((emp) => (
                      <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Type</label>
                <select value={form.relationship_type} onChange={(e) => setForm({ ...form, relationship_type: e.target.value })}>
                  {types.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="form-grid">
                <div className="field">
                  <label>Start date</label>
                  <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
                </div>
                <div className="field">
                  <label>End date (optional)</label>
                  <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label>Reason</label>
                <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Product alignment working group" />
              </div>
              <div className="flex gap-8">
                <button className="btn btn-primary btn-sm" type="submit"><Icons.plus size={13} /> {editingId ? "Save" : "Add"}</button>
                {editingId && <button type="button" className="btn btn-sm" onClick={() => { setEditingId(null); setForm(EMPTY); }}>Cancel</button>}
              </div>
            </form>
          ) : (
            <div className="empty-state">Only admins can edit reporting relationships.</div>
          )}
        </div>
        <div className="card">
          <div className="card-title">Relationships</div>
          {sorted.length === 0 && <div className="empty-state">No reporting relationships yet.</div>}
          {sorted.map((r) => (
            <div key={r.id} className="flex-between" style={{ padding: "10px 2px", borderBottom: "1px solid #f0f2f7" }}>
              <div style={{ minWidth: 0 }}>
                <div className="cell-strong" style={{ fontSize: 13 }}>
                  {r.employee_name} <span className="text-faint">→</span> {r.supervisor_name}
                </div>
                <div className="cell-sub">
                  <span className={`chip ${r.is_active ? "chip-success" : "chip-neutral"}`}>{r.relationship_type}</span>
                  {r.is_active ? <span className="text-faint" style={{ marginLeft: 8 }}>active</span> : <span className="text-faint" style={{ marginLeft: 8 }}>retired</span>}
                  {(r.start_date || r.end_date) && <span className="mono text-faint" style={{ marginLeft: 8, fontSize: 11.5 }}>{r.start_date || "…"} → {r.end_date || "…"}</span>}
                  {r.reason && <div className="text-faint" style={{ fontSize: 11.5, marginTop: 3 }}>{r.reason}</div>}
                </div>
              </div>
              {canEdit && (
                <div className="tree-actions">
                  <button title="Toggle active" onClick={() => toggleActive(r)}><Icons.check size={14} /></button>
                  <button title="Edit" onClick={() => startEdit(r)}><Icons.edit size={14} /></button>
                  <button title="Delete" onClick={() => remove(r)}><Icons.trash size={14} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
