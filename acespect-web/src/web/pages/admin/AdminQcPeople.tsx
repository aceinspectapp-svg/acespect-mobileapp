import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { api, type ApiError } from "../../api";
import { PageShell, PrimaryBtn, QcSubNav, TableCard } from "../../components/WebLayout";
import {
  InvitationDialog, type InvitationInfo, ErrorNote, Field, FormDialog, Modal, Select, btnGhost, btnLink, btnPrimary, cell, statusPill, sub, useRefData, type RefData,
} from "../../components/QcUi";
import { SpecForm, cleanPayload, inputStyle, useQcSpec, type RefOption } from "../../components/SpecForm";
import { findForm, type QcSpecPayload } from "../../qcSpec";
import type { QcMembershipRow, QcPersonRow } from "../../qcTypes";
import { useQc } from "../../qcContext";
import { qcx } from "../../qcApi";
import { RoleMatrix } from "../../components/RoleMatrix";

/** The capability needed to add or manage someone in each role (mirrors the server). */
const ROLE_CAP: Record<string, string> = {
  CLIENT_ADMIN: "users.clientUsers", CLIENT_USER: "users.clientUsers", MC_MANAGER: "users.mcOrg", MC_SITE_SUPERVISOR: "users.mcStaff",
  MC_PROJECT_MANAGER: "users.mcStaff", TRADE_USER: "users.trade", PRIVATE_INSPECTOR: "users.credentialInspector",
};

const ROLE_SHORT: Record<string, string> = {
  CLIENT_ADMIN: "Client Admin",
  CLIENT_USER: "Client User",
  MC_MANAGER: "MC Manager",
  MC_SITE_SUPERVISOR: "MC Site Supervisor",
  MC_PROJECT_MANAGER: "MC Project Manager",
  TRADE_USER: "Trade User",
  PRIVATE_INSPECTOR: "Private Inspector",
};

const checkRow: React.CSSProperties = { fontSize: 12, color: "#374151", display: "flex", gap: 5, alignItems: "center", cursor: "pointer" };

