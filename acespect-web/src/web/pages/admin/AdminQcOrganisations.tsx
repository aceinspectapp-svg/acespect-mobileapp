import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useNavigate } from "react-router";
import { api } from "../../api";
import { qcx } from "../../qcApi";
import { useQc } from "../../qcContext";
import { PageShell, PrimaryBtn, QcSubNav, TableCard } from "../../components/WebLayout";
import {
  InvitationDialog, type InvitationInfo, ErrorNote, Field, FormDialog, Select, btnDanger, btnLink, cell, statusPill, sub, showValue, useRefData,
} from "../../components/QcUi";
import type { QcClientRow, QcMasterContractorRow, QcTradeCategory, QcTradeCompanyRow } from "../../qcTypes";

type Tab = "clients" | "mcs" | "trades" | "categories";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "clients", label: "Clients" },
  { id: "mcs", label: "Master contractors" },
  { id: "trades", label: "Trade companies" },
  { id: "categories", label: "Trade categories" },
];

export const fmtAbn = (abn: unknown) => (typeof abn === "string" && abn.length === 11 ? abn.replace(/(\d{2})(\d{3})(\d{3})(\d{3})/, "$1 $2 $3 $4") : showValue(abn));

export function AdminQcOrganisations() {
  const { can, me } = useQc();
  const tabs = TABS.filter((t) => (t.id === "clients" ? can("client.manage") : t.id === "categories" ? true : can("users.view") && (!me?.isSA || !!me?.clientId)));
  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? "categories");
  return (
    <PageShell title="Organisations" subtitle="Clients, builders, trade companies and trade categories">
      <QcSubNav />
      <div style={{ display: "flex", gap: 6, marginBottom: 16, borderBottom: "1px solid #e5e7eb" }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", background: "none", border: "none",
              color: tab === t.id ? "#1a2a4a" : "#94a3b8", borderBottom: tab === t.id ? "2px solid #1a2a4a" : "2px solid transparent", marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "clients" && <Clients />}
      {tab === "mcs" && <MasterContractors />}
      {tab === "trades" && <TradeCompanies />}
      {tab === "categories" && <TradeCategories />}
    </PageShell>
  );
}

function Empty({ cols, text }: { cols: number; text: string }) {
  return <tr><td colSpan={cols} style={{ textAlign: "center", padding: 28, fontSize: 13, color: "#94a3b8" }}>{text}</td></tr>;
}

// ─── Clients (E01) ───────────────────────────────────────────────────────────

