// Relative "/api" keeps dev same-origin through the Vite proxy. Production can
// override with an absolute URL via VITE_API_BASE_URL in .env.
const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

// Loaded synchronously at module scope so that any request fired by a child
// effect (e.g. CycleProvider on mount, which runs BEFORE AuthProvider's
// restore effect) still carries the stored token.
let authToken = (() => {
  try {
    return sessionStorage.getItem("pms_token");
  } catch (_e) {
    return null;
  }
})();
let onUnauthorized = null;

export function setAuthToken(token) {
  authToken = token;
  if (token) {
    sessionStorage.setItem("pms_token", token);
  } else {
    sessionStorage.removeItem("pms_token");
  }
}

export function loadStoredToken() {
  authToken = sessionStorage.getItem("pms_token");
  return authToken;
}

export function registerUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch (_e) {
    data = null;
  }

  if (res.status === 401) {
    const errorMsg = (data && data.error) || "Invalid credentials or unauthorized";
    if (path === "/auth/login") {
      const err = new Error(errorMsg);
      err.status = 401;
      throw err;
    }
    onUnauthorized?.();
    const sessionExpiredMsg =
      errorMsg === "Token expired" || errorMsg === "Invalid token" || errorMsg === "Missing or invalid Authorization header"
        ? "Your session has expired. Please sign in again."
        : errorMsg;
    const err = new Error(sessionExpiredMsg);
    err.status = 401;
    throw err;
  }

  if (!res.ok) {
    const message = (data && data.error) || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body),
  put: (path, body) => request("PUT", path, body),
  delete: (path) => request("DELETE", path),
};
