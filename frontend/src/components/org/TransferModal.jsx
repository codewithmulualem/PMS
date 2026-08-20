import { useMemo, useState } from "react";
import Modal from "../Modal";
import { api } from "../../api";

export default function TransferModal({ employee, units, positions, employees, onClose, onSaved, toast }) {
  const [form, setForm] = useState({
    department_id: employee.department_id ?? "",
    position_id: employee.position_id ?? "",
    manager_id: "",
    effective_date: "",
    reason: "",
  });
  const [saving, setSaving] = useState(false);

  const unitPositions = useMemo(
    () => positions.filter((p) => p.org_unit_id === form.department_id),
    [positions, form.department_id]
  );

  async function save(e) {
    e.preventDefault();
    if (!form.department_id) return;
    setSaving(true);
    try {
      await api.post(`/employees/${employee.id}/transfer`, {
        department_id: form.department_id || null,
        position_id: form.position_id || null,
        manager_id: form.manager_id || null,
        effective_date: form.effective_date || null,
        reason: form.reason || "Transfer",
      });
      toast.push(`${employee.full_name} transferred`, "success");
      onSaved();
      onClose();
    } catch (err) {
      toast.push(err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Transfer ${employee.full_name}`}
      subtitle={`Currently: ${employee.position || "no role"} · ${employee.department_name || ""}`}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Confirm transfer"}
        </button>
      }
    >
      <form onSubmit={save}>
        <div className="field">
          <label>Destination unit</label>
          <select required value={form.department_id} onChange={(e) => setForm({ ...form, department_id: Number(e.target.value) || null, position_id: "" })}>
            <option value="">— select —</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Position</label>
          <select value={form.position_id} onChange={(e) => setForm({ ...form, position_id: Number(e.target.value) || null })}>
            <option value="">— keep / unassigned —</option>
            {unitPositions.map((p) => (
              <option key={p.id} value={p.id}>{p.title}{p.is_head === 1 ? " (head)" : ""}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>New manager (auto-repoints primary reporting)</label>
          <select value={form.manager_id} onChange={(e) => setForm({ ...form, manager_id: Number(e.target.value) || null })}>
            <option value="">— leave reporting unchanged —</option>
            {employees.filter((emp) => emp.id !== employee.id).map((emp) => (
              <option key={emp.id} value={emp.id}>{emp.full_name}</option>
            ))}
          </select>
        </div>
        <div className="form-grid">
          <div className="field">
            <label>Effective date</label>
            <input type="date" value={form.effective_date} onChange={(e) => setForm({ ...form, effective_date: e.target.value })} />
          </div>
          <div className="field">
            <label>Reason</label>
            <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Reorg / promotion" />
          </div>
        </div>
        <div className="text-faint" style={{ fontSize: 12, lineHeight: 1.6 }}>
          The transfer is recorded in the employee's org history (effective date + reason) and the audit log.
          Choosing a new manager closes the previous primary reporting relationship.
        </div>
      </form>
    </Modal>
  );
}
