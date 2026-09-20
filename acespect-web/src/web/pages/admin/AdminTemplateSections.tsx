import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Pencil, Plus, FileText, Users } from "lucide-react";
import { PageShell, TableCard, StatusBadge } from "../../components/WebLayout";
import { TEMPLATE_STATUS_CONFIG, type TemplateSummaryRow } from "../../mockData";
import { TEMPLATABLE_SECTIONS, inspectionTitle, propertyTitle } from "../../constants/inspectionData";
import { api } from "../../api";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

/** Step 2: all 12 templatable sections for one profile (inspection type + property type). */
export function AdminTemplateSections() {
  const navigate = useNavigate();
  const { inspectionType, propertyType } = useParams<{ inspectionType: string; propertyType: string }>();
  const [summary, setSummary] = useState<TemplateSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    if (!inspectionType || !propertyType) return;
    api.getTemplateSummary(inspectionType, propertyType).then(setSummary).finally(() => setLoading(false));
  }, [inspectionType, propertyType]);

  if (!inspectionType || !propertyType) return null;

  const byKey = new Map(summary.map((s) => [s.sectionKey, s]));

  async function editSection(sectionKey: string, sectionName: string) {
    const row = byKey.get(sectionKey);
    if (!row) return;
    if (row.hasDraft && row.draftId) {
      navigate(`/admin/templates/${inspectionType}/${propertyType}/${sectionKey}/${row.draftId}`);
      return;
    }
    setBusyKey(sectionKey);
    try {
      if (row.publishedVersion) {
        // Clone the published fields into a new draft version.
        const versions = await api.getTemplates(inspectionType!, propertyType!, sectionKey);
        const published = versions.find((v) => v.status === "published");
        const created = await api.createTemplate({
          inspectionType: inspectionType!,
          propertyType: propertyType!,
          sectionKey,
          name: sectionName,
          fields: published?.fields ?? [],
        });
        navigate(`/admin/templates/${inspectionType}/${propertyType}/${sectionKey}/${created.id}`);
      } else {
        // No template at all yet for this lineage -- start blank.
        const created = await api.createTemplate({
          inspectionType: inspectionType!,
          propertyType: propertyType!,
          sectionKey,
          name: sectionName,
          fields: [],
        });
        navigate(`/admin/templates/${inspectionType}/${propertyType}/${sectionKey}/${created.id}`);
      }
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <PageShell
      title={`${inspectionTitle(inspectionType)} — ${propertyTitle(propertyType)}`}
      subtitle="Every section's template for this profile"
      actions={
        <>
          <button
            onClick={() => navigate(`/admin/templates/${inspectionType}/${propertyType}/adoption`)}
            style={{
              height: "32px", padding: "0 12px", borderRadius: "8px", background: "white",
              border: "1px solid #e5e7eb", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
              color: "#374151", fontSize: "12px", fontWeight: 600,
            }}
          >
            <Users size={14} /> View Adoption
          </button>
          <button
            onClick={() => navigate("/admin/templates")}
            style={{
              height: "32px", padding: "0 12px", borderRadius: "8px", background: "white",
              border: "1px solid #e5e7eb", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
              color: "#374151", fontSize: "12px", fontWeight: 600,
            }}
          >
            <ArrowLeft size={14} /> Change Profile
          </button>
        </>
      }
    >
      <TableCard headers={["Section", "Status", "Version", "Published", "Actions"]}>
        {loading ? (
          <tr>
            <td colSpan={5} style={{ padding: "32px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
              Loading…
            </td>
          </tr>
        ) : (
          TEMPLATABLE_SECTIONS.map(({ key, name }, idx) => {
            const row = byKey.get(key);
            const hasPublished = !!row?.publishedVersion;
            const sc = row?.hasDraft
              ? TEMPLATE_STATUS_CONFIG.draft
              : hasPublished
                ? TEMPLATE_STATUS_CONFIG.published
                : { label: "None", color: "#94a3b8", bg: "#f8fafc" };
            return (
              <tr key={key} style={{ borderBottom: idx < TEMPLATABLE_SECTIONS.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                <td style={{ padding: "13px 16px", fontSize: "13px", fontWeight: 700, color: "#1a2a4a", display: "flex", alignItems: "center", gap: "8px" }}>
                  <FileText size={13} color="#94a3b8" /> {name}
                </td>
                <td style={{ padding: "13px 16px" }}>
                  <StatusBadge label={sc.label} color={sc.color} bg={sc.bg} />
                </td>
                <td style={{ padding: "13px 16px", fontSize: "13px", color: "#374151" }}>
                  {hasPublished ? `v${row!.publishedVersion}` : "—"}
                </td>
                <td style={{ padding: "13px 16px", fontSize: "13px", color: "#374151" }}>
                  {formatDate(row?.publishedAt ?? null)}
                </td>
                <td style={{ padding: "13px 16px" }}>
                  <button
                    onClick={() => editSection(key, name)}
                    disabled={busyKey === key}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: "5px",
                      padding: "5px 11px", borderRadius: "7px",
                      background: "#1a2a4a", color: "white", border: "none",
                      fontSize: "11px", fontWeight: 600, cursor: busyKey === key ? "not-allowed" : "pointer",
                      opacity: busyKey === key ? 0.6 : 1,
                    }}
                  >
                    {row?.hasDraft ? <Pencil size={12} /> : hasPublished ? <Pencil size={12} /> : <Plus size={12} />}
                    {row?.hasDraft ? "Continue Draft" : hasPublished ? "Edit" : "Create Template"}
                  </button>
                </td>
              </tr>
            );
          })
        )}
      </TableCard>
    </PageShell>
  );
}
