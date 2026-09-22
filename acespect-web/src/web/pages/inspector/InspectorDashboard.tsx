import { useState } from "react";
import { useNavigate } from "react-router";
import { Plus, Pencil, MessageSquare, Eye, X } from "lucide-react";
import { STATUS_CONFIG } from "../../mockData";
import type { InspectionStatus } from "../../mockData";
import { useAppData } from "../../data";
import { PageShell, StatusBadge, TableCard, PrimaryBtn } from "../../components/WebLayout";
import { INSPECTION_TYPES, PROPERTY_TYPES, TEMPLATABLE_SECTIONS, isValidCombo } from "../../constants/inspectionData";

type TabFilter = "all" | InspectionStatus;

const TABS: { key: TabFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "submitted", label: "Submitted" },
  { key: "in-review", label: "In Review" },
  { key: "approved", label: "Approved" },
];

export function InspectorDashboard() {
  const navigate = useNavigate();
  const { currentUser, getInspectionsByInspector } = useAppData();
  const [activeTab, setActiveTab] = useState<TabFilter>("all");
  const [showNewModal, setShowNewModal] = useState(false);

  const allInspections = currentUser ? getInspectionsByInspector(currentUser.id) : [];
  const filtered =
    activeTab === "all"
      ? allInspections
      : allInspections.filter((i) => i.status === activeTab);

  return (
    <>
    <PageShell
      title="My Inspections"
      subtitle="James Thompson — Inspector"
      actions={
        <PrimaryBtn color="#e63329" onClick={() => setShowNewModal(true)}>
          <Plus size={15} strokeWidth={2.5} />
          New Inspection
        </PrimaryBtn>
      }
    >
      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: "6px",
          marginBottom: "20px",
          flexWrap: "wrap",
        }}
      >
        {TABS.map((tab) => {
          const count =
            tab.key === "all"
              ? allInspections.length
              : allInspections.filter((i) => i.status === tab.key).length;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: "7px 16px",
                fontSize: "13px",
                fontWeight: isActive ? 700 : 500,
                color: isActive ? "#fff" : "#64748b",
                background: isActive ? "#1a2a4a" : "#fff",
                border: isActive ? "1px solid #1a2a4a" : "1px solid #e5e7eb",
                borderRadius: "20px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                transition: "all 0.15s",
              }}
            >
              {tab.label}
              {count > 0 && (
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    padding: "1px 7px",
                    borderRadius: "10px",
                    background: isActive ? "rgba(255,255,255,0.2)" : "#f1f5f9",
                    color: isActive ? "#fff" : "#94a3b8",
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState tab={activeTab} />
      ) : (
        <TableCard
          headers={["Job No.", "Address", "Client", "Date", "Type", "Progress", "Status", "Actions"]}
        >
          {filtered.map((ins, idx) => {
            const cfg = STATUS_CONFIG[ins.status];
            // Once submitted, the inspector's editing window is over -- only
            // a still-open draft can be edited from here.
            const canEdit = ins.status === "draft";
            return (
              <tr
                key={ins.id}
                onClick={() => navigate(`/inspector/form/${ins.id}`)}
                style={{
                  borderBottom:
                    idx < filtered.length - 1 ? "1px solid #f1f5f9" : "none",
                  cursor: "pointer",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#f8fafc")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                {/* Job No */}
                <td style={{ padding: "14px 16px", whiteSpace: "nowrap" }}>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      fontFamily: "monospace",
                      color: "#1a2a4a",
                      background: "#f1f5f9",
                      padding: "3px 7px",
                      borderRadius: "6px",
                    }}
                  >
                    {ins.jobNo}
                  </span>
                </td>

                {/* Address */}
                <td style={{ padding: "14px 16px" }}>
                  <div
                    style={{ fontSize: "13px", fontWeight: 600, color: "#1a2a4a" }}
                  >
                    {ins.address}
                  </div>
                  <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "2px" }}>
                    {ins.suburb}
                  </div>
                </td>

                {/* Client */}
                <td style={{ padding: "14px 16px" }}>
                  <span
                    style={{
                      fontSize: "13px",
                      color: "#374151",
                      maxWidth: "180px",
                      display: "block",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {ins.client}
                  </span>
                </td>

                {/* Date */}
                <td style={{ padding: "14px 16px", whiteSpace: "nowrap" }}>
                  <span style={{ fontSize: "13px", color: "#374151" }}>
                    {new Date(ins.date).toLocaleDateString("en-AU", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                </td>

                {/* Type */}
                <td style={{ padding: "14px 16px", whiteSpace: "nowrap" }}>
                  <span style={{ fontSize: "12px", color: "#64748b" }}>{ins.type}</span>
                </td>

                {/* Progress bar */}
                <td style={{ padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: "90px" }}>
                    <div
                      style={{
                        flex: 1,
                        height: "6px",
                        borderRadius: "3px",
                        background: "#f1f5f9",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${ins.overallProgress}%`,
                          borderRadius: "3px",
                          background:
                            ins.overallProgress === 100
                              ? "#16a34a"
                              : "linear-gradient(90deg, #2563eb, #1a2a4a)",
                          transition: "width 0.3s ease",
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        color: "#64748b",
                        width: "32px",
                        textAlign: "right",
                      }}
                    >
                      {ins.overallProgress}%
                    </span>
                  </div>
                </td>

                {/* Status */}
                <td style={{ padding: "14px 16px", whiteSpace: "nowrap" }}>
                  <StatusBadge label={cfg.label} color={cfg.color} bg={cfg.bg} />
                </td>

                {/* Actions */}
                <td
                  style={{ padding: "14px 16px" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    {canEdit && (
                      <ActionBtn
                        icon={<Pencil size={13} />}
                        label="Edit"
                        filled
                        onClick={() => navigate(`/inspector/form/${ins.id}`)}
                      />
                    )}
                    <ActionBtn
                      icon={<MessageSquare size={13} />}
                      label="Notes"
                      onClick={() => navigate(`/inspector/form/${ins.id}?tab=notes`)}
                    />
                    <ActionBtn
                      icon={<Eye size={13} />}
                      label="View"
                      onClick={() => navigate(`/inspector/form/${ins.id}`)}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </TableCard>
      )}
    </PageShell>
    {showNewModal && <NewInspectionModal onClose={() => setShowNewModal(false)} />}
    </>
  );
}

function ActionBtn({
  icon,
  label,
  filled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  filled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "4px",
        padding: "5px 9px",
        borderRadius: "6px",
        border: filled ? "none" : "1px solid #e5e7eb",
        background: filled ? "#1a2a4a" : "white",
        color: filled ? "#fff" : "#64748b",
        fontSize: "12px",
        fontWeight: 600,
        cursor: "pointer",
        transition: "opacity 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.75")}
      onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
    >
      {icon}
      {label}
    </button>
  );
}

function EmptyState({ tab }: { tab: TabFilter }) {
  return (
    <div
      style={{
        background: "white",
        borderRadius: "12px",
        border: "1px solid #e5e7eb",
        boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
        padding: "60px 32px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: "52px",
          height: "52px",
          borderRadius: "12px",
          background: "#f1f5f9",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 16px",
        }}
      >
        <Eye size={24} color="#94a3b8" />
      </div>
      <p style={{ fontSize: "15px", fontWeight: 600, color: "#1a2a4a", margin: "0 0 6px" }}>
        No inspections found
      </p>
      <p style={{ fontSize: "13px", color: "#94a3b8", margin: 0 }}>
        {tab === "all"
          ? "You have no inspections yet."
          : `No inspections with status "${tab}".`}
      </p>
    </div>
  );
}

const modalFieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: "8px",
  border: "1.5px solid #e5e7eb",
  fontSize: "13px",
  color: "#1a2a4a",
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "inherit",
  background: "white",
};

/**
 * Starts a brand-new draft. Mobile's own "new inspection" flow never
 * touches the backend at this point (it works from a local offline DB,
 * only syncing once there's something to submit) -- web has no equivalent
 * local store, so this creates the draft on the server immediately, with
 * one empty placeholder section per templatable key so InspectorFormEditor
 * has the full section list to fill in right away, the same set mobile
 * would build up to over the course of the inspection.
 */
function NewInspectionModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { createInspection } = useAppData();
  const [inspectionTypeId, setInspectionTypeId] = useState(INSPECTION_TYPES[0].id);
  const [propertyTypeId, setPropertyTypeId] = useState("");
  const [jobNo, setJobNo] = useState("");
  const [client, setClient] = useState("");
  const [address, setAddress] = useState("");
  const [suburb, setSuburb] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedType = INSPECTION_TYPES.find((t) => t.id === inspectionTypeId)!;
  const availableProperties = PROPERTY_TYPES.filter((p) => selectedType.applicableProperties.includes(p.id));

  async function handleCreate() {
    if (!propertyTypeId) {
      setError("Choose a property type");
      return;
    }
    if (!isValidCombo(inspectionTypeId, propertyTypeId)) {
      setError("That property type isn't available for this inspection type");
      return;
    }
    if (!jobNo.trim() || !address.trim() || !client.trim()) {
      setError("Job number, address and client are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const propertyType = PROPERTY_TYPES.find((p) => p.id === propertyTypeId)!;
      const sections = TEMPLATABLE_SECTIONS.map((s, idx) => ({
        key: s.key,
        name: s.name,
        icon: s.icon,
        order: idx,
        status: "pending" as const,
        reportText: "",
        fields: {},
        photos: [],
        damages: [],
      }));
      const id = await createInspection({
        inspectionType: selectedType.title,
        propertyType: propertyType.title,
        jobNo: jobNo.trim(),
        address: address.trim(),
        suburb: suburb.trim(),
        client: client.trim(),
        date,
        sections,
      });
      navigate(`/inspector/form/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create inspection");
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
        style={{ background: "white", borderRadius: "14px", width: "420px", maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 32px)", overflowY: "auto", boxShadow: "0 20px 50px rgba(0,0,0,0.25)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #f1f5f9" }}>
          <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#1a2a4a", margin: 0 }}>New Inspection</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", padding: "4px" }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div>
            <label style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "4px" }}>Inspection Type</label>
            <select
              value={inspectionTypeId}
              onChange={(e) => {
                setInspectionTypeId(e.target.value);
                setPropertyTypeId(""); // selected property may not apply to the new type
              }}
              style={modalFieldStyle}
            >
              {INSPECTION_TYPES.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "4px" }}>Property Type</label>
            <select value={propertyTypeId} onChange={(e) => setPropertyTypeId(e.target.value)} style={modalFieldStyle}>
              <option value="">Select…</option>
              {availableProperties.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "4px" }}>Job Number</label>
            <input value={jobNo} onChange={(e) => setJobNo(e.target.value)} style={modalFieldStyle} placeholder="e.g. VIC-124" />
          </div>
          <div>
            <label style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "4px" }}>Client</label>
            <input value={client} onChange={(e) => setClient(e.target.value)} style={modalFieldStyle} />
          </div>
          <div>
            <label style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "4px" }}>Property Address</label>
            <input value={address} onChange={(e) => setAddress(e.target.value)} style={modalFieldStyle} />
          </div>
          <div>
            <label style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "4px" }}>Suburb</label>
            <input value={suburb} onChange={(e) => setSuburb(e.target.value)} style={modalFieldStyle} />
          </div>
          <div>
            <label style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "4px" }}>Inspection Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={modalFieldStyle} />
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
            onClick={handleCreate}
            disabled={saving}
            style={{ padding: "8px 14px", borderRadius: "8px", border: "none", background: saving ? "#94a3b8" : "#e63329", fontSize: "12px", fontWeight: 600, color: "white", cursor: saving ? "default" : "pointer" }}
          >
            {saving ? "Creating…" : "Create Inspection"}
          </button>
        </div>
      </div>
    </div>
  );
}