function Clients() {
  const [rows, setRows] = useState<QcClientRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ row?: QcClientRow } | null>(null);
  const [invite, setInvite] = useState<InvitationInfo | null>(null);
  const [offboarding, setOffboarding] = useState<QcClientRow | null>(null);
  const { enterSupport } = useQc();
  const navigate = useNavigate();
  const [abnClash, setAbnClash] = useState(false);

  const reload = () => api.qc.clients.list().then(setRows).catch((e) => setError(e.message));
  useEffect(() => { reload(); }, []);

  async function setStatus(row: QcClientRow, status: string) {
    let reason: string | undefined;
    if (status === "SUSPENDED") {
      reason = window.prompt("Reason for suspending this client (required):") ?? undefined;
      if (!reason?.trim()) return;
    } else if (!window.confirm(`${status === "OFFBOARDED" ? "Offboard" : "Reactivate"} ${row.name}?`)) return;
    try {
      await api.qc.clients.setStatus(row.id, status, reason);
      reload();
    } catch (e) {
      window.alert((e as Error).message);
    }
  }
  async function remove(row: QcClientRow) {
    if (!window.confirm(`Delete ${row.name}? This can't be undone.`)) return;
    try {
      await api.qc.clients.remove(row.id);
      reload();
    } catch (e) {
      window.alert((e as Error).message);
    }
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <PrimaryBtn onClick={() => setDialog({})}><Plus size={14} /> New client</PrimaryBtn>
      </div>
      <ErrorNote message={error} />
      <TableCard headers={["Code", "Client", "ABN", "Type", "Primary contact", "Projects", "Status", ""]}>
        {rows?.map((c, i) => (
          <tr key={c.id} style={{ borderBottom: rows.length - 1 > i ? "1px solid #f1f5f9" : "none" }}>
            <td style={{ ...cell, fontFamily: "monospace", fontSize: 12 }}>{c.clientCode}</td>
            <td style={cell}><b>{c.name}</b><div style={sub}>{showValue(c.data.trading_name)}</div></td>
            <td style={cell}>{fmtAbn(c.data.abn)}</td>
            <td style={cell}>{showValue(c.data.client_type)}</td>
            <td style={cell}>{showValue(c.data.primary_contact_name)}<div style={sub}>{showValue(c.data.primary_contact_email)}</div></td>
            <td style={cell}>{c._count.projects}</td>
            <td style={cell}>{statusPill(c.status)}</td>
            <td style={{ ...cell, whiteSpace: "nowrap", textAlign: "right" }}>
              <button style={btnLink} onClick={() => setDialog({ row: c })}>Edit</button>{" "}
              {c.status !== "OFFBOARDED" && <button style={btnLink} onClick={() => { const reason = window.prompt(`Enter ${c.name} in support mode. Why?`); if (reason && reason.trim().length >= 5) enterSupport(c.id, reason.trim()).then(() => navigate("/qc")).catch((e) => window.alert(e.message)); }}>Enter support mode</button>}{" "}
              {c.status === "SUSPENDED" ? (
                <button style={btnLink} onClick={() => setStatus(c, "ACTIVE")}>Reactivate</button>
              ) : c.status !== "OFFBOARDED" ? (
                <button style={btnLink} onClick={() => setStatus(c, "SUSPENDED")}>Suspend</button>
              ) : null}{" "}
              {c.status !== "OFFBOARDED" && <button style={btnLink} onClick={() => setOffboarding(c)}>Offboard…</button>}{" "}
              <button style={btnDanger} onClick={() => remove(c)}>Delete</button>
            </td>
          </tr>
        ))}
        {rows?.length === 0 && <Empty cols={8} text="No clients yet." />}
      </TableCard>

      {dialog && (
        <FormDialog
          title={dialog.row ? `Edit ${dialog.row.name}` : "New client"}
          formCode="E01"
          initial={dialog.row?.data ?? { mfa_required_for_all_roles: false, idle_session_timeout: 30 }}
          extra={!dialog.row ? (v, set) => (v.abnOverrideReason !== undefined || abnClash) ? <Field label="This ABN is already registered. Why is it being used again?" required><input style={{ width: "100%", padding: 8, border: "1px solid #e5e7eb", borderRadius: 8 }} value={String(v.abnOverrideReason ?? "")} onChange={(e) => set({ abnOverrideReason: e.target.value })} /></Field> : null : undefined}
          hide={dialog.row ? ["first_client_admin_name_and_email"] : []}
          note={!dialog.row && <p style={{ ...sub, marginTop: 0 }}>Creating a client also invites its first Client Admin. Type their details in the last field as <b>Jane Smith, jane@example.com</b>; they get an activation link and the client becomes Active when they use it.</p>}
          onClose={() => { setDialog(null); setAbnClash(false); }}
          onSubmit={async (payload) => {
            if (dialog.row) {
              await api.qc.clients.update(dialog.row.id, payload);
            } else {
              const r = await api.qc.clients.create(payload).catch((e) => { if ((e as { code?: string }).code === "ABN_TAKEN") setAbnClash(true); throw e; }) as unknown as { firstAdmin: { email: string }; invitation?: InvitationInfo };
              if (r.invitation) setInvite({ ...r.invitation, email: r.firstAdmin.email });
            }
            setDialog(null);
            reload();
          }}
        />
      )}
      {invite && <InvitationDialog invitation={invite} onClose={() => setInvite(null)} />}
      {offboarding && (
        <FormDialog
          title={`Offboard ${offboarding.name}`}
          formCode="F42"
          hide={["destruction_record"]}
          initial={{ request_type: "Offboard tenant", grace_period: 90, export_contents: ["Data (CSV, JSON)", "Audit trail"] }}
          note={<p style={{ ...sub, marginTop: 0 }}>Everyone in this client is signed out now and cannot sign in. Their data is kept for the grace period so they can export it, then it can be destroyed unless a legal hold applies.</p>}
          onClose={() => setOffboarding(null)}
          onSubmit={async (payload) => { await qcx.settings.offboard(offboarding.id, payload); setOffboarding(null); reload(); }}
        />
      )}
    </>
  );
}

// ─── Master contractors (E02) ────────────────────────────────────────────────

