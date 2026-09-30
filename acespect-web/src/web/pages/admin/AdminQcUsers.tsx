import { useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { api } from "../../api";
import { Card, PageShell, QcSubNav, StatusBadge, TableCard } from "../../components/WebLayout";
import type { QcPerson } from "../../qcTypes";

const fieldStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: "8px", border: "1.5px solid #e5e7eb",
  fontSize: "13px", color: "#1a2a4a", outline: "none", boxSizing: "border-box", fontFamily: "inherit",
};
const labelStyle: React.CSSProperties = { fontSize: "11px", fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "4px" };

const ROLE_BADGE: Record<string, { color: string; bg: string }> = {
  INSPECTOR: { color: "#16a34a", bg: "#dcfce7" },
  FIELD_USER: { color: "#7c3aed", bg: "#f5f3ff" },
};

export function AdminQcUsers() {
  const [users, setUsers] = useState<QcPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  function reload() {
    api.qc.getAssignableUsers().then(setUsers).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }
  useEffect(reload, []);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || password.length < 8) return;
    setBusy(true);
    setCreateErr(null);
    try {
      await api.qc.createFieldUser({ name: name.trim(), email: email.trim(), password });
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
    <PageShell title="QC Field Users" subtitle="Everyone who can be assigned a QC defect — existing inspectors, plus dedicated field-worker accounts.">
      <QcSubNav />
      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 14 }}>{error}</p>}

      <div style={{ marginBottom: 20 }}>
        <TableCard headers={["Name", "Email", "Role"]}>
          {users?.map((u, i) => {
            const rc = ROLE_BADGE[u.role ?? ""] ?? { color: "#64748b", bg: "#f1f5f9" };
            return (
              <tr key={u.id} style={{ borderBottom: users.length - 1 > i ? "1px solid #f1f5f9" : "none" }}>
                <td style={{ padding: "14px 16px", fontSize: 13, fontWeight: 600, color: "#1a2a4a" }}>{u.name ?? "—"}</td>
                <td style={{ padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Mail size={12} color="#9ca3af" />
                    <span style={{ fontSize: 12, color: "#374151" }}>{u.email}</span>
                  </div>
                </td>
                <td style={{ padding: "14px 16px" }}>
                  <StatusBadge label={u.role ?? "—"} color={rc.color} bg={rc.bg} />
                </td>
              </tr>
            );
          })}
          {users && users.length === 0 && (
            <tr><td colSpan={3} style={{ textAlign: "center", padding: 24, fontSize: 13, color: "#94a3b8" }}>No assignable users yet.</td></tr>
          )}
        </TableCard>
      </div>

      <Card style={{ padding: "18px 22px", maxWidth: 480 }}>
        <h3 style={{ marginTop: 0, marginBottom: 2, fontSize: 15, color: "#1a2a4a" }}>Create a field-worker account</h3>
        <p style={{ marginTop: 0, marginBottom: 14, fontSize: 12, color: "#94a3b8" }}>
          No invite email yet — share the password below with them directly; they'll sign into the mobile app with it.
        </p>
        {createErr && <p style={{ fontSize: 12, color: "#dc2626" }}>{createErr}</p>}
        {created && (
          <p style={{ fontSize: 12, color: "#16a34a", background: "#f0fdf4", padding: "8px 12px", borderRadius: 8 }}>
            Account created for <strong>{created.email}</strong>. Temp password: <strong>{created.password}</strong>
          </p>
        )}
        <form onSubmit={createUser} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={labelStyle}>Name</label>
            <input style={fieldStyle} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Email</label>
            <input style={fieldStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Temporary password (min 8 characters)</label>
            <input style={fieldStyle} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button
            type="submit"
            disabled={busy || !name.trim() || !email.trim() || password.length < 8}
            style={{
              padding: "9px 16px", borderRadius: "8px", border: "none",
              background: busy ? "#94a3b8" : "#1a2a4a", color: "white",
              fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer", alignSelf: "flex-start",
            }}
          >
            {busy ? "Creating…" : "Create account"}
          </button>
        </form>
      </Card>
    </PageShell>
  );
}
