import { createContext, useContext, useState, useCallback } from "react";
import { Icons } from "../components/icons";

const ToastContext = createContext(null);

let idCounter = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((message, type = "info", ttl = 4200) => {
    const id = ++idCounter;
    setToasts((ts) => [...ts, { id, message, type }]);
    setTimeout(() => dismiss(id), ttl);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.type === "success" && <Icons.check size={16} style={{ color: "var(--green)" }} />}
            {t.type === "error" && <Icons.alert size={16} style={{ color: "var(--crimson)" }} />}
            {t.type === "info" && <Icons.spark size={16} style={{ color: "var(--indigo)" }} />}
            <span>{t.message}</span>
            <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <Icons.close size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
