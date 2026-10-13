import { useState } from "react";
import { useNavigate } from "react-router";
import { Search, Eye, Filter } from "lucide-react";
import { STATUS_CONFIG } from "../../mockData";
import type { InspectionStatus } from "../../mockData";
import { useAppData } from "../../data";
import { PageShell, StatusBadge, TableCard } from "../../components/WebLayout";

type TabFilter = "all" | InspectionStatus;

const TABS: { key: TabFilter; label: string }[] = [
  { key: "all",       label: "All" },
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

export function ReviewerInspections() {
  const navigate = useNavigate();
  const { currentUser, getInspectionsForReviewer, getUser } = useAppData();
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<TabFilter>("all");
  const getInspectorName = (id: string): string => getUser(id)?.name ?? id;

  const base = currentUser ? getInspectionsForReviewer(currentUser.id) : [];

  const filtered = base.filter((i) => {
    const matchesTab = activeTab === "all" || i.status === activeTab;
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      i.jobNo.toLowerCase().includes(q) ||
      i.address.toLowerCase().includes(q) ||
      i.suburb.toLowerCase().includes(q) ||
      i.client.toLowerCase().includes(q) ||
      getInspectorName(i.inspectorId).toLowerCase().includes(q);
    return matchesTab && matchesSearch;
  });

  return (
    <PageShell title="All Inspections" subtitle={`Assigned to ${currentUser?.name ?? "you"}`}>
      {/* Toolbar */}
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
        <div style={{ position: "relative", flex: "1 1 260px", maxWidth: "360px" }}>
          <Search
            size={14}
            color="#94a3b8"
            style={{ position: "absolute", left: "11px", top: "50%", transform: "translateY(-50%)" }}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by job, address, client…"
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
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
          <Filter size={13} color="#94a3b8" />
          {TABS.map((tab) => {
            const count =
              tab.key === "all"
                ? base.length
                : base.filter((i) => i.status === tab.key).length;
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
          "Address & Suburb",
          "Client",
          "Inspector",
          "Date Submitted",
          "Type",
          "Status",
          "Action",
        ]}
      >
        {filtered.length === 0 ? (
          <tr>
            <td
              colSpan={8}
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
            const inspectorName = getInspectorName(ins.inspectorId);
            const initials = inspectorName
              .split(" ")
              .map((n) => n[0])
              .join("")
              .slice(0, 2);
            const isLast = idx === filtered.length - 1;
            return (
              <tr
                key={ins.id}
                style={{
                  borderBottom: isLast ? "none" : "1px solid #f1f5f9",
                  cursor: "pointer",
                }}
                onClick={() => navigate(`/reviewer/review/${ins.id}`)}
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
                    maxWidth: "180px",
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
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <div
                      style={{
                        width: "28px",
                        height: "28px",
                        borderRadius: "50%",
                        background: "#1a2a4a",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "10px",
                        fontWeight: 700,
                        color: "white",
                        flexShrink: 0,
                      }}
                    >
                      {initials}
                    </div>
                    <span style={{ fontSize: "13px", color: "#374151", whiteSpace: "nowrap" }}>
                      {inspectorName}
                    </span>
                  </div>
                </td>

                {/* Date submitted */}
                <td
                  style={{
                    padding: "13px 16px",
                    fontSize: "13px",
                    color: "#374151",
                    whiteSpace: "nowrap",
                  }}
                >
                  {ins.submittedAt ? formatDate(ins.submittedAt) : "—"}
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

                {/* Action */}
                <td
                  style={{ padding: "13px 16px", textAlign: "center" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => navigate(`/reviewer/review/${ins.id}`)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "5px",
                      padding: "6px 14px",
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
                    <Eye size={13} />
                    Review
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
