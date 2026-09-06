import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import Modal from "./Modal";
import { Icons } from "./icons";
import { ROLE_LABELS } from "../i18n";

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
      setError("አዲሱ የይለፍ ቃል ቢያንስ 8 ቁምፊዎች ሊኖሩት ይገባል");
      return;
    }
    if (next !== confirm) {
      setError("አዲሶቹ የይለፍ ቃሎች አይመሳሰሉም");
      return;
    }
    setSaving(true);
    try {
      await api.post("/auth/change-password", { current_password: current, new_password: next });
      toast.push("የይለፍ ቃሉ ተሻሽሏል", "success");
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
    <Modal title="የእኔ መለያ" subtitle="የመግቢያ መረጃዎችዎን ያስተዳድሩ" onClose={onClose}>
      <div className="card" style={{ padding: 16 }}>
          <div className="flex gap-8" style={{ alignItems: "center", flexWrap: "wrap" }}>
          <div className="avatar avatar-sm" style={{ background: "var(--indigo)" }}>
            <Icons.user size={16} />
          </div>
          <div>
            <div className="cell-strong">{user.employee?.full_name || user.username}</div>
            <div className="cell-sub">መግቢያ፦ <span className="mono">{user.username}</span></div>
          </div>
          <span className="role-pill" style={{ marginLeft: "auto" }}>{ROLE_LABELS[user.role] || user.role}</span>
        </div>
      </div>

      <form onSubmit={submit} style={{ marginTop: 16 }}>
        <div className="field">
          <label>የአሁኑ የይለፍ ቃል</label>
          <input type="password" required value={current}
            onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </div>
        <div className="field">
          <label>አዲስ የይለፍ ቃል</label>
          <input type="password" required value={next}
            onChange={(e) => setNext(e.target.value)} autoComplete="new-password"
            placeholder="ቢያንስ 8 ቁምፊዎች" />
        </div>
        <div className="field">
          <label>አዲሱን የይለፍ ቃል ያረጋግጡ</label>
          <input type="password" required value={confirm}
            onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </div>
        {error && <div className="error-banner">{error}</div>}
        <div className="flex gap-8" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>ዝጋ</button>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            <Icons.lock size={15} style={{ marginRight: 6 }} />
            {saving ? "በማስቀመጥ ላይ…" : "የይለፍ ቃል ቀይር"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
