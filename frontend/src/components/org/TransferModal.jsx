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
        reason: form.reason || "ዝውውር",
      });
      toast.push(`${employee.full_name} ተዛውሯል`, "success");
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
      title={`${employee.full_name} አዛውር`}
      subtitle={`አሁን፦ ${employee.position || "የሥራ መደብ የለም"} · ${employee.department_name || ""}`}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? "በማስቀመጥ ላይ…" : "ዝውውሩን አረጋግጥ"}
        </button>
      }
    >
      <form onSubmit={save}>
        <div className="field">
          <label>መድረሻ ክፍል</label>
          <select required value={form.department_id} onChange={(e) => setForm({ ...form, department_id: Number(e.target.value) || null, position_id: "" })}>
            <option value="">— ይምረጡ —</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>የሥራ መደብ</label>
          <select value={form.position_id} onChange={(e) => setForm({ ...form, position_id: Number(e.target.value) || null })}>
            <option value="">— እንደነበር / ሳይመደብ —</option>
            {unitPositions.map((p) => (
              <option key={p.id} value={p.id}>{p.title}{p.is_head === 1 ? " (ኃላፊ)" : ""}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>አዲስ አስተዳዳሪ (ዋና የሪፖርት ግንኙነትን በራስ-ሰር ያስተካክላል)</label>
          <select value={form.manager_id} onChange={(e) => setForm({ ...form, manager_id: Number(e.target.value) || null })}>
            <option value="">— የሪፖርት ሁኔታውን እንደነበር ተው —</option>
            {employees.filter((emp) => emp.id !== employee.id).map((emp) => (
              <option key={emp.id} value={emp.id}>{emp.full_name}</option>
            ))}
          </select>
        </div>
        <div className="form-grid">
          <div className="field">
            <label>የሚጀምርበት ቀን</label>
            <input type="date" value={form.effective_date} onChange={(e) => setForm({ ...form, effective_date: e.target.value })} />
          </div>
          <div className="field">
            <label>ምክንያት</label>
            <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="ለምሳሌ፦ መዋቅራዊ ለውጥ / ዕድገት" />
          </div>
        </div>
        <div className="text-faint" style={{ fontSize: 12, lineHeight: 1.6 }}>
          ዝውውሩ በሰራተኛው የድርጅት ታሪክ (የሚጀምርበት ቀን + ምክንያት) እና በኦዲት መዝገብ ይመዘገባል። አዲስ አስተዳዳሪ መምረጥ የቀድሞውን ዋና የሪፖርት ግንኙነት ይዘጋዋል።
        </div>
      </form>
    </Modal>
  );
}
