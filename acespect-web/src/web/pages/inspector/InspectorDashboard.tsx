import { useState } from "react";
import { useNavigate } from "react-router";
import { Plus, Pencil, MessageSquare, Eye } from "lucide-react";
import { STATUS_CONFIG } from "../../mockData";
import type { InspectionStatus } from "../../mockData";
import { useAppData } from "../../data";
import { PageShell, StatusBadge, TableCard, PrimaryBtn } from "../../components/WebLayout";

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

  const allInspections = currentUser ? getInspectionsByInspector(currentUser.id) : [];
  const filtered =
    activeTab === "all"
      ? allInspections
      : allInspections.filter((i) => i.status === activeTab);

  return (
    <PageShell
      title="My Inspections"
      subtitle="James Thompson — Inspector"
      actions={
        <PrimaryBtn color="#e63329" onClick={() => navigate("/inspector/form/new")}>
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
