import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { Icons } from "../components/icons";
import { api } from "../api";
import { ROLE_LABELS } from "../i18n";

const FEATURES = [
  { icon: "target", title: "ሊብራራ የሚችል ነጥብ", text: "እያንዳንዱ ነጥብ ግልጽ እና በክብደት የተሰላ ነው።" },
  { icon: "spark", title: "የAI መረጃ", text: "ግንዛቤዎች እና ትንበያዎች ከምንጫቸው ጋር ይታያሉ።" },
  { icon: "shield", title: "ቁጥጥር እና ኦዲት", text: "የሰው ቁጥጥር፣ ሙሉ የኦዲት መዝገብ እና RBAC።" },
  { icon: "chart", title: "አዝማሚያ እና ትንበያ", text: "የአፈጻጸም ታሪክ እና የማጠናቀቅ ዕድል።" },
];

// Optional local-only convenience. Production builds should leave this unset.
const DEMO_PASSWORD = import.meta.env.VITE_DEMO_PASSWORD || "";

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
          <div className="brand-sub">የአካባቢ አፈጻጸም</div>
          </div>
        </div>
        <h1>
          ግልጽ የአካባቢ <em>አፈጻጸም</em> መረጃ፣ ያለ ጥቁር ሳጥን።
        </h1>
        <p>
          የአካባቢ ዓላማዎችን በግልጽነት ይለኩ። ግቦችን በEPA መዋቅርዎ ውስጥ ያውርዱ። KPIዎችን፣
          ብቃቶችን እና ግምገማዎችን በቀጣይነት ይከታተሉ፤ AI ይመክራል እና ያብራራል፣ በራሱ ውሳኔ አይሰጥም።
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
          <div className="login-brand">እንኳን ደህና መጡ</div>
          <div className="login-tag">ወደ የአፈጻጸም የሥራ ቦታዎ ይግቡ</div>

          {error && <div className="error-banner">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>የተጠቃሚ ስም</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ለምሳሌ፦ manager1"
                autoFocus
              />
            </div>
            <div className="field">
              <label>የይለፍ ቃል</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: "100%" }}>
              {loading ? "በመግባት ላይ…" : "ግባ"}
            </button>
          </form>

          <div className="login-quick" style={{ marginTop: 20 }}>
            <span className="hint">የሙከራ መለያዎች — ለመሙላት ይንኩ</span>
            {demo.map((d) => (
              <button key={d.username} onClick={() => { setUsername(d.username); if (DEMO_PASSWORD) setPassword(DEMO_PASSWORD); }} title={ROLE_LABELS[d.role] || d.role}>
                {d.username} · {ROLE_LABELS[d.role] || d.role}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
