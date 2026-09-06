import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../api";
import { Icons } from "./icons";
import { NAV_LABELS, ROLE_NAV } from "../i18n";

export default function Sidebar({ page, setPage, collapsed, open, onNavigate }) {
  const { user } = useAuth();
  const [nav, setNav] = useState([]);
  const [pendingEvals, setPendingEvals] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState(0);

  useEffect(() => {
    if (!user) return;
    api
      .get("/me/navigation")
      .then(setNav)
      .catch(() => setNav([]));
  }, [user]);

  useEffect(() => {
    if (["director", "dept_head", "team_leader", "manager"].includes(user?.role) && user.employee_id) {
      api
        .get(`/managers/${user.employee_id}/team-dashboard`)
        .then((d) => setPendingEvals(d.evaluations_pending || 0))
        .catch(() => {});
    }
  }, [user]);

  useEffect(() => {
    if (!["director", "dept_head", "team_leader", "manager", "executive", "admin"].includes(user?.role)) return;
    api
      .get("/approvals/pending")
      .then((d) => setPendingApprovals(Array.isArray(d) ? d.length : 0))
      .catch(() => {});
  }, [user, page]);

  const Icon = (name) => Icons[name] || Icons.target;
  const badge = (key) => (key === "team" ? pendingEvals : key === "approvals" ? pendingApprovals : 0);
  const allowedKeys = ROLE_NAV[user?.role] || [];
  const serverItems = new Map(nav.map((item) => [item.item_key, item]));
  // Merge the database menu with the current client contract. Existing
  // installations may have been seeded before a page was added; the merge
  // keeps Programs and plan pages visible without granting a new permission.
  const visibleNav = allowedKeys.map((key, index) => ({
    item_key: key,
    label: NAV_LABELS[key] || serverItems.get(key)?.label || key,
    icon: serverItems.get(key)?.icon || "target",
    sort_order: serverItems.get(key)?.sort_order ?? index,
  }));

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""} ${open ? "open" : ""}`}>
      <div className="brand">
        <div className="brand-mark">EP</div>
        <div className="brand-text">
          <div className="brand-name">EPA PMS</div>
          <div className="brand-sub">የአካባቢ አፈጻጸም</div>
        </div>
      </div>

      <div className="nav-group">
        <div className="nav-label">የሥራ ቦታ</div>
        {visibleNav.map((item) => {
          const NavIcon = Icon(item.icon);
          const n = badge(item.item_key);
          return (
            <div
              key={item.item_key}
              className={`nav-link ${page === item.item_key ? "active" : ""}`}
              onClick={() => {
                setPage(item.item_key);
                onNavigate?.();
              }}
              role="button"
              tabIndex={0}
              title={collapsed && !open ? item.label : undefined}
              onKeyDown={(e) => e.key === "Enter" && (setPage(item.item_key), onNavigate?.())}
            >
              <NavIcon size={17} />
              <span>{item.label}</span>
              {n > 0 && <span className="nav-badge">{n}</span>}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
