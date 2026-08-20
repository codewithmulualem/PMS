import { useState } from "react";
import { Icons } from "../icons";

function findNode(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children || [], id);
    if (found) return found;
  }
  return null;
}

function initials(name = "") {
  return name.split(" ").filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join("");
}

function PersonCard({ node, onFocus, isRoot }) {
  const kids = node.children || [];
  const name = node.full_name || node.name;
  const role =
    node.position_title || node.position || node.unit_name ||
    (node.head ? node.head.full_name : "") ||
    (isRoot ? "Top of reporting hierarchy" : "—");
  const meta =
    node.unit_name && (node.position_title || node.position)
      ? node.unit_name
      : node.job_grade
        ? `Grade ${node.job_grade}`
        : "";
  const head = Boolean(node.is_head);

  return (
    <div className="chart-col">
      <button
        className={`chart-node ${head ? "chart-node-head" : ""} ${isRoot ? "chart-node-root" : ""}`}
        onClick={() => onFocus(node)}
        title={kids.length ? "Focus this reporting subtree" : "Individual"}
      >
        <span className={`chart-node-avatar ${head ? "chart-node-avatar-head" : ""}`}>{initials(name)}</span>
        <span className="chart-node-body">
          <span className="chart-node-name">{name}</span>
          <span className="chart-node-role">{role}</span>
          {meta && <span className="chart-node-meta">{meta}</span>}
        </span>
        {kids.length > 0 && <span className="chart-node-count">{kids.length}</span>}
      </button>
      {kids.length > 0 && (
        <div className="chart-row">
          {kids.map((c) => (
            <PersonCard key={c.id} node={c} onFocus={onFocus} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function OrgChart({ tree, people, onSelect }) {
  const [rootId, setRootId] = useState(null);
  const source = people && people.length > 0 ? people : tree;
  const root =
    rootId == null
      ? { id: "root", full_name: "Organization", children: source }
      : findNode(source, rootId);

  const focus = (node) => {
    if (node.id === "root") {
      setRootId(null);
      return;
    }
    setRootId(node.id);
    onSelect?.(node);
  };

  return (
    <div>
      <div className="chart-breadcrumb">
        <button className="chart-crumb" onClick={() => setRootId(null)}>Organization</button>
        {rootId != null && (
          <>
            <Icons.chevronRight size={12} />
            <span className="cell-strong">{root.full_name}</span>
          </>
        )}
        <span className="text-faint"> · click any card to focus its reporting subtree · {people.length > 0 ? people.length : "n"} people</span>
      </div>
      <div className="chart-root">
        <PersonCard node={root} onFocus={focus} isRoot />
      </div>
      {source.length === 0 && <div className="empty-state">No employees yet.</div>}
    </div>
  );
}
