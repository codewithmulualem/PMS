import { useState } from "react";
import { Icons } from "../icons";

export default function OrgTree({ tree, unitTypes, selectedId, onSelect, onEdit, onAddChild, onMove, onDelete, canEdit, overrideEnabled }) {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [dragId, setDragId] = useState(null);

  const toggle = (id) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const typeName = (id) => {
    const ut = unitTypes.find((t) => t.id === id);
    return ut ? ut.name : null;
  };

  const renderNode = (node, depth) => {
    const isOpen = !collapsed.has(node.id);
    const hasChildren = node.children && node.children.length > 0;
    const head = node.head;

    return (
      <div key={node.id}>
        <div
          className={`tree-row ${node.id === selectedId ? "selected" : ""} ${dragId === node.id ? "dragging" : ""}`}
          draggable={!!canEdit}
          onDragStart={(e) => {
            setDragId(node.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={() => setDragId(null)}
          onDragOver={(e) => canEdit && e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (dragId && dragId !== node.id) onMove(dragId, node.id);
            setDragId(null);
          }}
          style={{ paddingLeft: depth * 22 + 8 }}
        >
          <button
            className="tree-toggle"
            onClick={() => toggle(node.id)}
            disabled={!hasChildren}
            aria-label={isOpen ? "Collapse" : "Expand"}
          >
            {hasChildren ? (
              isOpen ? <Icons.chevronDown size={14} /> : <Icons.chevronRight size={14} />
            ) : (
              <span className="tree-leaf" />
            )}
          </button>
          <div className="tree-main" onClick={() => onSelect(node)}>
            <span className="tree-name">{node.name}</span>
            {node.code && <span className="tree-code mono">{node.code}</span>}
            {typeName(node.unit_type_id) && (
              <span className="chip chip-neutral">{typeName(node.unit_type_id)}</span>
            )}
            {head && <span className="tree-head">{head.full_name}</span>}
            {!node.active && <span className="chip chip-neutral">inactive</span>}
            <span className="tree-count mono">
              {node.employee_count} emp · {node.children?.length || 0} sub
            </span>
          </div>
          {canEdit && (
            <div className="tree-actions">
              <button title="Add child unit" onClick={() => onAddChild(node)}>
                <Icons.plus size={14} />
              </button>
              <button title="Edit unit" onClick={() => onEdit(node)}>
                <Icons.edit size={14} />
              </button>
              <button title="Delete unit" onClick={() => onDelete(node)}>
                <Icons.trash size={14} />
              </button>
            </div>
          )}
        </div>
        {isOpen && hasChildren && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="tree">
      {canEdit && (
        <div
          className={`tree-row tree-drop-root ${dragId ? "drop-hint" : ""}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (dragId) onMove(dragId, null);
            setDragId(null);
          }}
        >
          <span className="tree-leaf" />
          <div className="tree-main">
            <span className="tree-name faint">Drop here to make it a top-level unit</span>
          </div>
        </div>
      )}
      {tree.map((n) => renderNode(n, 0))}
      {tree.length === 0 && <div className="empty-state">No org units yet — create the root.</div>}
    </div>
  );
}
