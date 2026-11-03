import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Mail, Lock, ShieldCheck } from "lucide-react";
import { useAppData } from "../../data";
import { api, type UserLink } from "../../api";
import { PageShell, PrimaryBtn, StatusBadge, TableCard } from "../../components/WebLayout";
import { ErrorNote, Field, Modal, Select, btnGhost, btnLink, btnPrimary, sub } from "../../components/QcUi";
import { inputStyle } from "../../components/SpecForm";
import { dialog as popup } from "../../components/dialogs";
import type { Role, User } from "../../mockData";

const ROLE_CONFIG: Record<Role, { color: string; bg: string; label: string; blurb: string }> = {
  inspector: { color: "#16a34a", bg: "#dcfce7", label: "Inspector", blurb: "Does inspections in the phone app." },
  reviewer: { color: "#2563eb", bg: "#eff6ff", label: "Reviewer", blurb: "Reviews and approves submitted inspections in this portal." },
  admin: { color: "#7c3aed", bg: "#f5f3ff", label: "Admin", blurb: "Full access, including adding people and the QC platform." },
};
const ROLES: Role[] = ["inspector", "reviewer", "admin"];
type Status = NonNullable<User["status"]>;
const STATUS_CONFIG: Record<Status, { label: string; color: string; bg: string }> = {
  active: { label: "Active", color: "#065f46", bg: "#d1fae5" },
  invited: { label: "Invited", color: "#92400e", bg: "#fef3c7" },
  deactivated: { label: "Switched off", color: "#991b1b", bg: "#fee2e2" },
};

const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : null);
const statusOf = (u: User): Status => u.status ?? "active";

