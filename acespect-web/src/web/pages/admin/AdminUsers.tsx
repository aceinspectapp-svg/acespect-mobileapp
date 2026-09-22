import { useState } from "react";
import { Plus, Search, Mail, Phone, X } from "lucide-react";
import { useAppData } from "../../data";
import { PageShell, PrimaryBtn, StatusBadge, TableCard } from "../../components/WebLayout";
import type { Role, User } from "../../mockData";

const ROLE_CONFIG: Record<Role, { color: string; bg: string }> = {
  inspector: { color: "#16a34a", bg: "#dcfce7" },
  reviewer:  { color: "#2563eb", bg: "#eff6ff" },
  admin:     { color: "#7c3aed", bg: "#f5f3ff" },
};

export function AdminUsers() {
  const { users: USERS, patchUser } = useAppData();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Role | "all">("all");
  const [editingUser, setEditingUser] = useState<User | null>(null);

  const filtered = USERS.filter(u => {
    const matchSearch = u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase());
    const matchRole = filter === "all" || u.role === filter;
    return matchSearch && matchRole;
  });

  return (
    <PageShell
      title="User Management"
      subtitle={`${USERS.length} users across all roles`}
      actions={<PrimaryBtn color="#1a2a4a"><Plus size={14} /> Add User</PrimaryBtn>}
    >
      {/* Filters */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "20px", alignItems: "center" }}>
        {/* Search input with icon inside */}
        <div style={{ position: "relative", flex: "1", maxWidth: "320px" }}>
          <Search size={14} color="#9ca3af" style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            style={{
              width: "100%",
              padding: "8px 12px 8px 36px",
              borderRadius: "8px",
              border: "1px solid #e5e7eb",
              fontSize: "13px",
              color: "#1a2a4a",
              outline: "none",
              boxSizing: "border-box",
              transition: "border-color 0.12s, box-shadow 0.12s",
              background: "white",
            }}
            onFocus={e => {
              e.currentTarget.style.borderColor = "#2563eb";
              e.currentTarget.style.boxShadow = "0 0 0 3px rgba(37,99,235,0.1)";
            }}
            onBlur={e => {
              e.currentTarget.style.borderColor = "#e5e7eb";
              e.currentTarget.style.boxShadow = "none";
            }}
          />
        </div>

        {/* Filter pill tabs */}
        {(["all", "inspector", "reviewer", "admin"] as const).map(r => (
          <button
            key={r}
            onClick={() => setFilter(r)}
            style={{
              padding: "7px 14px",
              borderRadius: "8px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              border: filter === r ? "none" : "1px solid #e5e7eb",
              background: filter === r ? "#1a2a4a" : "white",
              color: filter === r ? "white" : "#374151",
              transition: "all 0.12s",
            }}
            onMouseEnter={e => {
              if (filter !== r) e.currentTarget.style.background = "#f8fafc";
            }}
            onMouseLeave={e => {
              if (filter !== r) e.currentTarget.style.background = "white";
            }}
          >
            {r === "all" ? "All" : r.charAt(0).toUpperCase() + r.slice(1)}
          </button>
        ))}
      </div>

      {/* Table */}
      <TableCard headers={["User", "Role", "Email", "Phone", "Region", "License", "Actions"]}>
        {filtered.map((user, i) => {
          const rc = ROLE_CONFIG[user.role];
          return (
            <tr
              key={user.id}
              style={{ borderBottom: i < filtered.length - 1 ? "1px solid #f1f5f9" : "none", transition: "background 0.1s" }}
              onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              {/* User cell with colored avatar */}
              <td style={{ padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={{
                    width: "34px",
                    height: "34px",
                    borderRadius: "50%",
                    background: rc.bg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "12px",
                    fontWeight: 700,
                    color: rc.color,
                    flexShrink: 0,
                    border: `1.5px solid ${rc.color}22`,
                  }}>
                    {user.avatar}
                  </div>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "#1a2a4a" }}>{user.name}</span>
                </div>
              </td>

              {/* Role badge */}
              <td style={{ padding: "14px 16px" }}>
                <StatusBadge
                  label={user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                  color={rc.color}
                  bg={rc.bg}
                />
              </td>

              {/* Email */}
              <td style={{ padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <Mail size={12} color="#9ca3af" />
                  <span style={{ fontSize: "12px", color: "#374151" }}>{user.email}</span>
                </div>
              </td>

              {/* Phone */}
              <td style={{ padding: "14px 16px" }}>
                {user.phone ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <Phone size={12} color="#9ca3af" />
                    <span style={{ fontSize: "12px", color: "#374151" }}>{user.phone}</span>
                  </div>
                ) : (
                  <span style={{ fontSize: "12px", color: "#d1d5db" }}>—</span>
                )}
              </td>

              {/* Region */}
              <td style={{ padding: "14px 16px" }}>
                <span style={{ fontSize: "12px", color: "#374151" }}>{user.region ?? "—"}</span>
              </td>

              {/* License -- inspector's DBU/registration number, shown next to their name/role. */}
              <td style={{ padding: "14px 16px" }}>
                <span style={{ fontSize: "12px", color: user.licenseNumber ? "#374151" : "#d1d5db" }}>
                  {user.licenseNumber ?? "—"}
                </span>
              </td>

              {/* Actions */}
              <td style={{ padding: "14px 16px" }}>
                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    onClick={() => setEditingUser(user)}
                    style={{
                      padding: "5px 10px",
                      borderRadius: "6px",
                      border: "1px solid #e5e7eb",
                      background: "white",
                      fontSize: "11px",
                      fontWeight: 600,
                      cursor: "pointer",
                      color: "#374151",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                    onMouseLeave={e => (e.currentTarget.style.background = "white")}
                  >
                    Edit
                  </button>
                  <button
                    style={{
                      padding: "5px 10px",
                      borderRadius: "6px",
                      border: "1px solid #fecaca",
                      background: "#fff5f5",
                      fontSize: "11px",
                      fontWeight: 600,
                      cursor: "pointer",
                      color: "#dc2626",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#fee2e2")}
                    onMouseLeave={e => (e.currentTarget.style.background = "#fff5f5")}
                  >
                    Remove
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </TableCard>

      {editingUser && (
        <EditUserModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSave={async (patch) => {
            await patchUser(editingUser.id, patch);
            setEditingUser(null);
          }}
        />
      )}
    </PageShell>
  );
}

/** Name / phone / region / license -- the fields already shown in this table. */
function EditUserModal({
  user,
  onClose,
  onSave,
}: {
  user: User;
  onClose: () => void;
  onSave: (patch: { name: string; phone: string | null; region: string | null; licenseNumber: string | null }) => Promise<void>;
}) {
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [region, setRegion] = useState(user.region ?? "");
  const [licenseNumber, setLicenseNumber] = useState(user.licenseNumber ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fieldStyle: React.CSSProperties = {
    width: "100%", padding: "8px 10px", borderRadius: "8px", border: "1.5px solid #e5e7eb",
    fontSize: "13px", color: "#1a2a4a", outline: "none", boxSizing: "border-box", fontFamily: "inherit",
  };

  async function handleSave() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        phone: phone.trim() || null,
        region: region.trim() || null,
        licenseNumber: licenseNumber.trim() || null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "white", borderRadius: "14px", width: "360px", maxWidth: "calc(100vw - 32px)", boxShadow: "0 20px 50px rgba(0,0,0,0.25)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #f1f5f9" }}>
          <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#1a2a4a", margin: 0 }}>Edit {user.name}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", padding: "4px" }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div>
            <label style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "4px" }}>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} style={fieldStyle} />
          </div>
          <div>
            <label style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "4px" }}>Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} style={fieldStyle} />
          </div>
          <div>
            <label style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "4px" }}>Region</label>
            <input value={region} onChange={(e) => setRegion(e.target.value)} style={fieldStyle} />
          </div>
          <div>
            <label style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "4px" }}>
              License / DBU registration number
            </label>
            <input value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} style={fieldStyle} placeholder="e.g. DBU-12345" />
          </div>
          {error && <p style={{ fontSize: "12px", color: "#dc2626", margin: 0 }}>{error}</p>}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", padding: "14px 20px", borderTop: "1px solid #f1f5f9" }}>
          <button
            onClick={onClose}
            style={{ padding: "8px 14px", borderRadius: "8px", border: "1px solid #e5e7eb", background: "white", fontSize: "12px", fontWeight: 600, color: "#374151", cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ padding: "8px 14px", borderRadius: "8px", border: "none", background: saving ? "#94a3b8" : "#1a2a4a", fontSize: "12px", fontWeight: 600, color: "white", cursor: saving ? "default" : "pointer" }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
