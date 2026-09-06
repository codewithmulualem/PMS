import { useState, useMemo, useEffect, useRef } from "react";
import { Icons } from "../icons";
import { statusLabel } from "../../i18n";

function initials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0].toUpperCase())
    .join("");
}

function findInTree(nodes, id) {
  for (const n of nodes) {
    if (String(n.id) === String(id)) return n;
    if (n.children?.length) {
      const found = findInTree(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

function getAllNodeIds(nodes) {
  const ids = new Set();
  function walk(list) {
    for (const n of list) {
      ids.add(String(n.id));
      if (n.children?.length) walk(n.children);
    }
  }
  walk(nodes);
  return ids;
}

function getAncestors(nodes, targetId) {
  const path = [];
  function walk(list, curPath) {
    for (const n of list) {
      if (String(n.id) === String(targetId)) {
        path.push(...curPath);
        return true;
      }
      if (n.children?.length) {
        if (walk(n.children, [...curPath, n])) return true;
      }
    }
    return false;
  }
  walk(nodes, []);
  return path;
}

export default function OrgChart({
  tree = [],
  people = [],
  units = [],
  employees = [],
  unitTypes = [],
  positions = [],
  relationships = [],
}) {
  const [viewMode, setViewMode] = useState("units"); // "units" | "people"
  const [layoutMode, setLayoutMode] = useState("tree"); // "tree" | "canvas"
  const [rootId, setRootId] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null); // { type: "unit"|"person", data }
  const [search, setSearch] = useState("");
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useState(new Set());
  const [density, setDensity] = useState("auto"); // "auto" | "compact" | "spacious"
  const canvasViewportRef = useRef(null);
  const canvasContentRef = useRef(null);

  const rawSource = viewMode === "units" ? tree : people;

  const handleAutoFit = () => {
    if (!canvasViewportRef.current || !canvasContentRef.current) return;
    const vpWidth = canvasViewportRef.current.clientWidth - 48;
    const vpHeight = canvasViewportRef.current.clientHeight - 48;
    const contentWidth = canvasContentRef.current.scrollWidth;
    const contentHeight = canvasContentRef.current.scrollHeight;
    if (contentWidth > 0 && vpWidth > 0) {
      const scaleX = vpWidth / contentWidth;
      const scaleY = contentHeight > 0 && vpHeight > 0 ? vpHeight / contentHeight : 1;
      const bestScale = Math.min(1, Math.max(0.3, Math.min(scaleX, scaleY)));
      setZoom(Number(bestScale.toFixed(2)));
    }
  };

  // Initialize expanded nodes (root + 1st level by default)
  useEffect(() => {
    const init = new Set(["root"]);
    for (const r of rawSource) {
      init.add(String(r.id));
      if (r.children) {
        for (const c of r.children) {
          init.add(String(c.id));
        }
      }
    }
    setExpanded(init);
    setRootId(null);
  }, [viewMode, rawSource]);

  // Auto-fit when in canvas mode or when density/root changes
  useEffect(() => {
    if (layoutMode === "canvas") {
      const timer = setTimeout(() => {
        handleAutoFit();
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [layoutMode, viewMode, rootId, density]);

  // Root node based on focus
  const activeRoot = useMemo(() => {
    if (!rawSource || rawSource.length === 0) return null;
    if (rootId == null) {
      return {
        id: "root",
        name: viewMode === "units" ? "የኢትዮጵያ አካባቢ ጥበቃ ባለሥልጣን" : "አመራር እና ሰራተኞች",
        full_name: viewMode === "units" ? "የኢትዮጵያ አካባቢ ጥበቃ ባለሥልጣን" : "አመራር እና ሰራተኞች",
        unit_type_name: "ዋና ባለሥልጣን",
        children: rawSource,
        isRoot: true,
      };
    }
    return findInTree(rawSource, rootId) || rawSource[0];
  }, [rawSource, rootId, viewMode]);

  // Quick lookup maps
  const unitMap = useMemo(() => {
    const map = new Map();
    for (const u of units) map.set(Number(u.id), u);
    return map;
  }, [units]);

  const employeeMap = useMemo(() => {
    const map = new Map();
    for (const e of employees) map.set(Number(e.id), e);
    return map;
  }, [employees]);

  // Search filter
  const matchesSearch = (node) => {
    if (!search.trim()) return false;
    const q = search.toLowerCase();
    const name = (node.full_name || node.name || "").toLowerCase();
    const role = (node.position_title || node.position || node.unit_name || "").toLowerCase();
    const code = (node.code || "").toLowerCase();
    const type = (node.unit_type_name || "").toLowerCase();
    return name.includes(q) || role.includes(q) || code.includes(q) || type.includes(q);
  };

  // Auto-expand paths when searching
  useEffect(() => {
    if (!search.trim()) return;
    const matchingAncestors = new Set();
    function scan(list, path) {
      for (const n of list) {
        if (matchesSearch(n)) {
          for (const a of path) matchingAncestors.add(String(a.id));
          matchingAncestors.add(String(n.id));
        }
        if (n.children?.length) {
          scan(n.children, [...path, n]);
        }
      }
    }
    scan(rawSource, []);
    setExpanded((prev) => new Set([...prev, ...matchingAncestors]));
  }, [search, rawSource]);

  const toggleExpand = (id, e) => {
    e?.stopPropagation();
    setExpanded((prev) => {
      const next = new Set(prev);
      const strId = String(id);
      if (next.has(strId)) next.delete(strId);
      else next.add(strId);
      return next;
    });
  };

  const expandAll = () => {
    setExpanded(getAllNodeIds(rawSource));
  };

  const collapseAll = () => {
    setExpanded(new Set(["root"]));
  };

  const handleSelectNode = (node, type = null) => {
    const inferredType = type || (viewMode === "units" ? "unit" : "person");
    if (node.id === "root") {
      setSelectedItem(null);
      return;
    }
    setSelectedItem({ type: inferredType, data: node });
  };

  const handleFocusSubtree = (node) => {
    if (node.id === "root") {
      setRootId(null);
    } else {
      setRootId(node.id);
      setExpanded((prev) => new Set([...prev, String(node.id)]));
    }
  };

  // Breadcrumbs for focused root
  const breadcrumbs = useMemo(() => {
    if (!rootId) return [];
    return getAncestors(rawSource, rootId);
  }, [rawSource, rootId]);

  return (
    <div className="org-chart-wrapper">
      {/* Top Toolbar */}
      <div className="org-chart-toolbar">
        <div className="toolbar-left">
          {/* Mode Switcher */}
          <div className="segmented">
            <button
              className={viewMode === "units" ? "active" : ""}
              onClick={() => {
                setViewMode("units");
                setSelectedItem(null);
              }}
            >
              <Icons.org size={14} style={{ marginRight: 6 }} />
              የክፍሎች ተዋረድ
            </button>
            <button
              className={viewMode === "people" ? "active" : ""}
              onClick={() => {
                setViewMode("people");
                setSelectedItem(null);
              }}
            >
              <Icons.users size={14} style={{ marginRight: 6 }} />
              የሪፖርት ሰንሰለት
            </button>
          </div>

          {/* Layout Switcher */}
          <div className="segmented">
            <button
              className={layoutMode === "tree" ? "active" : ""}
              onClick={() => setLayoutMode("tree")}
              title="የተደራጀ ቀጥ ያለ የተዋረድ ዛፍ"
            >
              <Icons.list size={14} style={{ marginRight: 6 }} />
              የዛፍ ቻርት
            </button>
            <button
              className={layoutMode === "canvas" ? "active" : ""}
              onClick={() => setLayoutMode("canvas")}
              title="ከላይ ወደ ታች የሚታይ ዲያግራም"
            >
              <Icons.chart size={14} style={{ marginRight: 6 }} />
              የዲያግራም ማሳያ
            </button>
          </div>
        </div>

        <div className="toolbar-right">
          {/* Search */}
          <div className="chart-search-box">
            <Icons.search size={14} className="search-icon" />
            <input
              type="text"
              placeholder={viewMode === "units" ? "ክፍል ወይም ኮድ ይፈልጉ…" : "ሰራተኛ ወይም የሥራ መደብ ይፈልጉ…"}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="search-clear-btn" onClick={() => setSearch("")} aria-label="ፍለጋን አጽዳ">
                <Icons.close size={12} />
              </button>
            )}
          </div>

          {/* Expand / Collapse */}
          <div className="btn-group">
            <button className="btn btn-sm" onClick={expandAll} title="ሁሉንም ቅርንጫፎች ዘርጋ">
              <Icons.chevronDown size={13} /> ሁሉንም ዘርጋ
            </button>
            <button className="btn btn-sm" onClick={collapseAll} title="ሁሉንም ቅርንጫፎች ዝጋ">
              <Icons.chevronRight size={13} /> ሁሉንም ዝጋ
            </button>
          </div>

          {/* Zoom & Density controls for canvas mode */}
          {layoutMode === "canvas" && (
            <div className="flex gap-8" style={{ alignItems: "center" }}>
              <div className="segmented" title="የዲያግራሙ ጥግግት፦ በተዋረዱ መጠን መሠረት ይስተካከላል">
                <button
                  className={density === "auto" ? "active" : ""}
                  onClick={() => setDensity("auto")}
                  title="ራስ-ሰር፦ ካርዶችና መስመሮች በራሳቸው ይስተካከላሉ"
                >
                  ራስ-ሰር
                </button>
                <button
                  className={density === "compact" ? "active" : ""}
                  onClick={() => setDensity("compact")}
                  title="ጥቅጥቅ፦ ትንንሽ ካርዶችና አጭር መስመሮች"
                >
                  ጥቅጥቅ
                </button>
                <button
                  className={density === "spacious" ? "active" : ""}
                  onClick={() => setDensity("spacious")}
                  title="ሰፊ፦ ሰፋፊ ካርዶችና በቂ ክፍተት"
                >
                  ሰፊ
                </button>
              </div>

              <div className="zoom-controls">
                <button
                  className="btn btn-sm btn-icon"
                  onClick={() => setZoom((z) => Math.max(0.25, Number((z - 0.15).toFixed(2))))}
                  title="አሳንስ"
                >
                  <Icons.zoomOut size={14} />
                </button>
                <span className="zoom-label mono">{Math.round(zoom * 100)}%</span>
                <button
                  className="btn btn-sm btn-icon"
                  onClick={() => setZoom((z) => Math.min(1.8, Number((z + 0.15).toFixed(2))))}
                  title="አስፋ"
                >
                  <Icons.zoomIn size={14} />
                </button>
                <button
                  className="btn btn-sm btn-icon"
                  onClick={handleAutoFit}
                  title="ሙሉውን ተዋረድ ከማያ ገጹ ስፋት ጋር አስማማ"
                >
                  <Icons.maximize size={13} />
                </button>
                <button
                  className="btn btn-sm btn-icon"
                  onClick={() => setZoom(1)}
                  title="ማጉላትን ወደ 100% መልስ"
                >
                  <Icons.refresh size={13} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Breadcrumb & Context Bar */}
      <div className="chart-breadcrumb-bar">
        <div className="breadcrumbs">
          <button
            className={`crumb-btn ${!rootId ? "crumb-active" : ""}`}
            onClick={() => setRootId(null)}
          >
            <Icons.org size={13} style={{ marginRight: 4 }} />
            {viewMode === "units" ? "ድርጅት" : "ሁሉም የሪፖርት መስመሮች"}
          </button>
          {breadcrumbs.map((b) => (
            <span key={b.id} className="crumb-segment">
              <Icons.chevronRight size={12} className="crumb-arrow" />
              <button className="crumb-btn" onClick={() => setRootId(b.id)}>
                {b.name || b.full_name}
              </button>
            </span>
          ))}
          {rootId != null && activeRoot && (
            <span className="crumb-segment">
              <Icons.chevronRight size={12} className="crumb-arrow" />
              <span className="crumb-current">{activeRoot.name || activeRoot.full_name}</span>
            </span>
          )}
        </div>

        <div className="chart-stats-summary text-dim">
          {viewMode === "units" ? (
            <span>
              <strong>{units.length}</strong> ክፍሎች · <strong>{employees.length}</strong> ሰዎች
            </span>
          ) : (
            <span>
              <strong>{employees.length}</strong> ሰዎች በሪፖርት መዋቅሩ ውስጥ
            </span>
          )}
          {rootId != null && (
            <button className="btn btn-xs btn-outline" style={{ marginLeft: 10 }} onClick={() => setRootId(null)}>
              ወደ ሙሉ ድርጅቱ መልስ
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area (Chart + Detail Drawer) */}
      <div className="chart-workspace">
        <div className="chart-viewport-card">
          {rawSource.length === 0 ? (
            <div className="empty-state" style={{ padding: "60px 20px" }}>
              <Icons.org size={32} style={{ opacity: 0.4, marginBottom: 12 }} />
              <div>እስካሁን የድርጅት መረጃ አልተገኘም።</div>
            </div>
          ) : layoutMode === "tree" ? (
            /* ================= TREE CHART VIEW ================= */
            <div className="tree-chart-container">
              <TreeChartBranch
                node={activeRoot}
                depth={0}
                viewMode={viewMode}
                expanded={expanded}
                onToggleExpand={toggleExpand}
                selectedItem={selectedItem}
                onSelect={handleSelectNode}
                onFocusSubtree={handleFocusSubtree}
                search={search}
                matchesSearch={matchesSearch}
                employees={employees}
              />
            </div>
          ) : (
            /* ================= CANVAS DIAGRAM VIEW ================= */
            <div className="canvas-viewport" ref={canvasViewportRef}>
              <div
                className="canvas-content"
                ref={canvasContentRef}
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: "top center",
                }}
              >
                <CanvasNode
                  node={activeRoot}
                  depth={0}
                  density={density}
                  viewMode={viewMode}
                  expanded={expanded}
                  onToggleExpand={toggleExpand}
                  selectedItem={selectedItem}
                  onSelect={handleSelectNode}
                  onFocusSubtree={handleFocusSubtree}
                  search={search}
                  matchesSearch={matchesSearch}
                  isRoot={true}
                  employees={employees}
                />
              </div>
            </div>
          )}
        </div>

        {/* ================= DETAIL INSPECTOR DRAWER ================= */}
        {selectedItem && (
          <DetailDrawer
            selectedItem={selectedItem}
            onClose={() => setSelectedItem(null)}
            onSelectNode={handleSelectNode}
            onFocusSubtree={handleFocusSubtree}
            unitMap={unitMap}
            employeeMap={employeeMap}
            employees={employees}
            positions={positions}
            relationships={relationships}
          />
        )}
      </div>
    </div>
  );
}

/* =========================================================================
   TREE CHART VIEW COMPONENTS (Structured, guaranteed no clipping)
   ========================================================================= */

function TreeChartBranch({
  node,
  depth,
  viewMode,
  expanded,
  onToggleExpand,
  selectedItem,
  onSelect,
  onFocusSubtree,
  search,
  matchesSearch,
  employees,
}) {
  if (!node) return null;
  const isExpanded = expanded.has(String(node.id));
  const hasKids = Boolean(node.children && node.children.length > 0);
  const isSelected =
    selectedItem &&
    String(selectedItem.data?.id) === String(node.id) &&
    ((viewMode === "units" && selectedItem.type === "unit") ||
      (viewMode === "people" && selectedItem.type === "person"));
  const isMatch = matchesSearch(node);

  return (
    <div className="tree-chart-branch">
      <div
        className={`tree-chart-row ${isSelected ? "selected" : ""} ${isMatch ? "matched" : ""} ${
          node.isRoot ? "is-root" : ""
        }`}
        style={{ paddingLeft: `${Math.max(8, depth * 20 + 8)}px` }}
        onClick={() => onSelect(node)}
      >
        {/* Toggle Expand / Collapse */}
        <button
          className={`tree-toggle-btn ${hasKids ? "has-children" : "leaf"} ${isExpanded ? "open" : ""}`}
          onClick={(e) => hasKids && onToggleExpand(node.id, e)}
          title={hasKids ? (isExpanded ? "ቅርንጫፉን ዝጋ" : "ቅርንጫፉን ዘርጋ") : "የመጨረሻ ክፍል"}
          disabled={!hasKids}
        >
          {hasKids ? (
            isExpanded ? (
              <Icons.chevronDown size={10} />
            ) : (
              <Icons.chevronRight size={10} />
            )
          ) : (
            <span className="leaf-bullet" />
          )}
        </button>

        {/* Node Avatar or Unit Icon */}
        <div className={`node-avatar-badge ${node.is_head || node.head ? "head-badge" : ""}`}>
          {viewMode === "units" ? (
            <Icons.org size={15} />
          ) : (
            <span>{initials(node.full_name || node.name)}</span>
          )}
        </div>

        {/* Node Content */}
        <div className="tree-node-content">
          <div className="tree-node-main-line">
            <span className="tree-node-title">{node.name || node.full_name}</span>
            {node.code && <span className="mono chip chip-code">{node.code}</span>}
            {node.unit_type_name && (
              <span className={`chip chip-level chip-level-${(node.unit_type_name || "").toLowerCase()}`}>
                {node.unit_type_name}
              </span>
            )}
          {node.job_grade && <span className="chip chip-neutral mono">ደረጃ {node.job_grade}</span>}
            {node.is_head && <span className="chip chip-accent">ኃላፊ</span>}
          </div>

          <div className="tree-node-sub-line">
            {viewMode === "units" ? (
              <>
                {node.head && (
                  <span className="node-head-info">
                    <Icons.user size={12} />
                    <strong>ኃላፊ፦</strong> {node.head.full_name}
                    {node.head.position ? ` (${node.head.position})` : ""}
                  </span>
                )}
                <span className="node-counts">
                  <span className="count-pill">
                    <Icons.users size={12} />
                    {node.employee_count ??
                      employees.filter((e) => e.department_id === node.id).length}{" "}
                    members
                  </span>
                  {node.position_count !== undefined && (
                    <span className="count-pill">
                      <Icons.briefcase size={12} />
                      {node.position_count} የሥራ መደቦች
                    </span>
                  )}
                  {hasKids && (
                    <span className="count-pill sub-unit-pill">
                      <Icons.org size={12} />
                      {node.children.length} ንዑስ ክፍሎች
                    </span>
                  )}
                </span>
              </>
            ) : (
              <>
                <span className="node-role-info">
                  {node.position_title || node.position || "ሰራተኛ"
                  }
                </span>
                {node.unit_name && (
                  <span className="node-unit-info">
                    <Icons.org size={12} /> {node.unit_name}
                  </span>
                )}
                {hasKids && (
                  <span className="count-pill">
                    <Icons.users size={12} />
                    {node.children.length} ቀጥተኛ ተጠሪዎች
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        {/* Node Actions */}
        <div className="tree-node-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="btn btn-xs btn-ghost"
            onClick={() => onSelect(node)}
            title="ዝርዝሩን ይመልከቱ"
          >
            <Icons.eye size={13} style={{ marginRight: 4 }} />
            ዝርዝር
          </button>
          {!node.isRoot && (
            <button
              className="btn btn-xs btn-ghost"
              onClick={() => onFocusSubtree(node)}
              title="ይህን ቅርንጫፍ እንደ መነሻ ያሳዩ"
            >
              <Icons.target size={13} style={{ marginRight: 4 }} />
              ትኩረት
            </button>
          )}
        </div>
      </div>

      {/* Children Branches */}
      {hasKids && isExpanded && (
        <div className="tree-chart-children">
          {node.children.map((child) => (
            <TreeChartBranch
              key={child.id}
              node={child}
              depth={depth + 1}
              viewMode={viewMode}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
              selectedItem={selectedItem}
              onSelect={onSelect}
              onFocusSubtree={onFocusSubtree}
              search={search}
              matchesSearch={matchesSearch}
              employees={employees}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   CANVAS DIAGRAM VIEW COMPONENTS (Top-Down Interactive Visual Chart)
   ========================================================================= */

/**
 * Returns the appropriate icon component and size for a canvas node.
 * Priority: people-mode → unit_type_name keyword → depth-based fallback.
 */
function getNodeIcon({ viewMode, node, isRoot, depth, nodeDiameter }) {
  const sz = nodeDiameter >= 90 ? 28 : nodeDiameter >= 70 ? 22 : nodeDiameter >= 50 ? 18 : 13;

  // People / reporting-chain mode
  if (viewMode === "people") {
    return <Icons.personCircle size={sz} />;
  }

  // Unit mode — pick by type name first
  const typeName = (node.unit_type_name || "").toLowerCase();

  if (isRoot || typeName.includes("authority") || typeName.includes("commission") || depth === 0) {
    return <Icons.crown size={sz} />;
  }
  if (typeName.includes("directorate") || typeName.includes("ministry") || typeName.includes("bureau")) {
    return <Icons.building size={sz} />;
  }
  if (typeName.includes("department") || typeName.includes("division") || typeName.includes("unit")) {
    return <Icons.layers size={sz} />;
  }
  if (typeName.includes("team") || typeName.includes("section") || typeName.includes("group") || !node.children?.length) {
    return <Icons.teamGroup size={sz} />;
  }

  // Depth-based fallback
  if (depth === 0) return <Icons.crown size={sz} />;
  if (depth === 1) return <Icons.building size={sz} />;
  if (depth === 2) return <Icons.layers size={sz} />;
  return <Icons.teamGroup size={sz} />;
}

function CanvasNode({
  node,
  depth = 0,
  density = "auto",
  viewMode,
  expanded,
  onToggleExpand,
  selectedItem,
  onSelect,
  onFocusSubtree,
  search,
  matchesSearch,
  isRoot,
  employees,
}) {
  if (!node) return null;
  const kids = node.children || [];
  const hasKids = kids.length > 0;
  const isExpanded = expanded.has(String(node.id));
  const isSelected =
    selectedItem &&
    String(selectedItem.data?.id) === String(node.id) &&
    ((viewMode === "units" && selectedItem.type === "unit") ||
      (viewMode === "people" && selectedItem.type === "person"));
  const isMatch = matchesSearch(node);

  const name = node.full_name || node.name;
  const role =
    node.position_title ||
    node.position ||
    (node.head ? `ኃላፊ፦ ${node.head.full_name}` : null) ||
    (node.unit_type_name ? `${node.unit_type_name}` : "") ||
    (isRoot ? "ዋና ባለሥልጣን" : "—");
  const head = Boolean(node.is_head || node.head);

  const tier = Math.min(depth, 3);
  const isCollapsed = hasKids && !isExpanded;

  // Progressive sizing: root is largest, leaves are smallest.
  // Collapsed nodes jump noticeably bigger so they stay visible & prominent.
  // expanded:  depth 0=100, 1=76, 2=56, 3+=40
  // collapsed: depth 0=116, 1=92, 2=70, 3+=54
  const nodeDiameter =
    depth === 0
      ? (isCollapsed ? 116 : 100)
      : depth === 1
      ? (isCollapsed ? 92 : 76)
      : depth === 2
      ? (isCollapsed ? 70 : 56)
      : (isCollapsed ? 54 : 40);

  // Self-managing connector stem height and column spacing
  // Stems must be tall enough to clear the bottom handler (10px below circle)
  const connectorHeight =
    density === "compact"
      ? 18
      : density === "spacious"
      ? 36
      : depth === 0
      ? 30
      : kids.length >= 4
      ? 20
      : 26;

  const colGap =
    density === "compact"
      ? 8
      : density === "spacious"
      ? 24
      : kids.length >= 5
      ? 8
      : kids.length >= 3
      ? 12
      : 20;

  return (
    <div
      className={`chart-col tier-${tier} ${isCollapsed ? "is-collapsed-branch" : ""}`}
      style={{ margin: `0 calc(${colGap}px / 2)` }}
    >
      <div
        className={`circle-node-wrapper ${isSelected ? "selected" : ""} ${isMatch ? "matched" : ""}`}
        onClick={() => onSelect(node)}
        title={`${name} — ለዝርዝር ይጫኑ`}
      >
        {/* The Circular Node */}
        <div
          className={`circle-node tier-${tier} ${head ? "circle-node-head" : ""} ${
            isRoot ? "circle-node-root" : ""
          } ${isCollapsed ? "circle-node-collapsed" : ""}`}
          style={{
            width: `${nodeDiameter}px`,
            height: `${nodeDiameter}px`,
            minWidth: `${nodeDiameter}px`,
            minHeight: `${nodeDiameter}px`,
          }}
        >
          {/* Tier-specific icon */}
          <div className="circle-node-icon">
            {getNodeIcon({ viewMode, node, isRoot, depth, nodeDiameter })}
          </div>

          {/* For unit mode: show short code below icon if space permits */}
          {viewMode === "units" && nodeDiameter >= 56 && (
            <div className="circle-node-code mono" style={{ fontSize: nodeDiameter >= 90 ? 10 : 8 }}>
              {node.code || initials(name)}
            </div>
          )}

          {/* Head/supervisor star accent (top-left of circle) */}
          {head && (
            <span className="circle-head-star" title="የክፍል ኃላፊ">
              <Icons.starFilled size={10} />
            </span>
          )}

          {/* Collapsed Count Badge */}
          {isCollapsed && (
                    <span className="circle-collapsed-badge" title={`${kids.length} ንዑስ ክፍሎች ተደብቀዋል`}>
              +{kids.length}
            </span>
          )}

          {/* Circular Expand/Collapse Handler */}
          {hasKids && (
            <button
              className={`circle-node-handler ${isExpanded ? "expanded" : "collapsed"}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(node.id, e);
              }}
              title={isExpanded ? `ዝጋ (${kids.length})` : `ዘርጋ (${kids.length})`}
              aria-label={isExpanded ? "ክፍሉን ዝጋ" : "ክፍሉን ዘርጋ"}
            >
              {isExpanded ? (
                <Icons.chevronDown size={8} />
              ) : (
                <Icons.chevronRight size={8} />
              )}
            </button>
          )}
        </div>

        {/* Label beneath the circle */}
        <div className={`circle-node-label tier-${tier}`}>
          <div className="circle-label-name" title={name}>
            {name}
          </div>
          {tier <= 2 && (
            <div className="circle-label-role" title={role}>
              {role}
            </div>
          )}
        </div>
      </div>

      {/* Children Row with self-managing connector heights & gaps */}
      {hasKids && isExpanded && (
        <div
          className="chart-row"
          style={{
            "--connector-h": `${connectorHeight}px`,
            "--col-gap": `${colGap}px`,
            paddingTop: `${connectorHeight}px`,
          }}
        >
          {kids.map((c) => (
            <CanvasNode
              key={c.id}
              node={c}
              depth={depth + 1}
              density={density}
              viewMode={viewMode}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
              selectedItem={selectedItem}
              onSelect={onSelect}
              onFocusSubtree={onFocusSubtree}
              search={search}
              matchesSearch={matchesSearch}
              isRoot={false}
              employees={employees}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   DETAIL INSPECTOR DRAWER (Comprehensive slide-over on node click)
   ========================================================================= */

function DetailDrawer({
  selectedItem,
  onClose,
  onSelectNode,
  onFocusSubtree,
  unitMap,
  employeeMap,
  employees,
  positions,
  relationships,
}) {
  const { type, data } = selectedItem;
  const isUnit = type === "unit";

  // If unit, find all employees belonging to it
  const unitEmployees = useMemo(() => {
    if (!isUnit || !data) return [];
    return employees.filter((e) => Number(e.department_id) === Number(data.id));
  }, [isUnit, data, employees]);

  // If person, find manager and direct reports
  const personManager = useMemo(() => {
    if (isUnit || !data) return null;
    const directRel = relationships.find(
      (r) => Number(r.employee_id) === Number(data.id) && r.is_active && r.relationship_type === "primary"
    );
    const supervisorId = directRel?.supervisor_id || data.manager_id;
    return supervisorId ? employeeMap.get(Number(supervisorId)) : null;
  }, [isUnit, data, relationships, employeeMap]);

  const directReports = useMemo(() => {
    if (isUnit || !data) return [];
    return employees.filter((e) => {
      if (Number(e.manager_id) === Number(data.id)) return true;
      const rel = relationships.find(
        (r) =>
          Number(r.employee_id) === Number(e.id) &&
          Number(r.supervisor_id) === Number(data.id) &&
          r.is_active
      );
      return Boolean(rel);
    });
  }, [isUnit, data, employees, relationships]);

  // Escape key closes drawer
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="chart-detail-drawer" role="dialog" aria-label="ዝርዝር ፓነል">
      <div className="drawer-header">
        <div className="drawer-header-left">
          <span className="drawer-kind-badge">
            {isUnit ? <Icons.org size={14} /> : <Icons.user size={14} />}
            {isUnit ? "የክፍል ዝርዝር" : "የሰራተኛ መገለጫ"}
          </span>
          <h3 className="drawer-title">{data.name || data.full_name}</h3>
        </div>
        <button className="drawer-close-btn" onClick={onClose} aria-label="መሳቢያውን ዝጋ">
          <Icons.close size={16} />
        </button>
      </div>

      <div className="drawer-body">
        {isUnit ? (
          /* ---------- UNIT DETAIL VIEW ---------- */
          <div className="drawer-section-group">
            {/* Meta tags */}
            <div className="flex gap-8" style={{ flexWrap: "wrap", marginBottom: 16 }}>
              {data.code && <span className="chip chip-code mono">ኮድ፦ {data.code}</span>}
              {data.unit_type_name && (
                <span className={`chip chip-level chip-level-${(data.unit_type_name || "").toLowerCase()}`}>
                  {data.unit_type_name}
                </span>
              )}
              <span className={`chip ${data.active !== 0 ? "chip-success" : "chip-neutral"}`}>
                {data.active !== 0 ? "ንቁ ክፍል" : "እንቅስቃሴ የሌለው"}
              </span>
            </div>

            {/* Metrics cards */}
            <div className="drawer-metrics-grid">
              <div className="drawer-metric-card">
                <span className="metric-label">የሰራተኞች ብዛት</span>
                <span className="metric-value">
                  {data.employee_count ?? unitEmployees.length}
                </span>
              </div>
              <div className="drawer-metric-card">
                <span className="metric-label">የሥራ መደቦች</span>
                <span className="metric-value">{data.position_count ?? "—"}</span>
              </div>
              <div className="drawer-metric-card">
                <span className="metric-label">ንዑስ ክፍሎች</span>
                <span className="metric-value">{data.children?.length ?? 0}</span>
              </div>
            </div>

            {/* Unit Head Card */}
            <div className="drawer-card">
              <div className="drawer-card-title">የክፍል አመራር</div>
              {data.head ? (
                <div
                  className="drawer-person-mini clickable"
                  onClick={() => {
                    const emp = employeeMap.get(Number(data.head.id));
                    if (emp) onSelectNode(emp, "person");
                  }}
                  title="መገለጫውን ለማየት ይጫኑ"
                >
                  <div className="person-avatar head-avatar">{initials(data.head.full_name)}</div>
                  <div className="person-info">
                    <div className="person-name">
                      {data.head.full_name} <span className="chip chip-accent chip-xs">ኃላፊ</span>
                    </div>
                    <div className="person-role">{data.head.position || "የክፍል ኃላፊ"}</div>
                    {data.head.job_grade && (
                      <div className="person-meta mono">ደረጃ {data.head.job_grade}</div>
                    )}
                  </div>
                  <Icons.chevronRight size={14} className="drawer-arrow-icon" />
                </div>
              ) : (
                <div className="empty-state-sm">እስካሁን ለዚህ ክፍል ኃላፊ አልተመደበም።</div>
              )}
            </div>

            {/* Sub-Units List */}
            {data.children?.length > 0 && (
              <div className="drawer-card">
                <div className="drawer-card-title">ንዑስ ክፍሎች ({data.children.length})</div>
                <div className="drawer-list">
                  {data.children.map((sub) => (
                    <div
                      key={sub.id}
                      className="drawer-list-row clickable"
                      onClick={() => onSelectNode(sub, "unit")}
                    >
                      <div className="drawer-list-main">
                        <span className="list-title">{sub.name}</span>
                        {sub.code && <span className="mono text-faint">({sub.code})</span>}
                        {sub.unit_type_name && (
                          <span className="chip chip-neutral chip-xs">{sub.unit_type_name}</span>
                        )}
                      </div>
                      <span className="text-dim text-xs">
                        {sub.employee_count ?? 0} ሰራተኞች · {sub.children?.length ?? 0} ንዑስ
                      </span>
                      <Icons.chevronRight size={14} className="drawer-arrow-icon" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* People Assigned to this Unit */}
            <div className="drawer-card">
              <div className="drawer-card-title">
                በዚህ ክፍል ያሉ ሰራተኞች ({unitEmployees.length})
              </div>
              {unitEmployees.length === 0 ? (
                <div className="empty-state-sm">በአሁኑ ጊዜ ሰራተኛ አልተመደበም።</div>
              ) : (
                <div className="drawer-list">
                  {unitEmployees.map((emp) => (
                    <div
                      key={emp.id}
                      className="drawer-list-row clickable"
                      onClick={() => onSelectNode(emp, "person")}
                      title="የሰራተኛውን መገለጫ ለማየት ይጫኑ"
                    >
                      <div className="person-avatar-xs">{initials(emp.full_name)}</div>
                      <div className="drawer-list-main">
                        <div className="list-title">
                          {emp.full_name}
                          {data.head && data.head.id === emp.id && (
                            <span className="chip chip-accent chip-xs" style={{ marginLeft: 6 }}>
                              ኃላፊ
                            </span>
                          )}
                        </div>
                        <div className="text-dim text-xs">
                          {emp.position || emp.job_grade ? `ደረጃ ${emp.job_grade}` : "ባለሙያ"}
                        </div>
                      </div>
                      <Icons.chevronRight size={14} className="drawer-arrow-icon" />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="drawer-actions">
              <button
                className="btn btn-primary btn-sm btn-block"
                onClick={() => onFocusSubtree(data)}
              >
                <Icons.target size={14} style={{ marginRight: 6 }} /> ክፍሉን በቻርቱ ላይ አሳይ
              </button>
            </div>
          </div>
        ) : (
          /* ---------- PERSON DETAIL VIEW ---------- */
          <div className="drawer-section-group">
            {/* Person Hero Header */}
            <div className="drawer-hero">
              <div className="hero-avatar">{initials(data.full_name)}</div>
              <div className="hero-details">
                <h4 className="hero-name">{data.full_name}</h4>
                <div className="hero-title">{data.position_title || data.position || "ሰራተኛ"}</div>
                <div className="flex gap-6" style={{ marginTop: 6, flexWrap: "wrap" }}>
                  {data.job_grade && (
                    <span className="chip chip-neutral mono">ደረጃ {data.job_grade}</span>
                  )}
                  {data.is_head && <span className="chip chip-accent">የክፍል ኃላፊ</span>}
                  <span className="chip chip-success">
                    {statusLabel(data.employment_status || "active")}
                  </span>
                </div>
              </div>
            </div>

            {/* Department info */}
            {data.unit_name && (
              <div className="drawer-card">
                <div className="drawer-card-title">የተመደበበት ክፍል</div>
                <div
                  className="drawer-list-row clickable"
                  onClick={() => {
                    const unit = unitMap.get(Number(data.unit_id));
                    if (unit) onSelectNode(unit, "unit");
                  }}
                  title="የክፍሉን ዝርዝር ለማየት ይጫኑ"
                >
                  <Icons.org size={16} className="text-indigo" />
                  <div className="drawer-list-main">
                    <span className="list-title">{data.unit_name}</span>
                  </div>
                  <span className="text-xs text-indigo">ክፍሉን ይመልከቱ</span>
                  <Icons.chevronRight size={14} className="drawer-arrow-icon" />
                </div>
              </div>
            )}

            {/* Direct Supervisor */}
            <div className="drawer-card">
              <div className="drawer-card-title">የሚመራው (አስተዳዳሪ)</div>
              {personManager ? (
                <div
                  className="drawer-person-mini clickable"
                  onClick={() => onSelectNode(personManager, "person")}
                  title="የአስተዳዳሪውን መገለጫ ለማየት ይጫኑ"
                >
                  <div className="person-avatar">{initials(personManager.full_name)}</div>
                  <div className="person-info">
                    <div className="person-name">{personManager.full_name}</div>
                    <div className="person-role">{personManager.position || "አስተዳዳሪ"}</div>
                    {personManager.department_name && (
                      <div className="person-meta">{personManager.department_name}</div>
                    )}
                  </div>
                  <Icons.chevronRight size={14} className="drawer-arrow-icon" />
                </div>
              ) : (
                <div className="empty-state-sm">
                  ከፍተኛ የአመራር ደረጃ፤ ቀጥተኛ አስተዳዳሪ አልተመዘገበም።
                </div>
              )}
            </div>

            {/* Direct Reports */}
            <div className="drawer-card">
              <div className="drawer-card-title">ቀጥተኛ ተጠሪዎች ({directReports.length})</div>
              {directReports.length === 0 ? (
                <div className="empty-state-sm">በቀጥታ የሚመሩ ሰራተኞች የሉም።</div>
              ) : (
                <div className="drawer-list">
                  {directReports.map((report) => (
                    <div
                      key={report.id}
                      className="drawer-list-row clickable"
                      onClick={() => onSelectNode(report, "person")}
                    >
                      <div className="person-avatar-xs">{initials(report.full_name)}</div>
                      <div className="drawer-list-main">
                        <div className="list-title">{report.full_name}</div>
                        <div className="text-dim text-xs">
                          {report.position || (report.job_grade ? `ደረጃ ${report.job_grade}` : "ሰራተኛ")}
                        </div>
                      </div>
                      <Icons.chevronRight size={14} className="drawer-arrow-icon" />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Contact / System Info */}
            <div className="drawer-card">
                <div className="drawer-card-title">የሰራተኛ መዝገብ</div>
              <div className="info-key-val">
                <span className="info-key">ኢሜይል፦</span>
                <span className="info-val mono">{data.email || "—"}</span>
              </div>
              <div className="info-key-val">
                <span className="info-key">የሰራተኛ መለያ፦</span>
                <span className="info-val mono">#{data.id}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="drawer-actions">
              <button
                className="btn btn-primary btn-sm btn-block"
                onClick={() => onFocusSubtree(data)}
              >
                <Icons.target size={14} style={{ marginRight: 6 }} /> የሪፖርት ቅርንጫፉን አሳይ
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