export function AdminUsers() {
  const { users, currentUser, reloadUsers, patchUser } = useAppData();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "all">("all");
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [roleFor, setRoleFor] = useState<User | null>(null);
  const [offFor, setOffFor] = useState<User | null>(null);
  const [link, setLink] = useState<{ title: string; kind: "invitation" | "reset"; link: UserLink } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Always start from the server's list: people may have activated or been changed since this page was last open.
  useEffect(() => { void reloadUsers().catch(() => undefined); }, [reloadUsers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) && (roleFilter === "all" || u.role === roleFilter) && (statusFilter === "all" || statusOf(u) === statusFilter));
  }, [users, search, roleFilter, statusFilter]);

  const counts = { invited: users.filter((u) => statusOf(u) === "invited").length, off: users.filter((u) => statusOf(u) === "deactivated").length };
  const reviewers = users.filter((u) => u.role === "reviewer" && statusOf(u) === "active");

  /** Run an action, then refresh the list; a refusal from the server is shown in plain words. */
  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
      await reloadUsers();
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      void popup.alert(msg, "That did not work");
    }
  }

  const resend = (u: User) => run(async () => {
    const { invitation } = await api.users.resendInvitation(u.id);
    setLink({ title: `New invitation for ${u.name}`, kind: "invitation", link: invitation });
  });
  const reset = (u: User) => run(async () => {
    if (!(await popup.confirm(`Send ${u.name} a link to choose a new password? Their current password keeps working until they use it.`, { title: "Send reset link", okLabel: "Send link" }))) return;
    const { reset: r } = await api.users.sendReset(u.id);
    setLink({ title: `Password reset for ${u.name}`, kind: "reset", link: r });
  });
  const switchOn = (u: User) => run(async () => {
    const r = await api.users.reactivate(u.id);
    if (r.needsInvitation) await popup.alert(`${u.name} is switched on, but they never activated their account. Use "Resend invitation" to send them a new link.`, "One more step");
  });
  const cancelInvite = (u: User) => run(async () => {
    if (!(await popup.confirm(`Cancel the invitation and delete ${u.name}'s account? It has never been used, so nothing else is lost.`, { title: "Cancel invitation", okLabel: "Delete account", danger: true }))) return;
    await api.users.cancelInvitation(u.id);
  });

  return (
    <PageShell
      title="User Management"
      subtitle={`${users.length} people${counts.invited ? ` · ${counts.invited} invited` : ""}${counts.off ? ` · ${counts.off} switched off` : ""}`}
      actions={<PrimaryBtn color="#1a2a4a" onClick={() => setAdding(true)}><Plus size={14} /> Add user</PrimaryBtn>}
    >
      <ErrorNote message={error} />
      <p style={{ ...sub, margin: "0 0 14px", maxWidth: 760, lineHeight: 1.5 }}>
        New people get a one-time link to choose their own password; nobody, including administrators, ever sees a password. Inspectors then sign in on the phone app, reviewers and administrators sign in here. People who also have a QC role are managed on the QC People page.
      </p>

      <div style={{ display: "flex", gap: 10, marginBottom: 20, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 220, maxWidth: 320 }}>
          <Search size={14} color="#9ca3af" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email..." aria-label="Search people"
            style={{ width: "100%", padding: "8px 12px 8px 36px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, color: "#1a2a4a", outline: "none", boxSizing: "border-box", background: "white" }}
          />
        </div>
        {(["all", ...ROLES] as const).map((r) => (
          <button
            key={r} onClick={() => setRoleFilter(r)}
            style={{ padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", border: roleFilter === r ? "none" : "1px solid #e5e7eb", background: roleFilter === r ? "#1a2a4a" : "white", color: roleFilter === r ? "white" : "#374151" }}
          >
            {r === "all" ? "All" : ROLE_CONFIG[r].label}
          </button>
        ))}
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as Status | "all")} aria-label="Filter by status" style={{ ...inputStyle, width: "auto", padding: "7px 10px", fontSize: 12 }}>
          <option value="all">Any status</option>
          <option value="active">Active</option>
          <option value="invited">Invited</option>
          <option value="deactivated">Switched off</option>
        </select>
      </div>

      <TableCard headers={["Person", "Role", "Status", "Last sign-in", "Two-step", "Licence", "Actions"]}>
        {filtered.map((u, i) => {
          const rc = ROLE_CONFIG[u.role];
          const st = statusOf(u);
          const sc = STATUS_CONFIG[st];
          const me = u.id === currentUser?.id;
          const managedElsewhere = !!u.qcManaged;
          return (
            <tr key={u.id} style={{ borderBottom: i < filtered.length - 1 ? "1px solid #f1f5f9" : "none", opacity: st === "deactivated" ? 0.7 : 1 }}>
              <td style={{ padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 34, height: 34, borderRadius: "50%", background: rc.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: rc.color, flexShrink: 0 }}>{u.avatar}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2a4a" }}>{u.name}{me && <span style={{ ...sub, marginLeft: 6 }}>(you)</span>}</div>
                    <div style={{ fontSize: 12, color: "#64748b", display: "flex", alignItems: "center", gap: 5, overflowWrap: "anywhere" }}><Mail size={11} color="#9ca3af" />{u.email}</div>
                    {(u.phone || u.region) && <div style={sub}>{[u.phone, u.region].filter(Boolean).join(" · ")}</div>}
                  </div>
                </div>
              </td>
              <td style={{ padding: "14px 16px" }}><StatusBadge label={rc.label} color={rc.color} bg={rc.bg} /></td>
              <td style={{ padding: "14px 16px" }}>
                <StatusBadge label={sc.label} color={sc.color} bg={sc.bg} />
                {st === "invited" && u.invitationExpired && <div style={{ ...sub, color: "#b45309" }}>Link expired</div>}
                {st === "deactivated" && u.deactivatedAt && <div style={sub} title={u.deactivationReason ?? undefined}>{day(u.deactivatedAt)}{u.deactivationReason ? ` · ${u.deactivationReason}` : ""}</div>}
                {managedElsewhere && <div style={{ ...sub, color: "#6d28d9" }}>Managed in QC → People</div>}
              </td>
              <td style={{ padding: "14px 16px", fontSize: 12, color: "#374151" }}>{day(u.lastSignInAt) ?? <span style={sub}>Never</span>}</td>
              <td style={{ padding: "14px 16px", fontSize: 12 }}>
                {u.twoStep ? <span style={{ color: "#15803d", display: "inline-flex", alignItems: "center", gap: 4 }}><ShieldCheck size={13} /> On</span> : <span style={{ color: "#94a3b8", display: "inline-flex", alignItems: "center", gap: 4 }}><Lock size={12} /> Off</span>}
              </td>
              <td style={{ padding: "14px 16px", fontSize: 12, color: "#374151" }}>{u.licenseNumber ?? <span style={sub}>—</span>}</td>
              <td style={{ padding: "14px 16px" }}>
                <div style={{ display: "flex", gap: "4px 12px", flexWrap: "wrap", maxWidth: 280 }}>
                  <button style={btnLink} onClick={() => setEditing(u)}>Edit</button>
                  {!managedElsewhere && !me && st !== "deactivated" && <button style={btnLink} onClick={() => setRoleFor(u)}>Change role</button>}
                  {!managedElsewhere && st === "invited" && <button style={btnLink} onClick={() => resend(u)}>Resend invitation</button>}
                  {!managedElsewhere && st === "active" && <button style={btnLink} onClick={() => reset(u)}>Send reset link</button>}
                  {!managedElsewhere && st === "invited" && <button style={{ ...btnLink, color: "#dc2626" }} onClick={() => cancelInvite(u)}>Cancel invitation</button>}
                  {!managedElsewhere && !me && st !== "deactivated" && <button style={{ ...btnLink, color: "#dc2626" }} onClick={() => setOffFor(u)}>Switch off</button>}
                  {!managedElsewhere && st === "deactivated" && <button style={btnLink} onClick={() => switchOn(u)}>Switch on</button>}
                </div>
              </td>
            </tr>
          );
        })}
        {filtered.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", padding: 28, fontSize: 13, color: "#94a3b8" }}>No one matches.</td></tr>}
      </TableCard>

      {adding && <AddUserDialog onClose={() => setAdding(false)} onCreated={async (r) => { setAdding(false); await reloadUsers(); setLink({ title: `${r.user.name} was added`, kind: "invitation", link: r.invitation }); }} />}
      {editing && <EditUserDialog user={editing} onClose={() => setEditing(null)} onSave={async (patch) => { await patchUser(editing.id, patch); setEditing(null); }} />}
      {roleFor && (
        <RoleDialog user={roleFor} reviewers={reviewers.filter((r) => r.id !== roleFor.id)} onClose={() => setRoleFor(null)}
          onSave={async (role, reassignTo) => { const r = await api.users.setRole(roleFor.id, role, reassignTo); setRoleFor(null); await reloadUsers(); if (r.handedBack) void popup.alert(`${r.handedBack} open review(s) were ${reassignTo ? "handed to the other reviewer" : "returned to the unassigned queue"}.`, "Reviews moved"); }} />
      )}
      {offFor && (
        <SwitchOffDialog user={offFor} reviewers={reviewers.filter((r) => r.id !== offFor.id)} onClose={() => setOffFor(null)}
          onSave={async (reason, reassignTo) => { const r = await api.users.deactivate(offFor.id, { reason, reassignToId: reassignTo }); setOffFor(null); await reloadUsers(); if (r.handedBack) void popup.alert(`${r.handedBack} open review(s) were ${reassignTo ? "handed to the other reviewer" : "returned to the unassigned queue"}.`, "Reviews moved"); }} />
      )}
      {link && <LinkDialog {...link} onClose={() => setLink(null)} />}
    </PageShell>
  );
}

// ─── dialogs ────────────────────────────────────────────────────────────────

function useSubmit(onSubmit: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try { await onSubmit(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return { busy, error, submit };
}

function Footer({ onClose, busy, label, onSubmit, danger }: { onClose: () => void; busy: boolean; label: string; onSubmit: () => void; danger?: boolean }) {
  return (
    <>
      <button style={btnGhost} onClick={onClose}>Cancel</button>
      <button style={{ ...btnPrimary, ...(danger ? { background: "#dc2626" } : {}), opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={onSubmit}>{busy ? "Working…" : label}</button>
    </>
  );
}

function AddUserDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (r: { user: User; invitation: UserLink }) => Promise<void> }) {
  const [f, setF] = useState({ name: "", email: "", role: "inspector" as Role, phone: "", region: "", licenseNumber: "" });
  const set = (patch: Partial<typeof f>) => setF((v) => ({ ...v, ...patch }));
  const ready = f.name.trim().length > 0 && /^\S+@\S+\.\S+$/.test(f.email.trim());
  const { busy, error, submit } = useSubmit(async () => {
    if (f.role === "admin" && !(await popup.confirm("Administrators can see every inspection, add and switch off people, and use the whole QC platform. Add this person as an administrator?", { title: "Add an administrator", okLabel: "Add administrator" }))) return;
    await onCreated(await api.users.create({ name: f.name.trim(), email: f.email.trim(), role: f.role, phone: f.phone.trim() || undefined, region: f.region.trim() || undefined, licenseNumber: f.licenseNumber.trim() || undefined }));
  });
  return (
    <Modal title="Add user" onClose={onClose} width={480} footer={<Footer onClose={onClose} busy={busy} label="Add and invite" onSubmit={() => ready && submit()} />}>
      <ErrorNote message={error} />
      <div style={{ display: "grid", gap: 12 }}>
        <Field label="Full name" required><input id="um-name" style={inputStyle} value={f.name} onChange={(e) => set({ name: e.target.value })} autoFocus /></Field>
        <Field label="Email address" required><input id="um-email" type="email" style={inputStyle} value={f.email} onChange={(e) => set({ email: e.target.value })} /></Field>
        <Field label="Role" required>
          <select id="um-role" style={inputStyle} value={f.role} onChange={(e) => set({ role: e.target.value as Role })}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_CONFIG[r].label}</option>)}
          </select>
          <p style={{ ...sub, margin: "4px 0 0" }}>{ROLE_CONFIG[f.role].blurb}</p>
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Phone"><input id="um-phone" style={inputStyle} value={f.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
          <Field label="Region"><input id="um-region" style={inputStyle} value={f.region} onChange={(e) => set({ region: e.target.value })} /></Field>
        </div>
        <Field label="Licence / DBU registration number"><input id="um-licence" style={inputStyle} value={f.licenseNumber} onChange={(e) => set({ licenseNumber: e.target.value })} placeholder="e.g. DBU-12345" /></Field>
        <p style={{ ...sub, margin: 0, lineHeight: 1.5 }}>They receive a one-time link to choose their own password. If email is not set up on the server, the link is shown to you after you save so you can pass it on.</p>
      </div>
    </Modal>
  );
}

function EditUserDialog({ user, onClose, onSave }: { user: User; onClose: () => void; onSave: (p: { name: string; phone: string | null; region: string | null; licenseNumber: string | null }) => Promise<void> }) {
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [region, setRegion] = useState(user.region ?? "");
  const [licence, setLicence] = useState(user.licenseNumber ?? "");
  const { busy, error, submit } = useSubmit(() => onSave({ name: name.trim(), phone: phone.trim() || null, region: region.trim() || null, licenseNumber: licence.trim() || null }));
  return (
    <Modal title={`Edit ${user.name}`} onClose={onClose} width={420} footer={<Footer onClose={onClose} busy={busy} label="Save" onSubmit={() => name.trim() && submit()} />}>
      <ErrorNote message={error} />
      <div style={{ display: "grid", gap: 12 }}>
        <Field label="Name"><input id="eu-name" style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Phone"><input id="eu-phone" style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Region"><input id="eu-region" style={inputStyle} value={region} onChange={(e) => setRegion(e.target.value)} /></Field>
        <Field label="Licence / DBU registration number"><input id="eu-licence" style={inputStyle} value={licence} onChange={(e) => setLicence(e.target.value)} placeholder="e.g. DBU-12345" /></Field>
        <p style={{ ...sub, margin: 0 }}>The email address cannot be changed here. To use a different address, add a new user.</p>
      </div>
    </Modal>
  );
}

const UNASSIGNED = "__queue__";

function HandOver({ reviewers, value, onChange }: { reviewers: User[]; value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Their open reviews">
      <Select value={value} onChange={onChange} placeholder="Return them to the unassigned queue" options={[{ id: UNASSIGNED, label: "Return them to the unassigned queue" }, ...reviewers.map((r) => ({ id: r.id, label: `Hand to ${r.name}` }))]} />
      <p style={{ ...sub, margin: "4px 0 0" }}>Inspections they are reviewing now. Finished reviews keep their name on record.</p>
    </Field>
  );
}

function RoleDialog({ user, reviewers, onClose, onSave }: { user: User; reviewers: User[]; onClose: () => void; onSave: (role: Role, reassignTo: string | null) => Promise<void> }) {
  const [role, setRole] = useState<Role>(user.role);
  const [hand, setHand] = useState(UNASSIGNED);
  const leavingReviewer = user.role === "reviewer" && role !== "reviewer";
  const { busy, error, submit } = useSubmit(async () => {
    if (role === "admin" && !(await popup.confirm(`Make ${user.name} an administrator? They will be able to see every inspection, add and switch off people, and use the whole QC platform.`, { title: "Make administrator", okLabel: "Make administrator" }))) return;
    await onSave(role, leavingReviewer && hand !== UNASSIGNED ? hand : null);
  });
  return (
    <Modal title={`Change role: ${user.name}`} onClose={onClose} width={440} footer={<Footer onClose={onClose} busy={busy} label="Change role" onSubmit={() => role !== user.role && submit()} />}>
      <ErrorNote message={error} />
      <div style={{ display: "grid", gap: 12 }}>
        <Field label="Role">
          <select id="cr-role" style={inputStyle} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_CONFIG[r].label}{r === user.role ? " (current)" : ""}</option>)}
          </select>
          <p style={{ ...sub, margin: "4px 0 0" }}>{ROLE_CONFIG[role].blurb}</p>
        </Field>
        {leavingReviewer && <HandOver reviewers={reviewers} value={hand} onChange={setHand} />}
        <p style={{ ...sub, margin: 0 }}>The change applies on their next request. They stay signed in.</p>
      </div>
    </Modal>
  );
}

