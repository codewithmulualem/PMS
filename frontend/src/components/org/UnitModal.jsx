import { useState } from "react";
import Modal from "../Modal";
import { api } from "../../api";
import { useToast } from "../../context/ToastContext";

export default function UnitModal({ unit, unitTypes, units, defaultParent, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(unit && unit.id);
  const [form, setForm] = useState({
    name: unit?.name || "",
    code: unit?.code || "",
    unit_type_id: unit?.unit_type_id ?? "",
    parent_id: defaultParent ?? unit?.parent_id ?? "",
    override: false,
  });
  const [saving, setSaving] = useState(false);

  async function save(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/org/units/${unit.id}`, {
          name: form.name.trim(),
          code: form.code.trim() || null,
          unit_type_id: form.unit_type_id || null,
          active: 1,
        });
        toast.push("Org unit updated", "success");
      } else {
        await api.post("/org/units", {
          name: form.name.trim(),
          code: form.code.trim() || null,
          unit_type_id: form.unit_type_id || null,
          parent_id: form.parent_id || null,
          override: form.override,
        });
        toast.push("Org unit created", "success");
      }
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
      title={editing ? "Edit org unit" : "New org unit"}
      subtitle={editing ? unit.name : undefined}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      }
    >
      <form onSubmit={save}>
        <div className="field">
          <label>Name</label>
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Data Platform" />
        </div>
        <div className="form-grid">
          <div className="field">
            <label>Code</label>
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. ENG-BE" />
          </div>
          <div className="field">
            <label>Level type</label>
            <select value={form.unit_type_id} onChange={(e) => setForm({ ...form, unit_type_id: Number(e.target.value) || null })}>
              <option value="">— none —</option>
              {unitTypes.map((ut) => (
                <option key={ut.id} value={ut.id}>{ut.name}</option>
              ))}
            </select>
          </div>
        </div>
        {!editing && (
          <div className="field">
            <label>Parent unit</label>
            <select value={form.parent_id} onChange={(e) => setForm({ ...form, parent_id: Number(e.target.value) || null })}>
              <option value="">Root (top level)</option>
              {units
                .filter((u) => u.id !== unit?.id)
                .map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
            </select>
          </div>
        )}
        {!editing && (
          <label className="flex gap-8" style={{ alignItems: "center", marginTop: 6, fontSize: 13 }}>
            <input type="checkbox" checked={form.override} onChange={(e) => setForm({ ...form, override: e.target.checked })} />
            <span>Allow out-of-sequence level (matrix setup)</span>
          </label>
        )}
        {!editing && (
          <div className="text-faint" style={{ fontSize: 12, marginTop: 6 }}>
            Child units must use a deeper level than their parent unless override is enabled.
          </div>
        )}
      </form>
    </Modal>
  );
}
