import { Icons } from "./icons";

const ACTION_META = {
  create: { label: "created", color: "var(--green)", icon: Icons.plus },
  update: { label: "updated", color: "var(--indigo)", icon: Icons.edit },
  delete: { label: "deleted", color: "var(--crimson)", icon: Icons.close },
  recalculate: { label: "score recalculated", color: "var(--amber)", icon: Icons.spark },
  calculated: { label: "score calculated", color: "var(--amber)", icon: Icons.spark },
  login: { label: "signed in", color: "var(--indigo)", icon: Icons.user },
  logout: { label: "signed out", color: "var(--text-faint)", icon: Icons.user },
};

function fmtTime(ts) {
  if (!ts) return "";
  const date = new Date((ts || "").replace(" ", "T") + "Z");
  if (Number.isNaN(date.getTime())) return ts;
  const now = new Date();
  const diff = (now - date) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString();
}

function shortValue(v) {
  if (v == null) return "";
  let out = v;
  if (typeof out === "string") {
    try {
      const parsed = JSON.parse(out);
      if (parsed !== null && typeof parsed === "object") out = parsed;
    } catch { /* not JSON */ }
  }
  if (typeof out === "object") out = JSON.stringify(out);
  const s = String(out);
  return s.length > 220 ? s.slice(0, 217) + "…" : s;
}

export default function AuditEvent({ event }) {
  const meta = ACTION_META[event.action] || {
    label: event.action,
    color: "var(--text-faint)",
    icon: Icons.list,
  };
  const ActionIcon = meta.icon;

  return (
    <div className="audit-row">
      <div className="audit-marker" style={{ background: meta.color }}>
        <ActionIcon size={12} style={{ color: "#fff" }} />
      </div>
      <div className="audit-main">
        <div className="flex-between" style={{ alignItems: "baseline" }}>
          <div style={{ fontSize: 13.5 }}>
            <span className="cell-strong" style={{ textTransform: "capitalize" }}>{event.entity_type}</span>{" "}
            <span className="text-dim">#{event.entity_id ?? "—"}</span>{" "}
            <span style={{ color: meta.color }}>{meta.label}</span>
            {event.changed_by && (
              <span className="text-faint"> · by <b className="text-dim">{event.changed_by}</b></span>
            )}
          </div>
          <span className="mono text-faint" style={{ fontSize: 11, whiteSpace: "nowrap", marginLeft: 10 }}>
            {fmtTime(event.timestamp)}
          </span>
        </div>
        {(event.new_value != null || event.old_value != null) && (
          <div className="audit-diff mono">
            {event.old_value != null && (
              <span className="diff-old">− {shortValue(event.old_value)}</span>
            )}
            {event.new_value != null && (
              <span className="diff-new">+ {shortValue(event.new_value)}</span>
            )}
          </div>
        )}
        {event.reason && <div className="text-faint" style={{ fontSize: 12, marginTop: 2 }}>“{event.reason}”</div>}
      </div>
    </div>
  );
}
