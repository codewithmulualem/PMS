import { createContext, useContext, useEffect, useState } from "react";
import { api, setAuthToken, loadStoredToken, registerUnauthorizedHandler } from "../api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    registerUnauthorizedHandler(() => {
      setAuthToken(null);
      sessionStorage.removeItem("pms_user");
      setUser(null);
    });
  }, []);

  useEffect(() => {
    // Validate the stored session against the server instead of blindly
    // trusting the cached pms_user. The JWT holds the authoritative role;
    // trusting a stale cached role was causing the app to render the
    // executive page and get 403 from the backend.
    const stored = loadStoredToken();
    if (!stored) {
      setReady(true);
      return;
    }
    api
      .get("/auth/me")
      .then((me) => {
        setUser(me);
        sessionStorage.setItem("pms_user", JSON.stringify(me));
      })
      .catch(() => {
        setAuthToken(null);
        sessionStorage.removeItem("pms_user");
        setUser(null);
      })
      .finally(() => setReady(true));
  }, []);

  async function login(username, password) {
    const data = await api.post("/auth/login", { username, password });
    setAuthToken(data.token);
    sessionStorage.setItem("pms_user", JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }

  function logout() {
    setAuthToken(null);
    sessionStorage.removeItem("pms_user");
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, ready }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
