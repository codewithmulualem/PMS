import { useEffect } from "react";
import { Icons } from "./icons";

export default function Modal({ title, subtitle, onClose, children, footer, wide = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "modal-wide" : ""}`}>
        <div className="modal-head">
          <div>
            <div className="modal-title">{title}</div>
            {subtitle && <div className="modal-sub">{subtitle}</div>}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="ዝጋ">
            <Icons.close />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-body" style={{ paddingTop: 0 }}>{footer}</div>}
      </div>
    </div>
  );
}
