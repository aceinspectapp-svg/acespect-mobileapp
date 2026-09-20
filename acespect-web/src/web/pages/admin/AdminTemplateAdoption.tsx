import { Fragment, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Check, X } from "lucide-react";
import { PageShell, TableCard, StatusBadge } from "../../components/WebLayout";
import { inspectionTitle, propertyTitle } from "../../constants/inspectionData";
import { api, TemplateAdoptionRow } from "../../api";

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-AU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const STATUS_CONFIG: Record<TemplateAdoptionRow["status"], { label: string; color: string; bg: string }> = {
  UP_TO_DATE: { label: "Using New Version", color: "#16a34a", bg: "#f0fdf4" },
  UPDATE_AVAILABLE: { label: "Update Available", color: "#d97706", bg: "#fffbeb" },
  NOT_STARTED: { label: "Not Started", color: "#94a3b8", bg: "#f8fafc" },
};

/** One inspector's currently-in-use version, for the summary column — the highest version they're actually on across sections they've touched, or "—" if they've never opened this profile. */
function currentVersionLabel(row: TemplateAdoptionRow): string {
  const touched = row.sections.filter((s) => s.currentVersion !== null);
  if (touched.length === 0) return "—";
  const versions = [...new Set(touched.map((s) => s.currentVersion))];
  return versions.length === 1 ? `v${versions[0]}` : "mixed";
}

/**
 * Admin view of who's received/accepted the latest published template for
 * one profile, per user's spec: Notification / Accepted / Current Version /
 * Status per inspector. Templates version per-section under the hood (see
 * templates.service.ts `getAdoption`) — this bundles that up to one row per
 * inspector per profile, matching how inspectors accept updates (a whole
 * profile at once), with the per-section breakdown available on expand.
 */
export function AdminTemplateAdoption() {
  const navigate = useNavigate();
  const { inspectionType, propertyType } = useParams<{ inspectionType: string; propertyType: string }>();
  const [rows, setRows] = useState<TemplateAdoptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!inspectionType || !propertyType) return;
    api.getTemplateAdoption(inspectionType, propertyType).then(setRows).finally(() => setLoading(false));
  }, [inspectionType, propertyType]);

  if (!inspectionType || !propertyType) return null;

  return (
    <PageShell
      title={`${inspectionTitle(inspectionType)} — ${propertyTitle(propertyType)}`}
      subtitle="Template adoption — who's on the latest published version"
      actions={
        <button
          onClick={() => navigate(`/admin/templates/${inspectionType}/${propertyType}`)}
          style={{
            height: "32px", padding: "0 12px", borderRadius: "8px", background: "white",
            border: "1px solid #e5e7eb", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
            color: "#374151", fontSize: "12px", fontWeight: 600,
          }}
        >
          <ArrowLeft size={14} /> Back to Sections
        </button>
      }
    >
      <TableCard headers={["Inspector", "Notification", "Accepted", "Current Version", "Status"]}>
        {loading ? (
          <tr>
            <td colSpan={5} style={{ padding: "32px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
              Loading…
            </td>
          </tr>
        ) : rows.length === 0 ? (
          <tr>
            <td colSpan={5} style={{ padding: "32px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
              No active inspectors.
            </td>
          </tr>
        ) : (
          rows.map((row, idx) => {
            const sc = STATUS_CONFIG[row.status];
            const isExpanded = expanded === row.inspectorId;
            return (
              <Fragment key={row.inspectorId}>
                <tr
                  onClick={() => setExpanded(isExpanded ? null : row.inspectorId)}
                  style={{ borderBottom: idx < rows.length - 1 || isExpanded ? "1px solid #f1f5f9" : "none", cursor: "pointer" }}
                >
                  <td style={{ padding: "13px 16px", fontSize: "13px", fontWeight: 700, color: "#1a2a4a" }}>
                    {row.name ?? row.email}
                  </td>
                  <td style={{ padding: "13px 16px" }}>
                    {row.notifiedAt ? <Check size={15} color="#16a34a" /> : <X size={15} color="#cbd5e1" />}
                  </td>
                  <td style={{ padding: "13px 16px" }}>
                    {row.acceptedAt ? <Check size={15} color="#16a34a" /> : <X size={15} color="#cbd5e1" />}
                  </td>
                  <td style={{ padding: "13px 16px", fontSize: "13px", color: "#374151" }}>
                    {currentVersionLabel(row)}
                  </td>
                  <td style={{ padding: "13px 16px" }}>
                    <StatusBadge label={sc.label} color={sc.color} bg={sc.bg} />
                  </td>
                </tr>
                {isExpanded && (
                  <tr style={{ borderBottom: idx < rows.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                    <td colSpan={5} style={{ padding: "0 16px 16px", background: "#fafbfc" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "8px", paddingTop: "8px" }}>
                        {row.sections.map((s) => (
                          <div key={s.sectionKey} style={{ fontSize: "12px", color: "#64748b", display: "flex", justifyContent: "space-between", gap: "8px" }}>
                            <span>{s.sectionKey}</span>
                            <span style={{ fontWeight: 600, color: s.upToDate ? "#16a34a" : s.currentVersion === null ? "#94a3b8" : "#d97706" }}>
                              {s.currentVersion === null ? "not used" : `v${s.currentVersion}${s.upToDate ? "" : ` → v${s.latestVersion}`}`}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: "24px", marginTop: "12px", fontSize: "12px", color: "#94a3b8" }}>
                        <span>Notified: {formatDateTime(row.notifiedAt)}</span>
                        <span>Accepted: {formatDateTime(row.acceptedAt)}</span>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })
        )}
      </TableCard>
    </PageShell>
  );
}
