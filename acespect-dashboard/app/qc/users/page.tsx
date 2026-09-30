"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, getRole } from "@/lib/api";
import { TopBar, QcNav } from "@/lib/ui";
import type { QcPerson } from "@/lib/qcTypes";

export default function QcUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<QcPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  function reload() {
    api<{ users: QcPerson[] }>("/qc/users")
      .then((d) => setUsers(d.users))
      .catch((e: ApiError) => {
        if (e.status === 401 || e.status === 403) router.replace("/login");
        else setError(e.message);
      });
  }

  useEffect(() => {
    if (getRole() !== "ADMIN") {
      router.replace("/inspections");
      return;
    }
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || password.length < 8) return;
    setBusy(true);
    setCreateErr(null);
    try {
      await api("/qc/users", { method: "POST", body: JSON.stringify({ name: name.trim(), email: email.trim(), password }) });
      setCreated({ email: email.trim(), password });
      setName("");
      setEmail("");
      setPassword("");
      reload();
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : "Failed to create account");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar />
      <div className="container">
        <h1 className="page-title">Field Users</h1>
        <p className="page-sub">
          Everyone who can be assigned a QC defect — existing Houspect inspectors, plus dedicated field-worker accounts you create here.
        </p>
        <QcNav />

        {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Assignee roster</h3>
          <table>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Role</th></tr>
            </thead>
            <tbody>
              {users?.map((u) => (
                <tr key={u.id} style={{ cursor: "default" }}>
                  <td>{u.name ?? "—"}</td>
                  <td className="muted">{u.email}</td>
                  <td><span className="badge slate">{u.role}</span></td>
                </tr>
              ))}
              {users && users.length === 0 && (
                <tr><td colSpan={3} className="muted" style={{ textAlign: "center", padding: 20 }}>No assignable users yet.</td></tr>
              )}
              {!users && !error && (
                <tr><td colSpan={3} className="muted" style={{ textAlign: "center", padding: 20 }}>Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0, marginBottom: 2 }}>Create a field-worker account</h3>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            No invite email yet — share the password below with them directly; they'll sign into the mobile app with it.
          </p>
          {createErr && <div className="error" style={{ marginBottom: 10 }}>{createErr}</div>}
          {created && (
            <div className="ok-note">
              Account created for <strong>{created.email}</strong>. Temp password: <strong>{created.password}</strong>
            </div>
          )}
          <form onSubmit={createUser}>
            <div className="grid2">
              <div>
                <label>Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label>Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>
            <div className="spacer" />
            <label>Temporary password (min 8 characters)</label>
            <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
            <div className="spacer" />
            <button className="primary" disabled={busy || !name.trim() || !email.trim() || password.length < 8}>
              {busy ? "Creating…" : "Create account"}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
