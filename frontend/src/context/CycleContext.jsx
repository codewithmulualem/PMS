import { createContext, useContext, useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "./AuthContext";

const CycleContext = createContext(null);

export function CycleProvider({ children }) {
  const { user } = useAuth();
  const [cycles, setCycles] = useState([]);
  const [cycleId, setCycleId] = useState(() => Number(localStorage.getItem("pms_cycle")) || null);
  const [ready, setReady] = useState(false);

  // Keyed on the authenticated user: the mount-time fetch used to fire before
  // login and 401 silently, leaving the cycle selector empty until a reload.
  useEffect(() => {
    if (!user) {
      setCycles([]);
      setReady(true);
      return;
    }
    api
      .get("/cycles")
      .then((list) => {
        setCycles(list);
        setCycleId((cur) => {
          if (cur && list.some((c) => c.id === cur)) return cur;
          const active = list.find((c) => c.status === "active");
          return (active && active.id) || (list.length && list[0].id) || null;
        });
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, [user?.id]);

  function select(id) {
    setCycleId(id);
    localStorage.setItem("pms_cycle", String(id));
  }

  const current = cycles.find((c) => c.id === cycleId) || null;

  return (
    <CycleContext.Provider value={{ cycles, cycleId, current, select, ready }}>
      {children}
    </CycleContext.Provider>
  );
}

export function useCycle() {
  return useContext(CycleContext);
}