const OFF_REASONS = ["Left the company", "Contract ended", "Role change", "Security concern", "Other"];

function SwitchOffDialog({ user, reviewers, onClose, onSave }: { user: User; reviewers: User[]; onClose: () => void; onSave: (reason: string | undefined, reassignTo: string | null) => Promise<void> }) {
  const [pick, setPick] = useState("");
  const [other, setOther] = useState("");
  const [hand, setHand] = useState(UNASSIGNED);
  const reason = pick === "Other" ? other.trim() : pick;
  const { busy, error, submit } = useSubmit(() => onSave(reason || undefined, user.role === "reviewer" && hand !== UNASSIGNED ? hand : null));
  return (
    <Modal title={`Switch off ${user.name}`} onClose={onClose} width={460} footer={<Footer onClose={onClose} busy={busy} label="Switch off" danger onSubmit={submit} />}>
      <ErrorNote message={error} />
      <div style={{ display: "grid", gap: 12 }}>
        <p style={{ fontSize: 13, color: "#374151", margin: 0, lineHeight: 1.5 }}>{user.name} is signed out on every device straight away and cannot sign in again until you switch them back on. Their history stays. Anything still waiting to send on their phone stays on the phone.</p>
        {user.role === "reviewer" && <HandOver reviewers={reviewers} value={hand} onChange={setHand} />}
        <Field label="Reason (optional, kept in the audit log)">
          <select id="so-reason-pick" style={inputStyle} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">No reason given</option>
            {OFF_REASONS.map((r) => <option key={r}>{r}</option>)}
          </select>
          {pick === "Other" && <input id="so-reason" style={{ ...inputStyle, marginTop: 6 }} value={other} onChange={(e) => setOther(e.target.value)} placeholder="Say why" />}
        </Field>
      </div>
    </Modal>
  );
}