export function AdminQcPeople() {
  const { data, refOptions, reload: reloadRefs } = useRefData();
  const spec = useQcSpec();
  const [people, setPeople] = useState<QcPersonRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ clientId: "", role: "", q: "" });
  const [person, setPerson] = useState<{ row?: QcPersonRow } | null>(null);
  const [invite, setInvite] = useState<InvitationInfo | null>(null);
  const { can, me } = useQc();
  const mayAdd = Object.values(ROLE_CAP).some(can);
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [credentialsFor, setCredentialsFor] = useState<QcPersonRow | null>(null);
  const [deactivating, setDeactivating] = useState<QcPersonRow | null>(null);

  const load = useCallback(() => {
    api.qc.people.list(filters).then(setPeople).catch((e) => setError(e.message));
  }, [filters]);
  useEffect(() => { load(); }, [load]);

  async function reactivate(p: QcPersonRow) {
    try {
      await api.qc.people.reactivate(p.id);
      load();
    } catch (e) {
      window.alert((e as Error).message);
    }
  }

  const roleOptions: RefOption[] = (spec?.roles ?? []).map((r) => ({ id: r.code, label: r.label }));

  return (
    <PageShell
      title="People"
      subtitle={people ? `${people.length} account${people.length === 1 ? "" : "s"} with QC access` : "Loading…"}
      actions={<div style={{ display: "flex", gap: 8 }}><button style={btnGhost} onClick={() => setMatrixOpen(true)}>What can each role do?</button>{mayAdd && <PrimaryBtn onClick={() => setPerson({})}><Plus size={14} /> Add person</PrimaryBtn>}</div>}
    >
      <QcSubNav />
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        {me?.isSA && !me.clientId && <div style={{ width: 220 }}><Select value={filters.clientId} onChange={(v) => setFilters({ ...filters, clientId: v })} options={refOptions.E01 ?? []} placeholder="All clients" /></div>}
        <div style={{ width: 220 }}><Select value={filters.role} onChange={(v) => setFilters({ ...filters, role: v })} options={roleOptions} placeholder="All roles" /></div>
        <input style={{ ...inputStyle, width: 240 }} placeholder="Search name or email" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
      </div>
      <ErrorNote message={error} />
      <TableCard headers={["Person", "Roles", "Mobile", "Credentials", "Defects", "Status", ""]}>
        {people?.map((p, i) => (
          <tr key={p.id} style={{ borderBottom: people.length - 1 > i ? "1px solid #f1f5f9" : "none", opacity: p.isActive ? 1 : 0.55 }}>
            <td style={cell}><b>{p.name ?? "—"}</b><div style={sub}>{p.email}</div></td>
            <td style={cell}>
              {p.qcMemberships.length === 0 && <span style={sub}>Legacy account ({p.role.toLowerCase().replace("_", " ")})</span>}
              {p.qcMemberships.map((m) => (
                <div key={m.id} style={{ marginBottom: 3 }}>
                  <b style={{ fontSize: 12 }}>{ROLE_SHORT[m.role] ?? m.role}</b>
                  <span style={sub}> · {m.client.name}{m.masterContractor ? ` · ${m.masterContractor.name}` : ""}{m.tradeCompany ? ` · ${m.tradeCompany.name}` : ""}</span>
                </div>
              ))}
            </td>
            <td style={cell}>{p.phone ?? "—"}</td>
            <td style={cell}>
              {p.qcInspectorCredential ? (
                <button style={{ ...btnLink, display: "inline-flex" }} onClick={() => setCredentialsFor(p)}>{statusPill(p.qcInspectorCredential.status)}</button>
              ) : p.qcMemberships.some((m) => m.role === "PRIVATE_INSPECTOR") ? (
                <button style={btnLink} onClick={() => setCredentialsFor(p)}>Add</button>
              ) : "—"}
            </td>
            <td style={cell}>{p._count.assignedQcDefects}</td>
            <td style={cell}>{statusPill(p.isActive ? (p.lastSignInAt ? "Active" : "Invited") : "Deactivated")}{p.mfaEnabled && <div style={sub}>2-step on</div>}</td>
            <td style={{ ...cell, whiteSpace: "nowrap", textAlign: "right" }}>
              {(p.qcMemberships.length === 0 ? can("client.manage") : p.qcMemberships.some((m) => can(ROLE_CAP[m.role] ?? ""))) && <button style={btnLink} onClick={() => setPerson({ row: p })}>Edit</button>}{" "}
              {p.isActive && !p.lastSignInAt && <><button style={btnLink} onClick={() => qcx.people.resendInvitation(p.id).then((i) => setInvite(i)).catch((e) => window.alert(e.message))}>Resend invitation</button>{" "}</>}
              {can("users.deactivate") && p.qcMemberships.some((m) => can(ROLE_CAP[m.role] ?? "")) && (p.isActive ? (
                <button style={{ ...btnLink, color: "#dc2626" }} onClick={() => setDeactivating(p)}>Deactivate</button>
              ) : (
                <button style={btnLink} onClick={() => reactivate(p)}>Reactivate</button>
              ))}
            </td>
          </tr>
        ))}
        {people?.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", padding: 28, fontSize: 13, color: "#94a3b8" }}>No people match.</td></tr>}
      </TableCard>

      {person && data && spec && (
        <PersonDialog
          row={person.row}
          spec={spec}
          data={data}
          refOptions={refOptions}
          onClose={() => setPerson(null)}
          onSaved={(result) => {
            setPerson(null);
            if (result?.invitation) setInvite({ ...result.invitation, email: result.email });
            load();
            reloadRefs();
          }}
        />
      )}
      {invite && <InvitationDialog invitation={invite} onClose={() => setInvite(null)} />}
      {matrixOpen && <RoleMatrix onClose={() => setMatrixOpen(false)} />}
      {credentialsFor && (
        <CredentialsForm
          person={credentialsFor}
          refOptions={refOptions}
          onClose={() => setCredentialsFor(null)}
          onSaved={() => { setCredentialsFor(null); load(); }}
        />
      )}
      {deactivating && (
        <DeactivateDialog
          person={deactivating}
          candidates={(people ?? []).filter((p) => p.id !== deactivating.id && p.isActive && p.role !== "CLIENT").map((p) => ({ id: p.id, label: p.name ?? p.email }))}
          onClose={() => setDeactivating(null)}
          onDone={() => { setDeactivating(null); load(); }}
        />
      )}
    </PageShell>
  );
}

