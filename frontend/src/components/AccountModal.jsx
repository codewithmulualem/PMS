import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import Modal from "./Modal";
import { Icons } from "./icons";

export default function AccountModal({ onClose }) {
  const { user } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (next.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    if (next !== confirm) {
      setError("New passwords do not match");
      return;
    }
    setSaving(true);
    try {
      await api.post("/auth/change-password", { current_password: current, new_password: next });
      toast.push("Password updated", "success");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="My account" subtitle="Manage your sign-in credentials" onClose={onClose}>
      <div className="card" style={{ padding: 16 }}>
          <div className="flex gap-8" style={{ alignItems: "center", flexWrap: "wrap" }}>
          <div className="avatar avatar-sm" style={{ background: "var(--indigo)" }}>
            <Icons.user size={16} />
          </div>
          <div>
            <div className="cell-strong">{user.employee?.full_name || user.username}</div>
            <div className="cell-sub">Sign-in: <span className="mono">{user.username}</span></div>
          </div>
          <span className="role-pill" style={{ marginLeft: "auto" }}>{user.role}</span>
        </div>
      </div>

      <form onSubmit={submit} style={{ marginTop: 16 }}>
        <div className="field">
          <label>Current password</label>
          <input type="password" required value={current}
            onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </div>
        <div className="field">
          <label>New password</label>
          <input type="password" required value={next}
            onChange={(e) => setNext(e.target.value)} autoComplete="new-password"
            placeholder="At least 8 characters" />
        </div>
        <div className="field">
          <label>Confirm new password</label>
          <input type="password" required value={confirm}
            onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </div>
        {error && <div className="error-banner">{error}</div>}
        <div className="flex gap-8" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            <Icons.lock size={15} style={{ marginRight: 6 }} />
            {saving ? "Saving…" : "Change password"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
