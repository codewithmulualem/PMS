import { useEffect, useState } from "react";
import { api } from "../api";
import Skeleton from "../components/Skeleton";
import { STATUS_LABELS } from "../i18n";

const INTENT = {
  todo: "chip chip-neutral",
  in_progress: "chip chip-indigo",
  done: "chip chip-success",
};

function TaskList({ tasks }) {
  if (!tasks || tasks.length === 0) return null;
  return (
    <div style={{ marginTop: 8, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
      {tasks.map((t) => (
        <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13 }}>
          <span style={{ flex: 1, color: t.status === "done" ? "var(--text-dim)" : "var(--text)", textDecoration: t.status === "done" ? "line-through" : "none" }}>
            {t.title}
          </span>
          {t.strategic_goal_title && (
            <span className="chip chip-indigo" style={{ fontSize: 10 }}>{t.strategic_goal_title}</span>
          )}
          <span className={INTENT[t.status] || "chip chip-neutral"} style={{ fontSize: 10 }}>
            {STATUS_LABELS[t.status] || t.status}
          </span>
        </div>
      ))}
    </div>
  );
}

function MemberRow({ member, showTasks }) {
  return (
    <div className="card" style={{ marginBottom: 10, padding: 12, marginLeft: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>{member.full_name}</div>
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
            {member.position || "የቡድን አባል"} · {member.done_tasks}/{member.total_tasks} ተግባራት ተጠናቀዋል
          </div>
        </div>
        {member.eval_score != null && (
          <span className="chip chip-indigo" style={{ fontSize: 11 }}>
            ግምገማ {Number(member.eval_score).toFixed(1)}
          </span>
        )}
        <div style={{ width: 140 }}>
          <div style={{ height: 8, background: "var(--neutral-bg)", borderRadius: 999, overflow: "hidden" }}>
            <div style={{ width: `${member.completion_pct}%`, height: "100%", background: "var(--green)", borderRadius: 999 }} />
          </div>
        </div>
        <span className="chip chip-success" style={{ fontSize: 12 }}>ተግባራት {member.completion_pct}%</span>
      </div>
      {showTasks && <TaskList tasks={member.tasks} />}
    </div>
  );
}

function UnitNode({ node, depth, trimDepth, showMembers, showTasks }) {
  const [open, setOpen] = useState(depth < 2 ? true : false);
  const indent = depth * 24;
  const canGoDeeper = trimDepth === null || depth < trimDepth;
  const hasUnitChildren = canGoDeeper && node.children.length > 0;

  return (
    <div className="card" style={{ marginBottom: 10, padding: 12, marginLeft: depth === 0 ? 0 : indent }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          onClick={() => setOpen(!open)}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "var(--text-dim)", width: 20, textAlign: "left" }}
          aria-label={open ? "ዝጋ" : "ክፈት"}
        >
          {open ? "▾" : "▸"}
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>{node.name}</div>
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
            {node.direct_member_count > 0 ? `${node.direct_member_count} ቀጥተኛ · ` : ""}{node.member_count} ሰዎች
            {node.total_tasks > 0 && ` · ${node.done_tasks}/${node.total_tasks} ተግባራት`}
          </div>
        </div>
        {node.avg_eval_score != null && (
          <span className="chip chip-indigo" style={{ fontSize: 11 }}>
            ግምገማ {Number(node.avg_eval_score).toFixed(1)}
          </span>
        )}
        <div style={{ width: 140 }}>
          <div style={{ height: 8, background: "var(--neutral-bg)", borderRadius: 999, overflow: "hidden" }}>
            <div style={{ width: `${node.completion_pct}%`, height: "100%", background: "var(--indigo)", borderRadius: 999 }} />
          </div>
        </div>
        <span className="chip chip-success" style={{ fontSize: 12 }}>ተግባራት {node.completion_pct}%</span>
      </div>

      {open && (
        <div style={{ marginTop: 10 }}>
          {hasUnitChildren &&
            node.children.map((child) => (
              <UnitNode key={child.unit_id} node={child} depth={depth + 1} trimDepth={trimDepth} showMembers={showMembers} showTasks={showTasks} />
            ))}
          {showMembers &&
            node.members.map((m) => (
              <MemberRow key={m.employee_id} member={m} showTasks={showTasks} />
            ))}
          {!hasUnitChildren && !showMembers && node.members.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--text-faint)", padding: "4px 0" }}>
              {trimDepth !== null && depth >= trimDepth
                ? "ከታች ያሉ ክፍሎች ድምር ነው፤ ዝርዝሩ ለሚቀጥለው ደረጃ ተይዟል።"
                : "እስካሁን ሰዎች ወይም ንዑስ ክፍሎች የሉም።"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TierOverview({ tierLabel }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .get("/tiers/overview")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (!data && !error) return <Skeleton lines={8} height={22} />;
  if (error) return <div className="error-banner">{error}</div>;

  const tree = data.tree;
  const showTasks = data.tier === "team_leader";
  // Compartmentation of the planning pages: executives/directors stop at the
  // department, dept heads at the team aggregate, team leads see members.
  const showMembers = data.tier === "team_leader";
  const trimDepth = { director: 1, dept_head: 1, team_leader: 0 }[data.tier] ?? null;

  return (
    <div className="page-enter">
      <div className="card">
        <div className="card-title">
          {tierLabel || data.tier} እይታ
          <span className="chip chip-neutral">
            ሳምንት፦ {data.week_start}
          </span>
        </div>
        <div className="card-sub">
          በእርስዎ የድርጅት ወሰን ውስጥ የተጠናቀቁ ተግባራት እና የአፈጻጸም ድምር።
        </div>
        <div style={{ marginTop: 16 }}>
          <UnitNode node={tree} depth={0} trimDepth={trimDepth} showMembers={showMembers} showTasks={showTasks} />
        </div>
      </div>
    </div>
  );
}

export default TierOverview;
