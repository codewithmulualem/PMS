import { useEffect, useState } from "react";
import { api } from "../api";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import Topbar from "../components/Topbar";
import Modal from "../components/Modal";
import Skeleton from "../components/Skeleton";
import EvaluationForm from "../components/EvaluationForm";
import ApprovalTrail from "../components/ApprovalTrail";
import { Icons } from "../components/icons";

function initials(name = "") {
  return name.split(" ").filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join("");
}

const AVATAR_COLORS = ["#4c5fd5", "#0e8f7e", "#b17a17", "#d64545", "#2f9e44", "#7c5cd5"];
const APPROVER_LABEL = { 1: "ቀጥተኛ አስተዳዳሪ", 2: "የአስተዳዳሪ አስተዳዳሪ", 3: "ሦስተኛ ደረጃ" };
const PERSPECTIVE_LABEL = { self: "የራስ ግምገማ", manager: "የአስተዳዳሪ ግምገማ", peer: "የባልደረባ ግምገማ" };

function levelText(a) {
  if (a.multi_approval) return "የከፍተኛ አስፈፃሚ ማጽደቅ";
  return APPROVER_LABEL[a.next_level] || `level ${a.next_level}`;
}

export default function EvaluationApprovals() {
  const { user } = useAuth();
  const toast = useToast();
  const isOversight = user.role === "admin" || user.role === "executive";
  const [pending, setPending] = useState(null);
  const [waiting, setWaiting] = useState([]);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);

  async function load() {
    try {
      const [p, w] = await Promise.all([
        api.get("/approvals/pending"),
        isOversight ? api.get("/approvals/waiting") : Promise.resolve([]),
      ]);
      setPending(p);
      setWaiting(w || []);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div>
      <Topbar subtitle="የማጽደቅ ደረጃ የድርጅት መዋቅሩን ይከተላል — የታችኛው ደረጃ ተጨማሪ ማጽደቅ ይፈልጋል" />

      {error && (
        <div className="error-banner">
          {error}
          <button className="link-btn" onClick={load}>እንደገና ሞክር</button>
        </div>
      )}

      {pending === null && !error ? (
        <Skeleton lines={4} height={26} />
      ) : (pending || []).length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-icon">✓</div>
            አሁን የእርስዎን ማጽደቅ የሚጠብቅ ነገር የለም።
            <div style={{ marginTop: 6, fontSize: 12 }}>የቀረቡ የሰራተኛ ቅጾች ደረጃ በደረጃ በራስ-ሰር ወደ እርስዎ ይመጣሉ።</div>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-title">
            የእርስዎን ግምገማ የሚጠብቁ
            <span className="chip chip-warn">{pending.length} በመጠባበቅ ላይ</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>ሰራተኛ</th><th>ቅጽ</th><th>ዑደት</th><th>ደረጃ</th><th className="num" /></tr>
              </thead>
              <tbody>
                {pending.map((a) => (
                  <tr key={a.id} className="clickable" onClick={() => setOpenId(a.id)}>
                    <td>
                      <div className="avatar-cell">
                        <div className="avatar avatar-sm" style={{ background: AVATAR_COLORS[a.employee_id % AVATAR_COLORS.length] }}>
                          {initials(a.subject_name)}
                        </div>
                        <div>
                          <div className="cell-strong">{a.subject_name}</div>
                          <div className="cell-sub">{a.subject_position}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="cell-strong">{a.form_name}</div>
                      <div className="cell-sub">
                        <span className={`chip perspective-chip chip-${a.evaluator_type}`}>{PERSPECTIVE_LABEL[a.evaluator_type] || a.evaluator_type}</span>
                        {a.evaluator_name && ` በ ${a.evaluator_name}`}
                      </div>
                    </td>
                    <td>{a.cycle_name}</td>
                    <td>
                      <span className="chip chip-indigo mono">L{a.next_level}/{a.effective_levels || a.approval_levels}</span>{" "}
                      <span className="text-faint" style={{ fontSize: 11 }}>{levelText(a)}</span>
                      {a.multi_approval && (
                        <div className="cell-sub" style={{ marginTop: 2 }}>
                          <span className="chip chip-gold">የከፍተኛ ደረጃ ማጽደቅ {(a.approved_approver_ids || []).length}/{(a.required_approvers || []).length}</span>
                        </div>
                      )}
                    </td>
                    <td className="num">
                      <button className="btn btn-secondary btn-sm"><Icons.shield size={13} /> ገምግም</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {openId && (
        <DecisionModal
          assignmentId={openId}
          onClose={() => setOpenId(null)}
          onDecided={() => load()}
          toast={toast}
        />
      )}

      {isOversight && waiting.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">
            የቀደሙ ደረጃዎችን በመጠባበቅ ላይ
            <span className="chip chip-warn">{waiting.length} በዝርዝር ውስጥ</span>
          </div>
          <div className="text-faint" style={{ fontSize: 12, marginBottom: 12 }}>
            የማጽደቅ ሰንሰለቱ ደረጃ በደረጃ ይሄዳል — የቀደመው ደረጃ እስኪያጸድቅ ድረስ እነዚህ ማስረከቢያዎች ለንባብ ብቻ ናቸው።
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>ሰራተኛ</th><th>ቅጽ</th><th>ዑደት</th><th>የሚጠብቀው</th></tr>
              </thead>
              <tbody>
                {waiting.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <div className="avatar-cell">
                        <div className="avatar avatar-sm" style={{ background: AVATAR_COLORS[a.employee_id % AVATAR_COLORS.length] }}>
                          {initials(a.subject_name)}
                        </div>
                        <div>
                          <div className="cell-strong">{a.subject_name}</div>
                          <div className="cell-sub">{a.subject_position}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="cell-strong">{a.form_name}</div>
                      <div className="cell-sub">
                        <span className={`chip perspective-chip chip-${a.evaluator_type}`}>{PERSPECTIVE_LABEL[a.evaluator_type] || a.evaluator_type}</span>
                      </div>
                    </td>
                    <td>{a.cycle_name}</td>
                    <td>
                      <div className="cell-strong">
                        {a.multi_approval
                          ? <>ከፍተኛ አስፈፃሚዎች <span className="text-dim">({(a.required_approver_names || []).join(", ")})</span></>
                          : (a.required_approver_names || [])[0] || "ቀጣዩ አስተዳዳሪ"}
                      </div>
                      <div className="cell-sub">
                        <span className="chip chip-indigo mono">L{a.next_level}/{a.effective_levels || a.approval_levels}</span>{" "}
                        <span className="text-faint" style={{ fontSize: 11 }}>{levelText(a)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function DecisionModal({ assignmentId, onClose, onDecided, toast }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [comments, setComments] = useState("");
  const [working, setWorking] = useState(false);
  const [mode, setMode] = useState(null); // approve | reject — confirm step

  useEffect(() => {
    api.get(`/evaluations/${assignmentId}`).then(setData).catch((e) => toast.push(e.message, "error"));
  }, [assignmentId, toast]);

  if (!data) return <Modal title="በመጫን ላይ…" onClose={onClose}><div className="empty-state">በመጫን ላይ…</div></Modal>;

  const levelLabel = data.next_level ? APPROVER_LABEL[data.next_level] || `level ${data.next_level}` : "";
  const canDecide = data.next_approver_id != null && data.next_approver_id === user.employee_id;
  const approvedCount = (data.approved_approver_ids || []).length;
  const requiredCount = (data.required_approvers || []).length;
  const isFinal = data.next_level >= (data.effective_levels || data.approval_levels || 0);

  async function decide() {
    if (!comments.trim()) { toast.push("ለእያንዳንዱ ውሳኔ አስተያየት ያስፈልጋል", "error"); return; }
    setWorking(true);
    try {
      const res = await api.post(`/evaluations/${assignmentId}/decision`, {
        decision: mode,
        comments: comments.trim(),
      });
      toast.push(
        mode === "approve"
          ? res.status === "scored"
            ? "ጸድቋል — የዚህ ግምገማ የመጨረሻ ነጥብ ተሰልቷል"
            : res.status === "in_review"
              ? (data.multi_approval && approvedCount + 1 < requiredCount
                ? "ጸድቋል — የቀሩትን ከፍተኛ አስፈፃሚዎች ማጽደቅ በመጠባበቅ ላይ ነው"
                : "ጸድቋል — ወደ ቀጣዩ የሰንሰለቱ ደረጃ ተልኳል")
              : "ጸድቋል"
          : "ለሰራተኛው ማሻሻያ ተመልሷል",
        "success",
      );
      onDecided();
      onClose();
    } catch (err) {
      toast.push(err.message, "error");
      setWorking(false);
    }
  }

  const footer = canDecide ? (
    !mode ? (
      <div className="flex gap-8" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-secondary" onClick={onClose}>ዝጋ</button>
        <button className="btn btn-danger" onClick={() => setMode("reject")} disabled={working}>
          <Icons.close size={14} /> ለማሻሻያ መልስ
        </button>
        <button className="btn btn-primary" onClick={() => setMode("approve")} disabled={working}>
          <Icons.check size={15} /> አጽድቅ
        </button>
      </div>
    ) : (
      <div className="flex gap-8" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-secondary" onClick={() => setMode(null)}>ተመለስ</button>
        <button
          className={mode === "approve" ? "btn btn-primary" : "btn btn-danger"}
          onClick={decide}
          disabled={working || !comments.trim()}
        >
          {working ? "በሂደት ላይ…" : mode === "approve" ? "ማጽደቁን አረጋግጥ" : "መመለሱን አረጋግጥ"}
        </button>
      </div>
    )
  ) : (
    <div className="flex gap-8" style={{ justifyContent: "flex-end" }}>
      <button className="btn btn-secondary" onClick={onClose}>ዝጋ</button>
    </div>
  );

  return (
    <Modal
      title={data.form.name}
      subtitle={`${data.employee?.full_name} · ${data.employee?.position || ""} · ${data.cycle?.name || ""}`}
      onClose={onClose}
      wide
      footer={footer}
    >
      {canDecide ? (
        <div className="decision-banner" style={{ borderLeftColor: mode === "reject" ? "var(--crimson)" : "var(--indigo)" }}>
          {mode === "approve"
            ? <><Icons.check size={15} /> በ <b>ደረጃ {data.next_level}</b> እያጸደቁ ነው ({levelLabel})
                {data.multi_approval
                  ? ` — የመጨረሻ ማጽደቅ፤ ሁሉም ከፍተኛ አስፈፃሚዎች ማጽደቅ አለባቸው (${approvedCount}/${requiredCount} እስካሁን)።`
                  : isFinal ? " — ይህ የመጨረሻ ደረጃ ነው፤ ነጥብ ይሰላል።" : " — ቅጹ ወደ ቀጣዩ ደረጃ ይላካል።"}</>
            : <><Icons.close size={15} /> ይህን ቅጽ ለማሻሻያ ወደ {data.employee?.full_name} እየመለሱ ነው።</>}
        </div>
      ) : (
        <div className="decision-banner banner-muted" style={{ marginBottom: 10, borderLeftColor: "var(--indigo)" }}>
          <Icons.clock size={15} />
          {data.multi_approval
            ? <>የመጨረሻ ማጽደቅ — ከፍተኛ አስፈፃሚዎችን በመጠባበቅ ላይ፦ <b>{(data.pending_approver_names || []).join(", ")}</b> (ያጸደቁ፦ {(data.approved_approver_names || []).join(", ") || "የለም"})። ይህ ቅጽ ለእርስዎ ለንባብ ብቻ ነው።</>
            : <><b>{(data.pending_approver_names || [])[0] || data.next_approver_name || "ቀጣዩ አጽዳቂ"}</b>ን በደረጃ {data.next_level} ({levelLabel}) በመጠባበቅ ላይ — ይህ ቅጽ ለእርስዎ ለንባብ ብቻ ነው።</>}
        </div>
      )}

      {data.multi_approval && (
        <div className="decision-banner banner-muted" style={{ marginTop: 10, borderLeftColor: "var(--gold)" }}>
          <Icons.shield size={15} />
          <b>የከፍተኛ አስፈፃሚ ማጽደቅ</b> — ደረጃ {data.next_level} እያንዳንዱ ከፍተኛ አስፈፃሚ እንዲያጸድቅ ይፈልጋል።
          {" "}ያጸደቁ፦ <b>{(data.approved_approver_names || []).join(", ") || "የለም"}</b>። አሁንም የሚጠብቁ፦ <b>{(data.pending_approver_names || []).join(", ")}</b>።
        </div>
      )}

      <div className={`decision-banner banner-muted`} style={{ marginTop: 10, borderLeftColor: "var(--indigo)" }}>
        <Icons.user size={15} /> <b>{data.evaluator_type === "self" ? "የራስ ግምገማ" : PERSPECTIVE_LABEL[data.evaluator_type] || data.evaluator_type}</b>
        {data.evaluator_type !== "self" && data.evaluator?.full_name ? ` በ ${data.evaluator.full_name}` : ""} ለ <b>{data.employee?.full_name}</b>
      </div>

      <EvaluationForm form={data.form} values={Object.fromEntries(
        data.form.sections.flatMap((s) => s.questions.map((q) => [q.id, q.answer ? { rating_value: q.answer.rating_value, text_value: q.answer.text_value } : {}]))
      )} readOnly />

      {canDecide && (
        <div className="field" style={{ marginTop: 16 }}>
          <label>የውሳኔ አስተያየት (አስፈላጊ — በኦዲት መዝገብ ይመዘገባል)</label>
          <textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder={mode === "reject" ? "ምን መሻሻል አለበት?" : "ለማጽደቅዎ ማስረጃ እና ምክንያት…"}
            rows={3}
          />
        </div>
      )}

      <ApprovalTrail assignments={[data]} />
    </Modal>
  );
}