// ─── Add / edit a person (E04 + the membership that gives them a role, E05) ─────

function PersonDialog({ row, spec, data, refOptions, onClose, onSaved }: {
  row?: QcPersonRow;
  spec: QcSpecPayload;
  data: RefData;
  refOptions: Record<string, RefOption[]>;
  onClose: () => void;
  onSaved: (r?: { email: string; invitation?: InvitationInfo }) => void;
}) {
  const editing = !!row;
  const membership: QcMembershipRow | undefined = row?.qcMemberships.length === 1 ? row.qcMemberships[0] : undefined;
  const nameParts = (row?.name ?? "").split(" ");

  const [e04, setE04] = useState<Record<string, unknown>>(
    row
      ? { email_address: row.email, first_name: nameParts[0] ?? "", last_name: nameParts.slice(1).join(" "), mobile: row.phone ?? "", position_or_job_title: row.position ?? "", white_card_number: row.whiteCardNumber ?? "" }
      : { sign_in_method: "Password with MFA" },
  );
  const [e06, setE06] = useState<Record<string, unknown>>({});
  const [role, setRole] = useState(membership?.role ?? "");
  const [clientId, setClientId] = useState(membership?.client.id ?? "");
  const [mcId, setMcId] = useState(membership?.masterContractor?.id ?? "");
  const [tcId, setTcId] = useState(membership?.tradeCompany?.id ?? "");
  const [categoryIds, setCategoryIds] = useState<string[]>(membership?.tradeCategories.map((c) => c.id) ?? []);
  const [projectIds, setProjectIds] = useState<string[]>(membership?.projects.map((p) => p.id) ?? []);
  const [permissions, setPermissions] = useState<string[]>(membership?.optionalPermissions ?? []);
  const { can } = useQc();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const isPI = role === "PRIVATE_INSPECTOR";
  const isMC = role.startsWith("MC_");
  const permissionOptions = useMemo(() => findForm(spec, "E05").fields.find((f) => f.key === "optional_permissions")?.options ?? [], [spec]);
  const clientProjects = data.projects.filter((p) => p.clientId === clientId);
  const clientMcs = data.masterContractors.filter((m) => m.clientId === clientId);
  const toggle = (list: string[], set: (v: string[]) => void, id: string, on: boolean) => set(on ? [...list, id] : list.filter((x) => x !== id));

  async function submit() {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const base = cleanPayload(e04);
      const scope = { role, clientId, masterContractorId: mcId || undefined, tradeCompanyId: tcId || undefined, tradeCategoryIds: categoryIds, projectIds, optionalPermissions: permissions };
      if (editing) {
        await api.qc.people.update(row!.id, { ...base, ...(membership ? { membershipId: membership.id, ...scope } : {}) });
        onSaved();
      } else {
        const r = await api.qc.people.create({ ...base, ...scope, ...(isPI ? { credentials: cleanPayload(e06) } : {}) }) as unknown as { person: { email: string }; invitation?: InvitationInfo };
        onSaved({ email: r.person.email, invitation: r.invitation });
      }
    } catch (e) {
      const err = e as ApiError;
      setError(err.message);
      if (err.details) setFieldErrors(err.details);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={editing ? `Edit ${row!.name ?? row!.email}` : "Add person"}
      onClose={onClose}
      width={820}
      footer={
        <>
          <button style={btnGhost} onClick={onClose}>Cancel</button>
          <button style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={submit}>{saving ? "Saving…" : editing ? "Save" : "Create account"}</button>
        </>
      }
    >
      <ErrorNote message={error} />
      {editing && row!.qcMemberships.length > 1 && (
        <p style={{ ...sub, marginTop: 0 }}>This person has several memberships; role and scope are edited per client in a later pass. Personal details can be edited here.</p>
      )}
      {(!editing || membership) && (
        <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#1a2a4a", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>Role and organisation</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Role" required>
              <Select value={role} onChange={(v) => { setRole(v); setMcId(""); setTcId(""); }} options={spec.roles.filter((r) => can(ROLE_CAP[r.code] ?? "")).map((r) => ({ id: r.code, label: r.label }))} />
            </Field>
            {!isPI && (
              <Field label="Client (tenant)" required>
                <Select value={clientId} disabled={editing} onChange={(v) => { setClientId(v); setMcId(""); setProjectIds([]); }} options={refOptions.E01 ?? []} />
              </Field>
            )}
            {isMC && (
              <Field label="Master Contractor organisation" required>
                <Select value={mcId} onChange={setMcId} options={clientMcs.map((m) => ({ id: m.id, label: m.name }))} />
              </Field>
            )}
            {role === "TRADE_USER" && (
              <Field label="Trade company" required>
                <Select value={tcId} onChange={setTcId} options={refOptions.E03 ?? []} />
              </Field>
            )}
          </div>
          {role === "TRADE_USER" && (
            <div style={{ marginTop: 12 }}>
              <Field label="Trade categories" required>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px" }}>
                  {(refOptions.E19 ?? []).map((c) => (
                    <label key={c.id} style={checkRow}><input type="checkbox" checked={categoryIds.includes(c.id)} onChange={(e) => toggle(categoryIds, setCategoryIds, c.id, e.target.checked)} />{c.label}</label>
                  ))}
                </div>
              </Field>
            </div>
          )}
          {role === "CLIENT_USER" && (
            <div style={{ marginTop: 12 }}>
              <Field label="Optional permissions">
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px" }}>
                  {permissionOptions.map((p) => (
                    <label key={p} style={checkRow}><input type="checkbox" checked={permissions.includes(p)} onChange={(e) => toggle(permissions, setPermissions, p, e.target.checked)} />{p}</label>
                  ))}
                </div>
              </Field>
            </div>
          )}
          {!isPI && role && role !== "CLIENT_ADMIN" && clientProjects.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <Field label="Projects accessible">
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px" }}>
                  {clientProjects.map((p) => (
                    <label key={p.id} style={checkRow}><input type="checkbox" checked={projectIds.includes(p.id)} onChange={(e) => toggle(projectIds, setProjectIds, p.id, e.target.checked)} />{p.name}</label>
                  ))}
                </div>
                {projectIds.length === 0 && <p style={{ fontSize: 12, color: "#92400e", margin: "8px 0 0" }}>No projects chosen: this person will be able to see every project in the client. Choose the projects they work on to limit them.</p>}
              </Field>
            </div>
          )}
        </div>
      )}

      <div style={{ fontSize: 11, fontWeight: 700, color: "#1a2a4a", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>Personal details</div>
      <SpecForm form={findForm(spec, "E04")} value={e04} onChange={setE04} errors={fieldErrors} hide={editing ? ["sign_in_method", "mfa_method"] : []} />

      {!editing && <p style={{ ...sub, marginTop: 16 }}>No password is set here. The person gets an email with a one-time link to choose their own password and accept the terms.</p>}

      {isPI && !editing && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#1a2a4a", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>Inspector credentials</div>
          <SpecForm form={findForm(spec, "E06")} value={e06} onChange={setE06} errors={fieldErrors} refOptions={refOptions} hide={["user", "signature_image"]} />
        </div>
      )}
    </Modal>
  );
}

