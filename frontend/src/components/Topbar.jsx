import { Icons } from "./icons";

export default function Topbar({ title, subtitle, onBack, backLabel, children }) {
  return (
    <div className="topbar">
      <div className="topbar-title">
        {onBack && (
          <button className="back-btn" onClick={onBack}>
            <Icons.chevronLeft size={15} /> {backLabel || "ተመለስ"}
          </button>
        )}
        <div>
          {title && <div className="page-title">{title}</div>}
          {subtitle && <div className="page-subtitle">{subtitle}</div>}
        </div>
      </div>
      <div className="topbar-actions">{children}</div>
    </div>
  );
}
