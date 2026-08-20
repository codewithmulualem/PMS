import { Icons } from "./icons";

export default function ApprovalTrail({ assignments = [] }) {
  const assignment = assignments[0];
  if (!assignment) return null;

  const approvals = assignment.approvals || [];
  const status = assignment.status;
  const effective = assignment.effective_levels || assignment.approval_levels || assignment.form?.approval_levels || 0;
  const nextLevel = assignment.next_level || (status === "submitted" || status === "in_review" ? (assignment.current_level || 0) + 1 : null);

  // One step per actual approver (a committee level renders every top executive).
  const trail = [];
  const requiredIds = assignment.required_approvers || [];
  const approvedIds = assignment.approved_approver_ids || [];
  const requiredNames = assignment.required_approver_names || [];
  const pendingNames = assignment.pending_approver_names || [];

  for (let level = 1; level <= Math.max(effective, 1); level++) {
    const rows = approvals.filter((a) => a.level === level);
    const isCurrent = nextLevel === level;
    const multi = assignment.multi_approval || requiredIds.length > 1;

    if (isCurrent && multi) {
      requiredIds.forEach((id, i) => {
        const approved = approvedIds.includes(id);
        const row = rows.find((r) => r.approver_id === id);
        trail.push({
          level,
          multi,
          approver_name: requiredNames[i] || row?.approver_name || "top executive",
          decision: approved ? "approved" : undefined,
          comments: row?.comments,
          state: approved ? "done" : "active",
        });
      });
    } else if (isCurrent) {
      trail.push({
        level,
        approver_name: pendingNames[0] || assignment.next_approver_name || requiredNames[0] || "awaiting approver",
        state: "active",
      });
    } else if (rows.length) {
      rows.forEach((r) => trail.push({
        level,
        approver_name: r.approver_name,
        decision: r.decision,
        comments: r.comments,
      }));
    } else {
      trail.push({ level, approver_name: "awaiting approver" });
    }
  }

  return (
    <div className="approval-trail">
      <div className="card-title" style={{ margin: 0, marginBottom: 10 }}>Approval Chain</div>
      <div className="trail-steps">
        <TrailStep
          icon={<Icons.user size={13} />}
          label="Employee submits"
          status={status === "draft" ? "pending" : "done"}
        />
        {trail.map((t, i) => (
          <TrailStep
            key={`${t.level}-${i}`}
            icon={<Icons.shield size={13} />}
            label={t.multi ? `Final sign-off — top executives` : `Level ${t.level} approval`}
            sub={t.approver_name || "awaiting approver"}
            state={t.state || (t.decision === "approved" ? "done" : t.decision === "rejected" ? "rejected" : nextLevel === t.level ? "active" : "waiting")}
            comments={t.comments}
          />
        ))}
        <TrailStep
          icon={<Icons.spark size={13} />}
          label="Score computed"
          state={status === "scored" ? "done" : "waiting"}
          sub={status === "scored" && assignment.score != null ? `score ${assignment.score.toFixed(1)}` : undefined}
        />
      </div>
    </div>
  );
}

function TrailStep({ icon, label, sub, state, comments }) {
  return (
    <div className={`trail-step ${state}`}>
      <div className="trail-icon">{icon}</div>
      <div className="trail-body">
        <div className="trail-label">
          {label}
          {state === "done" && <span className="chip chip-success">done</span>}
          {state === "active" && <span className="chip chip-warn">awaiting</span>}
          {state === "rejected" && <span className="chip chip-danger">rejected</span>}
          {state === "waiting" && <span className="chip chip-neutral">pending</span>}
        </div>
        {sub && <div className="trail-sub">{sub}</div>}
        {comments && <div className="trail-comment">“{comments}”</div>}
      </div>
    </div>
  );
}
