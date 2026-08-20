import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../api";
import { Icons } from "./icons";

export default function Sidebar({ page, setPage, collapsed }) {
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
    if (["manager", "executive"].includes(user.role) && user.employee_id) {
      api
        .get(`/managers/${user.employee_id}/team-dashboard`)
        .then((d) => setPendingEvals(d.evaluations_pending || 0))
        .catch(() => {});
    }
  }, [user]);

  useEffect(() => {
    if (!["manager", "executive", "admin"].includes(user.role)) return;
    api
      .get("/approvals/pending")
      .then((d) => setPendingApprovals(Array.isArray(d) ? d.length : 0))
      .catch(() => {});
  }, [user, page]);

  const Icon = (name) => Icons[name] || Icons.target;
  const badge = (key) => (key === "team" ? pendingEvals : key === "approvals" ? pendingApprovals : 0);

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="brand">
        <div className="brand-mark">EP</div>
        <div className="brand-text">
          <div className="brand-name">EPA PMS</div>
          <div className="brand-sub">Environmental Performance</div>
        </div>
      </div>

      <div className="nav-group">
        <div className="nav-label">Workspace</div>
        {nav.map((item) => {
          const NavIcon = Icon(item.icon);
          const n = badge(item.key);
          return (
            <div
              key={item.item_key}
              className={`nav-link ${page === item.item_key ? "active" : ""}`}
              onClick={() => setPage(item.item_key)}
              role="button"
              tabIndex={0}
              title={collapsed ? item.label : undefined}
              onKeyDown={(e) => e.key === "Enter" && setPage(item.item_key)}
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