function MasterContractors() {
  const { can } = useQc();
  const { data, refOptions } = useRefData();
  const [rows, setRows] = useState<QcMasterContractorRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ row?: QcMasterContractorRow } | null>(null);

  const reload = () => api.qc.masterContractors.list().then(setRows).catch((e) => setError(e.message));
  useEffect(() => { reload(); }, []);

  async function remove(row: QcMasterContractorRow) {
    if (!window.confirm(`Delete ${row.name}?`)) return;
    try {
      await api.qc.masterContractors.remove(row.id);
      reload();
    } catch (e) {
      window.alert((e as Error).message);
    }
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        {can("users.mcOrg") && <PrimaryBtn onClick={() => setDialog({})}><Plus size={14} /> New master contractor</PrimaryBtn>}
      </div>
      <ErrorNote message={error} />
      <TableCard headers={["Builder", "Client", "ABN", "Licence", "Insurance", "Contact", "Status", ""]}>
        {rows?.map((m, i) => (
          <tr key={m.id} style={{ borderBottom: rows.length - 1 > i ? "1px solid #f1f5f9" : "none" }}>
            <td style={cell}><b>{m.name}</b><div style={sub}>{showValue(m.data.trading_name)}</div></td>
            <td style={cell}>{m.client.name}</td>
            <td style={cell}>{fmtAbn(m.abn)}</td>
            <td style={cell}>{showValue(m.data.registration_or_licence_number)}<div style={sub}>expires {showValue(m.data.registration_or_licence_expiry)}</div></td>
            <td style={cell} title={m.insuranceStatus}>{statusPill(m.insuranceStatus === "Current" ? "Active" : m.insuranceStatus)}</td>
            <td style={cell}>{showValue(m.data.primary_contact_name)}<div style={sub}>{showValue(m.data.primary_contact_phone)}</div></td>
            <td style={cell}>{statusPill(m.status)}</td>
            <td style={{ ...cell, whiteSpace: "nowrap", textAlign: "right" }}>
              {can("users.mcOrg") && <><button style={btnLink} onClick={() => setDialog({ row: m })}>Edit</button>{" "}
              <button style={btnDanger} onClick={() => remove(m)}>Delete</button></>}
            </td>
          </tr>
        ))}
        {rows?.length === 0 && <Empty cols={8} text="No master contractors yet." />}
      </TableCard>
      {dialog && data && (
        <FormDialog
          title={dialog.row ? `Edit ${dialog.row.name}` : "New master contractor"}
          formCode="E02"
          initial={dialog.row ? { ...dialog.row.data, clientId: dialog.row.clientId, status: dialog.row.status } : {}}
          refOptions={refOptions}
          extra={(value, set) => (
            <Field label="Client (tenant)" required>
              <Select
                value={String(value.clientId ?? "")}
                disabled={!!dialog.row}
                onChange={(v) => set({ clientId: v })}
                options={refOptions.E01 ?? []}
              />
            </Field>
          )}
          onClose={() => setDialog(null)}
          onSubmit={async (payload) => {
            if (dialog.row) await api.qc.masterContractors.update(dialog.row.id, payload);
            else await api.qc.masterContractors.create(payload);
            setDialog(null);
            reload();
          }}
        />
      )}
    </>
  );
}

// ─── Trade companies (E03) ───────────────────────────────────────────────────