// ─── Private Inspector credentials (E06) ─────────────────────────────────────

function CredentialsForm({ person, refOptions, onClose, onSaved }: {
  person: QcPersonRow;
  refOptions: Record<string, RefOption[]>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = person.qcInspectorCredential;
  const [busy, setBusy] = useState(false);
  const setStatus = async (status: string) => {
    setBusy(true);
    try {
      await api.qc.people.setCredentialStatus(person.id, status);
      onSaved();
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormDialog
      title={`Inspector credentials: ${person.name ?? person.email}`}
      formCode="E06"
      initial={existing ? { ...existing.data, approved_for_clients: existing.approvedClients.map((c) => c.id) } : {}}
      hide={["user", "signature_image"]}
      refOptions={refOptions}
      submitLabel="Save credentials"
      note={
        existing && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <span style={sub}>Status</span> {statusPill(existing.status)}
            <button style={btnLink} disabled={busy} onClick={() => setStatus("APPROVED")}>Approve</button>
            <button style={{ ...btnLink, color: "#dc2626" }} disabled={busy} onClick={() => setStatus("SUSPENDED")}>Suspend</button>
          </div>
        )
      }
      onClose={onClose}
      onSubmit={async (payload) => {
        await api.qc.people.saveCredentials(person.id, payload);
        onSaved();
      }}
    />
  );
}

// ─── Deactivate and reassign open work (F05) ─────────────────────────────────

function DeactivateDialog({ person, candidates, onClose, onDone }: {
  person: QcPersonRow;
  candidates: RefOption[];
  onClose: () => void;
  onDone: () => void;
}) {
  const spec = useQcSpec();
  const [reason, setReason] = useState("");
  const [reassignTo, setReassignTo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Array<{ id: string; ref: string | null; title: string | null; status: string; lot: string }>>([]);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const r = await api.qc.people.deactivate(person.id, { reason, reassignToId: reassignTo || undefined });
      if (r.reassigned) window.alert(`${r.reassigned} open defect(s) were reassigned.`);
      onDone();
    } catch (e) {
      const err = e as ApiError;
      setError(err.message);
      const list = (err.details as { items?: typeof items } | undefined)?.items;
      if (list) setItems(list);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Deactivate ${person.name ?? person.email}`}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button style={btnGhost} onClick={onClose}>Cancel</button>
          <button style={{ ...btnPrimary, background: "#dc2626", opacity: !reason || saving ? 0.6 : 1 }} disabled={!reason || saving} onClick={submit}>Deactivate</button>
        </>
      }
    >
      <ErrorNote message={error} />
      {items.length > 0 && (
        <ul style={{ fontSize: 12, color: "#374151", margin: "0 0 12px", paddingLeft: 18 }}>
          {items.map((d) => <li key={d.id}>{d.ref ?? "Defect"}: {d.title ?? "untitled"} <span style={sub}>({d.status}, lot {d.lot})</span></li>)}
        </ul>
      )}
      <p style={{ fontSize: 13, color: "#374151", marginTop: 0 }}>They will be signed out and lose access. Open defects assigned to them must move to someone else.</p>
      <div style={{ display: "grid", gap: 12 }}>
        <Field label="Reason" required>
          <Select value={reason} onChange={setReason} options={(spec?.deactivationReasons ?? []).map((r) => ({ id: r, label: r }))} />
        </Field>
        <Field label="Reassign their open work to">
          <Select value={reassignTo} onChange={setReassignTo} options={candidates} placeholder="Nobody (only if they have no open work)" />
        </Field>
      </div>
    </Modal>
  );
}
