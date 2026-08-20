import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import EpistemicTag from "../EpistemicTag";
import Skeleton from "../Skeleton";
import OrgTree from "./OrgTree";
import UnitModal from "./UnitModal";
import LevelsPanel from "./LevelsPanel";
import PositionsPanel from "./PositionsPanel";
import ReportingPanel from "./ReportingPanel";
import OrgChart from "./OrgChart";
import TransferModal from "./TransferModal";
import { Icons } from "../icons";

const SUB_TABS = [
  { key: "units", label: "Units" },
  { key: "levels", label: "Level Types" },
  { key: "positions", label: "Positions" },
  { key: "reporting", label: "Reporting" },
  { key: "chart", label: "Org Chart" },
];

function flatten(nodes) {
  const out = [];
  const walk = (list) =>
    list.forEach((n) => {
      out.push(n);
      if (n.children) walk(n.children);
    });
  walk(nodes);
  return out;
}

export default function OrgStructure() {
  const { user } = useAuth();
  const toast = useToast();
  const canEdit = user.role === "admin";

  const [tab, setTab] = useState("units");
  const [tree, setTree] = useState([]);
  const [unitTypes, setUnitTypes] = useState([]);
  const [positions, setPositions] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [relationships, setRelationships] = useState([]);
  const [peopleTree, setPeopleTree] = useState([]);
  const [selected, setSelected] = useState(null);
  const [unitModal, setUnitModal] = useState(null);
  const [transfer, setTransfer] = useState(null);
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [t, ut, p, e, r, pt] = await Promise.all([
        api.get("/org/tree"),
        api.get("/org/unit-types"),
        api.get("/org/positions"),
        api.get("/employees"),
        api.get("/org/reporting-relationships"),
        api.get("/org/people-tree"),
      ]);
      setTree(t);
      setUnitTypes(ut);
      setPositions(p);
      setEmployees(e);
      setRelationships(r);
      setPeopleTree(pt);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const flatUnits = useMemo(() => flatten(tree), [tree]);
  const selectedUnit = flatUnits.find((u) => u.id === selected?.id) || null;
  const unitEmployees = selectedUnit
    ? employees.filter((e) => e.department_id === selectedUnit.id)
    : [];

  async function moveUnit(unitId, parentId) {
    try {
      await api.post(`/org/units/${unitId}/move`, { parent_id: parentId, override: overrideEnabled });
      toast.push("Unit moved", "success");
      await load();
    } catch (err) {
      toast.push(err.message, "error");
    }
  }

  async function deleteUnit(unit) {
    if (!window.confirm(`Delete "${unit.name}"? This only works for empty units.`)) return;
    try {
      await api.delete(`/org/units/${unit.id}`);
      toast.push(`"${unit.name}" deleted`, "success");
      if (selected?.id === unit.id) setSelected(null);
      await load();
    } catch (err) {
      toast.push(err.message, "error");
    }
  }

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 14 }}>
        <div className="segmented">
          {SUB_TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        {canEdit && tab === "units" && (
          <div className="flex gap-8" style={{ alignItems: "center" }}>
            <label className="text-dim" style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={overrideEnabled}
                onChange={(e) => setOverrideEnabled(e.target.checked)}
              />
              allow matrix drops
            </label>
            <button className="btn btn-primary btn-sm" onClick={() => setUnitModal({ mode: "create", parent: null })}>
              <Icons.plus size={14} /> New root unit
            </button>
          </div>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <Skeleton rows={6} />
      ) : (
        <>
          {tab === "units" && (
            <div className="grid grid-2">
              <div className="card">
                <div className="card-title">
                  Org Structure <EpistemicTag kind="fact" />
                </div>
                <div className="text-faint" style={{ fontSize: 12, marginBottom: 10 }}>
                  {canEdit ? "Drag a unit onto another to reparent it. Click a unit to inspect it." : "Read-only view."}
                </div>
                <OrgTree
                  tree={tree}
                  unitTypes={unitTypes}
                  selectedId={selected?.id}
                  onSelect={setSelected}
                  onEdit={(u) => setUnitModal({ mode: "edit", unit: u })}
                  onAddChild={(u) => setUnitModal({ mode: "create", parent: u })}
                  onMove={moveUnit}
                  onDelete={deleteUnit}
                  canEdit={canEdit}
                />
              </div>
              <div className="card">
                <div className="card-title">
                  {selectedUnit ? selectedUnit.name : "Select a unit"}
                  {selectedUnit?.code && <span className="mono text-faint" style={{ marginLeft: 8, fontSize: 12 }}>{selectedUnit.code}</span>}
                </div>
                {selectedUnit ? (
                  <>
                    <div className="unit-meta">
                      <div>
                        <div className="cell-sub">Level type</div>
                        <div className="cell-strong">{selectedUnit.unit_type_name || "—"}</div>
                      </div>
                      <div>
                        <div className="cell-sub">Head</div>
                        <div className="cell-strong">{selectedUnit.head ? selectedUnit.head.full_name : "—"}</div>
                      </div>
                      <div>
                        <div className="cell-sub">People</div>
                        <div className="cell-strong">{selectedUnit.employee_count}</div>
                      </div>
                      <div>
                        <div className="cell-sub">Positions</div>
                        <div className="cell-strong">{selectedUnit.position_count}</div>
                      </div>
                    </div>
                    <div className="divider" />
                    <div className="card-title" style={{ marginTop: 10 }}>People in this unit</div>
                    {unitEmployees.length === 0 && <div className="empty-state">No employees assigned to this unit.</div>}
                    {unitEmployees.map((e) => (
                      <div key={e.id} className="flex-between" style={{ padding: "8px 2px", borderBottom: "1px solid #f0f2f7" }}>
                        <div>
                          <div className="cell-strong" style={{ fontSize: 13 }}>{e.full_name}</div>
                          <div className="cell-sub">{e.position || e.job_grade || "no role"}</div>
                        </div>
                        {canEdit && (
                          <button className="btn btn-sm" title="Transfer employee" onClick={() => setTransfer(e)}>
                            <Icons.swap size={13} /> Transfer
                          </button>
                        )}
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="empty-state">Select a unit to see its details, head, and people.</div>
                )}
              </div>
            </div>
          )}

          {tab === "levels" && <LevelsPanel unitTypes={unitTypes} onChanged={load} toast={toast} canEdit={canEdit} />}

          {tab === "positions" && (
            <PositionsPanel
              units={flatUnits}
              positions={positions}
              employees={employees}
              unitId={null}
              onUnitIdChange={(id) => setSelected(flatUnits.find((u) => u.id === id) || null)}
              onChanged={load}
              toast={toast}
              canEdit={canEdit}
            />
          )}

          {tab === "reporting" && (
            <ReportingPanel relationships={relationships} employees={employees} onChanged={load} toast={toast} canEdit={canEdit} />
          )}

          {tab === "chart" && <OrgChart tree={tree} people={peopleTree} />}
        </>
      )}

      {unitModal && (
        <UnitModal
          unit={unitModal.mode === "edit" ? unitModal.unit : null}
          unitTypes={unitTypes}
          units={flatUnits}
          defaultParent={unitModal.mode === "create" ? unitModal.parent?.id || null : null}
          onClose={() => setUnitModal(null)}
          onSaved={load}
        />
      )}

      {transfer && (
        <TransferModal
          employee={transfer}
          units={flatUnits}
          positions={positions}
          employees={employees}
          onClose={() => setTransfer(null)}
          onSaved={() => { setTransfer(null); load(); }}
          toast={toast}
        />
      )}
    </div>
  );
}
