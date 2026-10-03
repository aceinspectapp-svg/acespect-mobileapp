import { useEffect, useState } from "react";
import { Modal, btnPrimary, cell, sub, ErrorNote } from "./QcUi";
import { qcx } from "../qcApi";

const LABEL: Record<string, string> = {
  "client.manage": "Create and manage clients", "client.defaults": "Set client defaults and see usage", "support.enter": "Enter a client in support mode",
  "securitylog.view": "See the security log and support sessions", "retention.hold": "Place and release legal holds", "tenant.export": "Export the client's data", "privacy.handle": "Handle privacy requests and breaches",
  "users.clientUsers": "Add Client Admins and Client Users", "users.mcOrg": "Add Master Contractor organisations and managers", "users.mcStaff": "Add Master Contractor staff",
  "users.trade": "Add trade companies and Trade Users", "users.credentialInspector": "Credential Private Inspectors", "users.deactivate": "Deactivate people", "users.grantPermissions": "Grant optional permissions",
  "users.view": "See people and organisations", "projects.create": "Create and edit projects", "projects.team": "Assign the project team", "projects.override": "Delete projects and override defaults",
  "projects.holdPoints": "Set hold points", "projects.status": "Move a project through its statuses", "projects.docs.upload": "Upload project documents", "projects.docs.view": "See project documents",
  "projects.view": "See projects", "templates.maintainBase": "Maintain the base checklist templates", "templates.customise": "Customise checklist templates", "templates.assign": "Assign templates to project stages",
  "templates.view": "See checklist templates", "inspections.plan": "Plan and assign inspections", "inspections.request": "Request a stage inspection", "inspections.progress": "See inspection progress",
  "inspections.adhoc": "Create an ad-hoc inspection", "inspections.perform": "Carry out inspections", "inspections.reports": "Generate and download reports", "defects.view": "See defects",
  "defects.comment": "Comment on defects", "defects.create": "Log defects", "sla.configure": "Set service-level targets and escalation", "sla.escalate": "Escalate manually", "dlp.manage": "Start the DLP and sign it off",
  "dlp.reminders": "Receive DLP reminders", "reports.dashboard": "See the dashboard", "reports.openItems": "Produce the Open Items Register", "reports.dlpEscalation": "Produce DLP and escalation reports",
  "reports.portfolio": "See the portfolio", "evidence.export": "Export an evidence pack", "audit.view": "See the audit trail", "account.self": "Manage their own account",
};
const ROLES: Array<[string, string]> = [["SA", "Super Admin"], ["CLIENT_ADMIN", "Client Admin"], ["CLIENT_USER", "Client User"], ["MC_MANAGER", "MC Manager"], ["MC_SITE_SUPERVISOR", "Site Supervisor"], ["MC_PROJECT_MANAGER", "Project Manager"], ["TRADE_USER", "Trade User"], ["PRIVATE_INSPECTOR", "Inspector"]];

/** The read-only "what can each role do" screen (REQ-USR-007). Lifecycle steps on a defect are decided per status and role on the server. */
export function RoleMatrix({ onClose }: { onClose: () => void }) {
  const [m, setM] = useState<Awaited<ReturnType<typeof qcx.permissions>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { qcx.permissions().then(setM).catch((e) => setError(e.message)); }, []);
  return (
    <Modal title="What each role can do" onClose={onClose} width={1000} footer={<button style={btnPrimary} onClick={onClose}>Close</button>}>
      <ErrorNote message={error} />
      <p style={{ ...sub, marginTop: 0 }}>✓ means yes, ◐ means within their own organisation, projects or assigned items, and "permission" means a Client User needs the matching optional permission. Steps in a defect's lifecycle (release, allocate, verify and the rest) follow the defect's status and the person's role.</p>
      {m && (
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <thead><tr style={{ background: "#f8fafc" }}><th style={{ ...cell, textAlign: "left", fontSize: 11 }}>Capability</th>{ROLES.map(([k, l]) => <th key={k} style={{ ...cell, fontSize: 11 }}>{l}</th>)}</tr></thead>
          <tbody>
            {m.matrix.filter((r) => r.capability !== "account.self").map((r) => (
              <tr key={r.capability} style={{ borderTop: "1px solid #f1f5f9" }}>
                <td style={{ ...cell, fontSize: 12 }}>{LABEL[r.capability] ?? r.capability}</td>
                {ROLES.map(([k]) => {
                  const g = String(r.roles[k] ?? "none");
                  return <td key={k} style={{ ...cell, textAlign: "center", fontSize: 11 }} title={g}>{g === "full" ? "✓" : g === "scoped" ? "◐" : g === "none" ? "·" : "permission"}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
