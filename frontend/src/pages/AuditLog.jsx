import { useEffect, useState } from "react";
import { api } from "../api";
import Topbar from "../components/Topbar";
import AuditEvent from "../components/AuditEvent";
import { Icons } from "../components/icons";

const TYPES = [
  ["all", "All events"],
  ["auth", "Auth"],
  ["create", "Creates"],
  ["update", "Updates"],
  ["delete", "Deletes"],
  ["score", "Score changes"],
];

const PAGES = 20;

export default function AuditLog() {
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null);
  const [type, setType] = useState("all");
  const [limit, setLimit] = useState(PAGES);

  async function load() {
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (type !== "all") params.set("category", type);
      const data = await api.get(`/audit?${params}`);
      setEvents(data);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, [type, limit]);

  return (
    <div>
      <Topbar subtitle="Every change to the system of record — appended, never overwritten" />

      {error && <div className="error-banner">{error}</div>}

      <div className="chip-row">
        {TYPES.map(([key, label]) => (
          <button key={key} className={`chip chip-btn ${type === key ? "active" : ""}`} onClick={() => { setType(key); setLimit(PAGES); }}>
            {label}
          </button>
        ))}
      </div>

      <div className="card">
        {events.length === 0 && !error ? (
          <div className="empty-state">No events match this filter.</div>
        ) : (
          events.map((ev) => <AuditEvent key={`${ev.timestamp}-${ev.id}`} event={ev} />)
        )}

        {events.length >= limit && (
          <div className="center" style={{ paddingTop: 6 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setLimit((l) => l + PAGES)}>
              <Icons.more size={14} /> Load more
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