function TradeCompanies() {
  const { can } = useQc();
  const { data, refOptions } = useRefData();
  const [rows, setRows] = useState<QcTradeCompanyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ row?: QcTradeCompanyRow } | null>(null);

  const reload = () => api.qc.tradeCompanies.list().then(setRows).catch((e) => setError(e.message));
  useEffect(() => { reload(); }, []);

  async function remove(row: QcTradeCompanyRow) {
    if (!window.confirm(`Delete ${row.name}?`)) return;
    try {
      await api.qc.tradeCompanies.remove(row.id);
      reload();
    } catch (e) {
      window.alert((e as Error).message);
    }
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        {can("users.trade") && <PrimaryBtn onClick={() => setDialog({})}><Plus size={14} /> New trade company</PrimaryBtn>}
      </div>
      <ErrorNote message={error} />
      <TableCard headers={["Company", "ABN", "Trade categories", "Engaged by", "Contact", "Status", ""]}>
        {rows?.map((t, i) => (
          <tr key={t.id} style={{ borderBottom: rows.length - 1 > i ? "1px solid #f1f5f9" : "none" }}>
            <td style={cell}><b>{t.name}</b><div style={sub}>{showValue(t.data.trading_name)}</div></td>
            <td style={cell}>{fmtAbn(t.abn)}</td>
            <td style={cell}>{t.categories.map((c) => c.name).join(", ") || "—"}</td>
            <td style={cell}>{t.masterContractors.map((m) => m.name).join(", ") || "—"}</td>
            <td style={cell}>{showValue(t.data.primary_contact_name)}<div style={sub}>{showValue(t.data.primary_contact_mobile)}</div></td>
            <td style={cell}>{statusPill(t.status)}</td>
            <td style={{ ...cell, whiteSpace: "nowrap", textAlign: "right" }}>
              {can("users.trade") && <><button style={btnLink} onClick={() => setDialog({ row: t })}>Edit</button>{" "}
              <button style={btnDanger} onClick={() => remove(t)}>Delete</button></>}
            </td>
          </tr>
        ))}
        {rows?.length === 0 && <Empty cols={7} text="No trade companies yet." />}
      </TableCard>
      {dialog && data && (
        <FormDialog
          title={dialog.row ? `Edit ${dialog.row.name}` : "New trade company"}
          formCode="E03"
          initial={
            dialog.row
              ? { ...dialog.row.data, trade_categories: dialog.row.categories.map((c) => c.id), engaged_by: dialog.row.masterContractors.map((m) => m.id), status: dialog.row.status }
              : {}
          }
          refOptions={refOptions}
          onClose={() => setDialog(null)}
          onSubmit={async (payload) => {
            if (dialog.row) await api.qc.tradeCompanies.update(dialog.row.id, payload);
            else await api.qc.tradeCompanies.create(payload);
            setDialog(null);
            reload();
          }}
        />
      )}
    </>
  );
}

// ─── Trade categories (E19) ──────────────────────────────────────────────────

function TradeCategories() {
  const { can } = useQc();
  const [rows, setRows] = useState<QcTradeCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ row?: QcTradeCategory } | null>(null);

  const reload = () => api.qc.tradeCategories.list().then(setRows).catch((e) => setError(e.message));
  useEffect(() => { reload(); }, []);

  async function remove(row: QcTradeCategory) {
    if (!window.confirm(`Remove ${row.name}? Categories already in use are retired instead of deleted.`)) return;
    try {
      const r = await api.qc.tradeCategories.remove(row.id);
      if (r.retired) window.alert(`${row.name} is in use, so it was retired instead.`);
      reload();
    } catch (e) {
      window.alert((e as Error).message);
    }
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        {can("client.manage") && <PrimaryBtn onClick={() => setDialog({})}><Plus size={14} /> New trade category</PrimaryBtn>}
      </div>
      <ErrorNote message={error} />
      <TableCard headers={["Category", "Code", "Licence required", "Licensing authority", "Active", ""]}>
        {rows?.map((c, i) => (
          <tr key={c.id} style={{ borderBottom: rows.length - 1 > i ? "1px solid #f1f5f9" : "none", opacity: c.active ? 1 : 0.55 }}>
            <td style={cell}><b>{c.name}</b></td>
            <td style={{ ...cell, fontFamily: "monospace", fontSize: 12 }}>{c.code}</td>
            <td style={cell}>{c.licenceRequired ? "Yes" : "No"}</td>
            <td style={cell}>{c.licenceHint ?? "—"}</td>
            <td style={cell}>{statusPill(c.active ? "Active" : "Inactive")}</td>
            <td style={{ ...cell, whiteSpace: "nowrap", textAlign: "right" }}>
              {can("client.manage") && <><button style={btnLink} onClick={() => setDialog({ row: c })}>Edit</button>{" "}
              <button style={btnDanger} onClick={() => remove(c)}>Remove</button></>}
            </td>
          </tr>
        ))}
      </TableCard>
      {dialog && (
        <FormDialog
          title={dialog.row ? `Edit ${dialog.row.name}` : "New trade category"}
          formCode="E19"
          width={560}
          initial={
            dialog.row
              ? { category_name: dialog.row.name, code: dialog.row.code, licence_required: dialog.row.licenceRequired, licensing_authority_hint: dialog.row.licenceHint ?? "", active: dialog.row.active }
              : { licence_required: false, active: true }
          }
          onClose={() => setDialog(null)}
          onSubmit={async (payload) => {
            if (dialog.row) await api.qc.tradeCategories.update(dialog.row.id, payload);
            else await api.qc.tradeCategories.create(payload);
            setDialog(null);
            reload();
          }}
        />
      )}
    </>
  );
}