/** The link an administrator passes on when email could not carry it; otherwise a note that it was emailed. */
function LinkDialog({ title, kind, link, onClose }: { title: string; kind: "invitation" | "reset"; link: UserLink; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const what = kind === "invitation" ? "an activation link" : "a password reset link";
  return (
    <Modal title={title} onClose={onClose} width={520} footer={<button style={btnPrimary} onClick={onClose}>Done</button>}>
      {link.url ? (
        <>
          <p style={{ fontSize: 13, color: "#374151", marginTop: 0, lineHeight: 1.5 }}>
            {link.mail === "FAILED" ? "The email could not be sent" : "Email is not set up on this server, so nothing was sent"}. Give <b>{link.email}</b> this link yourself. It works once. They choose their own password, so you never see it.
          </p>
          <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, fontSize: 12, wordBreak: "break-all", color: "#1a2a4a" }}>{link.url}</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
            <button style={btnGhost} onClick={() => { navigator.clipboard?.writeText(link.url!).then(() => setCopied(true), () => undefined); }}>{copied ? "Copied" : "Copy link"}</button>
            {link.expiresAt && <span style={sub}>Expires {day(link.expiresAt)}.</span>}
          </div>
        </>
      ) : (
        <p style={{ fontSize: 13, color: "#374151", marginTop: 0, lineHeight: 1.5 }}>We emailed <b>{link.email}</b> {what}. It works once. For their security the link is not shown here.</p>
      )}
    </Modal>
  );
}
