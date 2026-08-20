import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { Icons } from "../components/icons";
import { api } from "../api";

const FEATURES = [
  { icon: "target", title: "Explainable scoring", text: "Every score is a transparent, weighted calculation." },
  { icon: "spark", title: "AI intelligence", text: "Insights and predictions tagged with their source data." },
  { icon: "shield", title: "Governed & auditable", text: "Human-in-the-loop, full audit trail, RBAC." },
  { icon: "chart", title: "Trends & forecasts", text: "Performance history and completion probabilities." },
];

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [demo, setDemo] = useState([]);

  useEffect(() => {
    api.get("/reference/demo-accounts").then(setDemo).catch(() => setDemo([]));
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-hero">
        <div className="brand">
          <div className="brand-mark">EP</div>
          <div>
            <div className="brand-name">EPA PMS</div>
            <div className="brand-sub">Environmental Performance</div>
          </div>
        </div>
        <h1>
          Environmental <em>performance</em> intelligence, without the black box.
        </h1>
        <p>
          Measure environmental objectives transparently. Cascade goals through your EPA hierarchy. Track KPIs,
          competencies, and evaluations continuously — with an AI layer that advises,
          explains, and never decides on its own.
        </p>
        <div className="login-feature">
          {FEATURES.map((f, i) => {
            const Icon = Icons[f.icon];
            return (
              <div className="feat" key={i}>
                <Icon size={17} />
                <span><b>{f.title}</b>{f.text}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="login-panel">
        <div className="login-card">
          <div className="login-brand">Welcome back</div>
          <div className="login-tag">Sign in to your performance workspace</div>

          {error && <div className="error-banner">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Username</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. manager1"
                autoFocus
              />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: "100%" }}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="login-quick" style={{ marginTop: 20 }}>
            <span className="hint">Demo accounts — tap to autofill</span>
            {demo.map((d) => (
              <button key={d.username} onClick={() => { setUsername(d.username); setPassword(d.password); }} title={d.role}>
                {d.username} · {d.role}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
