import { useState } from "react";
import { useNavigate } from "react-router";
import { Search, Eye, ClipboardCheck } from "lucide-react";
import { STATUS_CONFIG } from "../../mockData";
import type { InspectionStatus } from "../../mockData";
import { useAppData } from "../../data";
import { PageShell, StatusBadge, TableCard, StatCard } from "../../components/WebLayout";

type TabFilter = "all" | InspectionStatus;

const TABS: { key: TabFilter; label: string }[] = [
  { key: "all",       label: "All" },
  { key: "draft",     label: "Draft" },
  { key: "submitted", label: "Submitted" },
  { key: "in-review", label: "In Review" },
  { key: "approved",  label: "Approved" },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function AdminInspections() {
  const navigate = useNavigate();
  const { inspections: INSPECTIONS, users } = useAppData();
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<TabFilter>("all");

  const resolveUserName = (id: string | null): string => {
    if (!id) return "Unassigned";
    return users.find((u) => u.id === id)?.name ?? id;
  };
  const getUserInitials = (id: string | null): string => {
    const name = resolveUserName(id);
    if (name === "Unassigned") return "—";
    return name.split(" ").map((n) => n[0]).join("").slice(0, 2);
  };

  // Stats
  const totalCount    = INSPECTIONS.length;
  const draftCount    = INSPECTIONS.filter((i) => i.status === "draft").length;
  const inReviewCount = INSPECTIONS.filter((i) => i.status === "in-review").length;
  const approvedCount = INSPECTIONS.filter((i) => i.status === "approved").length;

  const filtered = INSPECTIONS.filter((i) => {
    const matchesTab = activeTab === "all" || i.status === activeTab;
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      i.jobNo.toLowerCase().includes(q) ||
      i.address.toLowerCase().includes(q) ||
      i.suburb.toLowerCase().includes(q) ||
      i.client.toLowerCase().includes(q) ||
      resolveUserName(i.inspectorId).toLowerCase().includes(q) ||
      resolveUserName(i.reviewerId).toLowerCase().includes(q);
    return matchesTab && matchesSearch;
  });

  const miniChips: { label: string; count: number; color: string; bg: string }[] = [
    { label: "Total",     count: totalCount,    color: "#1a2a4a", bg: "#f1f5f9" },
    { label: "Draft",     count: draftCount,    color: STATUS_CONFIG.draft.color,      bg: STATUS_CONFIG.draft.bg },
    { label: "In Review", count: inReviewCount, color: STATUS_CONFIG["in-review"].color, bg: STATUS_CONFIG["in-review"].bg },
    { label: "Approved",  count: approvedCount, color: STATUS_CONFIG.approved.color,   bg: STATUS_CONFIG.approved.bg },
  ];

  return (
    <PageShell title="Inspections" subtitle="All inspections across all inspectors">
      {/* Mini stats chips */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "20px", flexWrap: "wrap" }}>
        {miniChips.map((chip) => (
          <div
            key={chip.label}
            style={{
              padding: "6px 14px",
              borderRadius: "20px",
              fontSize: "12px",
              fontWeight: 700,
              background: chip.bg,
              color: chip.color,
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            {chip.label}
            <span
              style={{
                fontSize: "13px",
                fontWeight: 800,
              }}
            >
              {chip.count}
            </span>
          </div>
        ))}
      </div>

      {/* Search + filter toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "14px",
          marginBottom: "12px",
          flexWrap: "wrap",
        }}
      >
        {/* Search */}
        <div style={{ position: "relative", flex: "1 1 260px", maxWidth: "380px" }}>
          <Search
            size={14}
            color="#94a3b8"
            style={{
              position: "absolute",
              left: "11px",
              top: "50%",
              transform: "translateY(-50%)",
            }}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by job, address, client, inspector…"
            style={{
              width: "100%",
              paddingLeft: "32px",
              paddingRight: "12px",
              paddingTop: "8px",
              paddingBottom: "8px",
              fontSize: "13px",
              border: "1px solid #e5e7eb",
              borderRadius: "8px",
              outline: "none",
              background: "white",
              color: "#1a2a4a",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Filter pills */}
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {TABS.map((tab) => {
            const count =
              tab.key === "all"
                ? INSPECTIONS.length
                : INSPECTIONS.filter((i) => i.status === tab.key).length;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  padding: "7px 14px",
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
                      color: isActive ? "#fff" : "#64748b",
                    }}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Results count */}
      <p style={{ fontSize: "12px", color: "#94a3b8", margin: "0 0 14px" }}>
        {filtered.length} inspection{filtered.length !== 1 ? "s" : ""}
      </p>

      {/* Table */}
      <TableCard
        headers={[
          "Job No.",
          "Address",
          "Client",
          "Inspector",
          "Reviewer",
          "Date",
          "Type",
          "Status",
          "Actions",
        ]}
      >
        {filtered.length === 0 ? (
          <tr>
            <td
              colSpan={9}
              style={{
                padding: "56px",
                textAlign: "center",
                color: "#94a3b8",
                fontSize: "14px",
              }}
            >
              No inspections found
            </td>
          </tr>
        ) : (
          filtered.map((ins, idx) => {
            const sc = STATUS_CONFIG[ins.status];
            const inspectorName = resolveUserName(ins.inspectorId);
            const reviewerName  = resolveUserName(ins.reviewerId);
            const inspectorInitials = getUserInitials(ins.inspectorId);
            const reviewerInitials  = getUserInitials(ins.reviewerId);
            const isUnassigned = ins.reviewerId === null;
            const isLast = idx === filtered.length - 1;

            return (
              <tr
                key={ins.id}
                style={{
                  borderBottom: isLast ? "none" : "1px solid #f1f5f9",
                  cursor: "pointer",
                }}
                onClick={() => navigate(`/admin/inspections/${ins.id}`)}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#f8fafc")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                {/* Job No. */}
                <td style={{ padding: "13px 16px" }}>
                  <span
                    style={{
                      background: "#f1f5f9",
                      borderRadius: "6px",
                      padding: "3px 7px",
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "#1a2a4a",
                      fontFamily: "monospace",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {ins.jobNo}
                  </span>
                </td>

                {/* Address */}
                <td style={{ padding: "13px 16px" }}>
                  <p
                    style={{
                      fontSize: "13px",
                      fontWeight: 600,
                      color: "#1a2a4a",
                      margin: 0,
                    }}
                  >
                    {ins.address}
                  </p>
                  <p
                    style={{
                      fontSize: "11px",
                      color: "#94a3b8",
                      margin: "2px 0 0",
                    }}
                  >
                    {ins.suburb}
                  </p>
                </td>

                {/* Client */}
                <td
                  style={{
                    padding: "13px 16px",
                    fontSize: "13px",
                    color: "#374151",
                    maxWidth: "160px",
                  }}
                >
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      display: "block",
                    }}
                  >
                    {ins.client}
                  </span>
                </td>

                {/* Inspector */}
                <td style={{ padding: "13px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                    <div
                      style={{
                        width: "26px",
                        height: "26px",
                        borderRadius: "50%",
                        background: "#1a2a4a",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "9px",
                        fontWeight: 700,
                        color: "white",
                        flexShrink: 0,
                      }}
                    >
                      {inspectorInitials}
                    </div>
                    <span style={{ fontSize: "12px", color: "#374151", whiteSpace: "nowrap" }}>
                      {inspectorName}
                    </span>
                  </div>
                </td>

                {/* Reviewer */}
                <td style={{ padding: "13px 16px" }}>
                  {isUnassigned ? (
                    <span
                      style={{
                        fontSize: "12px",
                        color: "#94a3b8",
                        fontStyle: "italic",
                      }}
                    >
                      Unassigned
                    </span>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                      <div
                        style={{
                          width: "26px",
                          height: "26px",
                          borderRadius: "50%",
                          background: "#2563eb",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "9px",
                          fontWeight: 700,
                          color: "white",
                          flexShrink: 0,
                        }}
                      >
                        {reviewerInitials}
                      </div>
                      <span style={{ fontSize: "12px", color: "#374151", whiteSpace: "nowrap" }}>
                        {reviewerName}
                      </span>
                    </div>
                  )}
                </td>

                {/* Date */}
                <td
                  style={{
                    padding: "13px 16px",
                    fontSize: "12px",
                    color: "#374151",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatDate(ins.date)}
                </td>

                {/* Type */}
                <td style={{ padding: "13px 16px" }}>
                  <span
                    style={{
                      fontSize: "12px",
                      color: "#64748b",
                      background: "#f1f5f9",
                      padding: "3px 10px",
                      borderRadius: "8px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {ins.type}
                  </span>
                </td>

                {/* Status */}
                <td style={{ padding: "13px 16px" }}>
                  <StatusBadge label={sc.label} color={sc.color} bg={sc.bg} />
                </td>

                {/* Actions */}
                <td
                  style={{ padding: "13px 16px" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    {/* View button */}
                    <button
                      onClick={() => navigate(`/admin/inspections/${ins.id}`)}
                      title="View"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "5px",
                        padding: "5px 12px",
                        borderRadius: "7px",
                        background: "white",
                        color: "#374151",
                        fontSize: "12px",
                        fontWeight: 600,
                        border: "1px solid #e5e7eb",
                        cursor: "pointer",
                        transition: "all 0.12s",
                        whiteSpace: "nowrap",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = "#2563eb";
                        e.currentTarget.style.color = "#2563eb";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = "#e5e7eb";
                        e.currentTarget.style.color = "#374151";
                      }}
                    >
                      <Eye size={13} />
                      View
                    </button>

                    {/* Assign button — only when no reviewer */}
                    {isUnassigned && (
                      <button
                        onClick={() => {
                          // Assign action placeholder
                        }}
                        title="Assign reviewer"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                          padding: "5px 12px",
                          borderRadius: "7px",
                          background: "#1a2a4a",
                          color: "white",
                          fontSize: "12px",
                          fontWeight: 600,
                          border: "none",
                          cursor: "pointer",
                          transition: "background 0.12s",
                          whiteSpace: "nowrap",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background = "#243b5a")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = "#1a2a4a")
                        }
                      >
                        <ClipboardCheck size={13} />
                        Assign
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })
        )}
      </TableCard>
    </PageShell>
  );
}
