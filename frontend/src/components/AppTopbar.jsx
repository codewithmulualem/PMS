import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useCycle } from "../context/CycleContext";
import AccountModal from "./AccountModal";
import { Icons } from "./icons";

function initials(name = "") {
  return name.split(" ").filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join("");
}

export default function AppTopbar({ title, collapsed, onToggle }) {
  const { user, logout } = useAuth();
  const { cycles, cycleId, select, ready } = useCycle();
  const [open, setOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <header className="app-topbar">
      <div className="topbar-left">
        <button
          className={`topbar-burger ${collapsed ? "active" : ""}`}
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
        >
          <Icons.menu size={18} />
        </button>
        <div className="topbar-page-title">{title}</div>
      </div>
      <div className="topbar-right">
        {ready && cycles.length > 0 && (
          <div className="cycle-select">
            <select value={cycleId || ""} onChange={(e) => select(Number(e.target.value))} aria-label="Performance cycle">
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.status === "active" ? "• active" : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="topbar-user-menu" ref={menuRef}>
          <button
            className="topbar-user"
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={open}
            title={user.employee?.full_name || user.username}
          >
            <div className="avatar avatar-sm">{initials(user.employee?.full_name || user.username)}</div>
            <div className="topbar-user-text">
              <div className="topbar-user-name">{user.employee?.full_name || user.username}</div>
              <div className="topbar-user-role">{user.role}</div>
            </div>
            <Icons.chevronDown size={14} className="topbar-user-caret" />
          </button>
          {open && (
            <div className="topbar-user-dropdown" role="menu">
              <div className="dropdown-header">
                <div className="dropdown-name">{user.employee?.full_name || user.username}</div>
                <span className="role-pill">{user.role}</span>
              </div>
              <button className="dropdown-item" role="menuitem"
                onClick={() => { setOpen(false); setAccountOpen(true); }}>
                <Icons.key size={14} /> <span>My account</span>
              </button>
              <button className="dropdown-item" role="menuitem" onClick={logout}>
                <Icons.logout size={14} /> <span>Sign out</span>
              </button>
            </div>
          )}
        </div>
      </div>
      {accountOpen && <AccountModal onClose={() => setAccountOpen(false)} />}
    </header>
  );
}
