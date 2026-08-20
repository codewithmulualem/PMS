import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import Topbar from "../components/Topbar";
import Modal from "../components/Modal";
import Skeleton from "../components/Skeleton";
import EmployeeDashboard from "./EmployeeDashboard";
import { Icons } from "../components/icons";

function initials(name = "") {
  return name.split(" ").filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join("");
}

const AVATAR_COLORS = ["#4c5fd5", "#0e8f7e", "#b17a17", "#d64545", "#2f9e44", "#7c5cd5"];

// Fallback until /reference/roles loads (or for roles without access).
const ACCOUNT_ROLES = ["employee", "manager", "executive", "admin"];

const EMPTY_FORM = {
  full_name: "", email: "", position: "", job_grade: "",
  department_id: "", manager_id: "", employment_status: "active",
  date_joined: "", username: "", password: "", role: "employee",
};

const EMPTY_ACCOUNT = { username: "", password: "", role: "" };

export default function EmployeesAdmin() {
  const { user } = useAuth();
  const toast = useToast();
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState(ACCOUNT_ROLES);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [createdLogin, setCreatedLogin] = useState(null);
  const [accountTarget, setAccountTarget] = useState(null);
  const [accountForm, setAccountForm] = useState(EMPTY_ACCOUNT);
  const [savingAccount, setSavingAccount] = useState(false);
  const [resetResult, setResetResult] = useState(null);
  const canCreate = user.role === "admin";

  async function load() {
    try {
      const [emps, depts] = await Promise.all([api.get("/employees"), api.get("/departments")]);
      setEmployees(emps);
      setDepartments(depts);
    } catch (err) {
      setError(err.message);
    }
    // Best-effort role list; never fail the page because it couldn't load.
    api.get("/reference/roles").then((r) => r.length && setRoles(r)).catch(() => {});
  }

  useEffect(() => { load(); }, []);

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError(null);
    setShowForm(true);
  }

  function openLogin(emp) {
    setAccountTarget(emp);
    setAccountForm({ username: emp.username || "", password: "", role: emp.role || "" });
    setResetResult(null);
    setError(null);
  }

  async function saveAccount(e) {
    e.preventDefault();
    setSavingAccount(true);
    setError(null);
    try {
      const payload = {};
      if (accountForm.username.trim()) payload.username = accountForm.username.trim();
      if (accountForm.password) payload.password = accountForm.password;
      if (accountForm.role) payload.role = accountForm.role;
      const res = await api.post(`/employees/${accountTarget.id}/account`, payload);
      if (res.password_generated) {
        setAccountTarget(null);
        setResetResult(res);
      } else {
        toast.push(`${accountTarget.full_name} login updated`, "success");
        setAccountTarget(null);
      }
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingAccount(false);
    }
  }

  function openEdit(emp) {
    setEditing(emp);
    setForm({
      full_name: emp.full_name || "",
      email: emp.email || "",
      position: emp.position || "",
      job_grade: emp.job_grade || "",
      department_id: emp.department_id || "",
      manager_id: emp.manager_id || "",
      employment_status: emp.employment_status || "active",
      date_joined: emp.date_joined || "",
      username: emp.username || "",
      password: "",
      role: emp.role || emp.role_name || "employee",
    });
    setError(null);
    setShowForm(true);
  }

  async function saveEmployee(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...form,
        department_id: form.department_id || null,
        manager_id: form.manager_id || null,
      };
      if (!form.password) delete payload.password;
      if (!form.username) delete payload.username;

      if (editing) {
        const res = await api.put(`/employees/${editing.id}`, payload);
        if (res && res.password_generated && res.temp_password) {
          setCreatedLogin(res);
          setShowForm(false);
        } else {
          toast.push(`${form.full_name} updated`, "success");
          setShowForm(false);
        }
        setEditing(null);
        load();
      } else {
        const res = await api.post("/employees", payload);
        if (res.password_generated) {
          setCreatedLogin(res);
          setShowForm(false);
        } else {
          toast.push(`${form.full_name} added to the organization`, "success");
          setShowForm(false);
        }
        setEditing(null);
        load();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeEmployee(emp) {
    if (!confirm(`Delete ${emp.full_name} permanently? This removes their login, KPIs, goals, evaluations, and approval records. This cannot be undone.`)) return;
    try {
      await api.delete(`/employees/${emp.id}`);
      toast.push(`${emp.full_name} deleted`, "success");
      load();
    } catch (err) {
      toast.push(err.message, "error");
    }
  }

  if (selected) {
    return <EmployeeDashboard employeeId={selected} backLabel="Back to employees" onBack={() => setSelected(null)} />;
  }

  if (error && !employees.length) return <div className="error-banner">{error}</div>;

  const filtered = employees.filter((e) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [e.full_name, e.position, e.department_name, e.email, e.job_grade, e.role, e.username].some((v) => (v || "").toLowerCase().includes(q));
  });

  return (
    <div>
      <Topbar
        subtitle={`${employees.length} people in the organization`}
      >
        {canCreate && (
          <button className="btn btn-primary" onClick={openAdd}>
            <Icons.plus size={16} /> Add employee
          </button>
        )}
      </Topbar>

      {error && <div className="error-banner">{error}</div>}

      {showForm && (
        <Modal
          title={editing ? "Edit employee" : "Add employee"}
          subtitle={editing ? `Update ${editing.full_name}'s profile, login, and reporting line` : "Create a record and reporting relationship"}
          onClose={() => { setShowForm(false); setEditing(null); setError(null); }}
        >
          <form onSubmit={saveEmployee}>
            {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}
            <div className="form-grid">
              <div className="field">
                <label>Full name</label>
                <input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
              </div>
              <div className="field">
                <label>Email</label>
                <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="field">
                <label>Position</label>
                <input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} placeholder="e.g. Software Engineer" />
              </div>
              <div className="field">
                <label>Job grade</label>
                <input value={form.job_grade} onChange={(e) => setForm({ ...form, job_grade: e.target.value })} placeholder="e.g. G5" />
              </div>
              <div className="field">
                <label>Department</label>
                <select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
                  <option value="">—</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Manager</label>
                <select value={form.manager_id} onChange={(e) => setForm({ ...form, manager_id: e.target.value })}>
                  <option value="">—</option>
                  {employees
                    .filter((e) => !editing || e.id !== editing.id)
                    .map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Employment status</label>
                <select value={form.employment_status} onChange={(e) => setForm({ ...form, employment_status: e.target.value })}>
                  <option value="active">Active</option>
                  <option value="probation">Probation</option>
                  <option value="on_leave">On Leave</option>
                  <option value="resigned">Resigned</option>
                  <option value="terminated">Terminated</option>
                </select>
              </div>
              <div className="field">
                <label>Date joined</label>
                <input type="date" value={form.date_joined} onChange={(e) => setForm({ ...form, date_joined: e.target.value })} />
              </div>
              <div className="field">
                <label>Username <span className="text-faint">(sign-in)</span></label>
                <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="defaults to email local part" autoComplete="off" />
              </div>
              <div className="field">
                <label>{editing ? "Password" : "Initial password"} <span className="text-faint">({editing ? "blank keeps current" : "optional, blank generates temp"})</span></label>
                <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={editing ? "Leave blank to keep unchanged" : "Blank generates one-time password"} autoComplete="new-password" />
              </div>
              <div className="field">
                <label>Role</label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-8" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" className="btn btn-secondary" onClick={() => { setShowForm(false); setEditing(null); setError(null); }}>Cancel</button>
              <button className="btn btn-primary" type="submit" disabled={saving}>
                {saving ? "Saving…" : editing ? "Save changes" : "Create employee"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {createdLogin && (
        <Modal
          title="Login created"
          subtitle="Share the initial credentials — they are shown only once"
          onClose={() => setCreatedLogin(null)}
        >
          <div className="card" style={{ padding: 16 }}>
            <div className="field">
              <label>Username</label>
              <div className="mono" style={{ fontSize: 15, padding: "8px 0" }}>{createdLogin.username}</div>
            </div>
            <div className="field" style={{ marginTop: 8 }}>
              <label>Initial password (one-time)</label>
              <div className="mono" style={{ fontSize: 15, padding: "8px 0" }}>{createdLogin.temp_password}</div>
            </div>
          </div>
          <div className="flex gap-8" style={{ justifyContent: "flex-end", marginTop: 12 }}>
            <button className="btn btn-primary" onClick={() => setCreatedLogin(null)}>Got it</button>
          </div>
        </Modal>
      )}

      {accountTarget && (
        <Modal
          title={accountTarget.has_account ? `Login · ${accountTarget.full_name}` : `Enable login · ${accountTarget.full_name}`}
          subtitle={accountTarget.has_account ? "Set a new initial password (blank generates a temporary one)" : "Create a sign-in account (blank password generates a temporary one)"}
          onClose={() => { setAccountTarget(null); setError(null); }}
        >
          <form onSubmit={saveAccount}>
            <div className="form-grid">
              <div className="field">
                <label>Username</label>
                <input value={accountForm.username} onChange={(e) => setAccountForm({ ...accountForm, username: e.target.value })} placeholder="defaults to the email local part" autoComplete="off" />
              </div>
              <div className="field">
                <label>New password</label>
                <input type="password" value={accountForm.password} onChange={(e) => setAccountForm({ ...accountForm, password: e.target.value })} placeholder="blank generates a temporary one" autoComplete="new-password" />
              </div>
              <div className="field">
                <label>Role</label>
                <select value={accountForm.role} onChange={(e) => setAccountForm({ ...accountForm, role: e.target.value })}>
                  <option value="">— keep current ({accountTarget.role || "employee"}) —</option>
                  {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
            {error && <div className="error-banner">{error}</div>}
            <div className="flex gap-8" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" className="btn btn-secondary" onClick={() => { setAccountTarget(null); setError(null); }}>Cancel</button>
              <button className="btn btn-primary" type="submit" disabled={savingAccount}>
                {savingAccount ? "Saving…" : accountTarget.has_account ? "Reset password" : "Create login"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {resetResult && (
        <Modal
          title="Password reset"
          subtitle="Temporary credentials — shown only once"
          onClose={() => { setResetResult(null); setAccountTarget(null); setError(null); }}
        >
          <div className="card" style={{ padding: 16 }}>
            <div className="field">
              <label>Username</label>
              <div className="mono" style={{ fontSize: 15, padding: "8px 0" }}>{resetResult.username}</div>
            </div>
            <div className="field" style={{ marginTop: 8 }}>
              <label>Temporary password</label>
              <div className="mono" style={{ fontSize: 15, padding: "8px 0" }}>{resetResult.temp_password}</div>
            </div>
          </div>
          <div className="flex gap-8" style={{ justifyContent: "flex-end", marginTop: 12 }}>
            <button className="btn btn-primary" onClick={() => { setResetResult(null); setAccountTarget(null); setError(null); }}>Got it</button>
          </div>
        </Modal>
      )}

      <div className="card">
        <div className="flex-between mb-16" style={{ flexWrap: "wrap", gap: 10 }}>
          <div className="card-title" style={{ margin: 0 }}>Directory</div>
          <input
            type="search"
            placeholder="Search name, role, department…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ padding: "8px 12px", border: "1px solid var(--line-strong)", borderRadius: 9, fontSize: 13, width: 260 }}
          />
        </div>
        {filtered.length === 0 ? (
          <div className="empty-state">No employees match your search.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Position</th>
                  <th>Department</th>
                  <th>Grade</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th className="num" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((emp) => (
                  <tr key={emp.id} className="clickable" onClick={() => setSelected(emp.id)}>
                    <td>
                      <div className="avatar-cell">
                        <div className="avatar avatar-sm" style={{ background: AVATAR_COLORS[emp.id % AVATAR_COLORS.length] }}>{initials(emp.full_name)}</div>
                        <div>
                          <div className="cell-strong">{emp.full_name}</div>
                          <div className="cell-sub">{emp.email}</div>
                          {canCreate && (
                            <div className="cell-sub">
                              {emp.has_account
                                ? <><Icons.key size={11} style={{ verticalAlign: "-1px" }} /> <span className="mono">{emp.username}</span></>
                                : <span className="chip chip-neutral" style={{ marginTop: 2 }}>no login</span>}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>{emp.position || "—"}</td>
                    <td>{emp.department_name || "—"}</td>
                    <td className="mono">{emp.job_grade || "—"}</td>
                    <td>
                      <span className="role-pill" style={{ textTransform: "capitalize" }}>{emp.role || "employee"}</span>
                    </td>
                    <td>
                      {emp.employment_status === "active"
                        ? <span className="chip chip-success">active</span>
                        : <span className="chip chip-neutral">{emp.employment_status || "active"}</span>}
                    </td>
                    <td className="num">
                      <div className="flex gap-8" style={{ justifyContent: "flex-end" }}>
                        {canCreate && (
                          <>
                            <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); openLogin(emp); }}>
                              <Icons.key size={13} /> {emp.has_account ? "Login" : "Enable login"}
                            </button>
                            <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); openEdit(emp); }}><Icons.edit size={13} /> Edit</button>
                            <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); removeEmployee(emp); }}><Icons.trash size={13} /> Delete</button>
                          </>
                        )}
                        <Icons.external size={14} className="text-faint" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
