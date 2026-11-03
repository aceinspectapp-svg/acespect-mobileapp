import { useState } from "react";
import { PageShell } from "../../components/WebLayout";
import { req } from "../../api";

type NewRole = "INSPECTOR" | "REVIEWER";

const field: React.CSSProperties = { width: "100%", padding: "9px 11px", borderRadius: "8px", border: "1.5px solid #e5e7eb", fontSize: "13px", color: "#1a2a4a", outline: "none", boxSizing: "border-box", fontFamily: "inherit", background: "white" };
const label: React.CSSProperties = { fontSize: "11px", fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "4px" };
const ghost: React.CSSProperties = { padding: "0 12px", borderRadius: "8px", border: "1px solid #e5e7eb", background: "white", fontSize: "12px", fontWeight: 600, color: "#374151", cursor: "pointer", whiteSpace: "nowrap" };

/** A readable random password that meets the 12-character rule (no look-alike characters). */
function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("") + "!7";
}

/** The Admin creates an inspector or reviewer account, with everything the person needs to sign in. */
export function AdminCreateUser() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [role, setRole] = useState<NewRole>("INSPECTOR");
  const [phone, setPhone] = useState("");
  const [region, setRegion] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; email: string; password: string; role: NewRole } | null>(null);

  function reset() {
    setName(""); setEmail(""); setPassword(""); setShow(false); setRole("INSPECTOR"); setPhone(""); setRegion(""); setLicenseNumber(""); setError(null); setCreated(null);
  }

  async function save() {
    if (!name.trim()) return setError("Name is required");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter a valid email address");
    if (password.length < 12) return setError("The password must be at least 12 characters");
    setSaving(true); setError(null);
    try {
      await req("/admin/users", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(), email: email.trim(), password, role,
          ...(phone.trim() ? { phone: phone.trim() } : {}), ...(region.trim() ? { region: region.trim() } : {}), ...(licenseNumber.trim() ? { licenseNumber: licenseNumber.trim() } : {}),
        }),
      });
      setCreated({ name: name.trim(), email: email.trim().toLowerCase(), password, role });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the user");
    } finally { setSaving(false); }
  }

  return (
    <PageShell title="Create user" subtitle="Create an inspector or reviewer account with their sign-in details">
      <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "24px", maxWidth: "520px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
        {created ? (
          <div style={{ fontSize: "13px", color: "#374151" }}>
            <p style={{ marginTop: 0, fontWeight: 600, color: "#1a2a4a" }}>
              {created.name} was created as {created.role === "REVIEWER" ? "a reviewer" : "an inspector"}.
            </p>
            <p>Give these sign-in details to the person. The password is not shown again.</p>
            <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "10px 12px", fontFamily: "monospace", fontSize: "12px", userSelect: "all" }}>
              Email: {created.email}<br />Password: {created.password}
            </div>
            <button onClick={reset} style={{ marginTop: "16px", padding: "9px 16px", borderRadius: "8px", border: "none", background: "#1a2a4a", fontSize: "12px", fontWeight: 600, color: "white", cursor: "pointer" }}>Create another user</button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div>
              <label style={label}>Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value as NewRole)} style={field}>
                <option value="INSPECTOR">Inspector</option>
                <option value="REVIEWER">Reviewer</option>
              </select>
            </div>
            <div><label style={label}>Full name</label><input value={name} onChange={(e) => setName(e.target.value)} style={field} /></div>
            <div><label style={label}>Email (used to sign in)</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={field} autoComplete="off" /></div>
            <div>
              <label style={label}>Password (at least 12 characters)</label>
              <div style={{ display: "flex", gap: "6px" }}>
                <input type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} style={field} autoComplete="new-password" />
                <button type="button" onClick={() => { setPassword(generatePassword()); setShow(true); }} style={ghost}>Generate</button>
                <button type="button" onClick={() => setShow(!show)} style={ghost}>{show ? "Hide" : "Show"}</button>
              </div>
            </div>
            <div><label style={label}>Phone (optional)</label><input value={phone} onChange={(e) => setPhone(e.target.value)} style={field} /></div>
            <div><label style={label}>Region (optional)</label><input value={region} onChange={(e) => setRegion(e.target.value)} style={field} /></div>
            <div><label style={label}>License / DBU registration number (optional)</label><input value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} style={field} placeholder="e.g. DBU-12345" /></div>
            {error && <p style={{ fontSize: "12px", color: "#dc2626", margin: 0 }}>{error}</p>}
            <div>
              <button onClick={save} disabled={saving} style={{ padding: "9px 18px", borderRadius: "8px", border: "none", background: saving ? "#94a3b8" : "#1a2a4a", fontSize: "13px", fontWeight: 600, color: "white", cursor: saving ? "default" : "pointer" }}>{saving ? "Creating…" : "Create user"}</button>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}
