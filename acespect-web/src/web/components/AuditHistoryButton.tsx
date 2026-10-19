import { useState } from "react";
import { History, X } from "lucide-react";
import { useAppData } from "../data";
import { AuditTimeline } from "./AuditTimeline";

/** "History" on an inspection: opens its complete audit trail (phone, uploads, submit, review, downloads) in a side panel. */
export function AuditHistoryButton({ inspectionId, jobNo }: { inspectionId: string; jobNo?: string }) {
  const { currentUser } = useAppData();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Everything that has happened to this inspection"
        style={{ height: "32px", padding: "0 12px", borderRadius: "8px", background: "white", border: "1px solid #e5e7eb", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", color: "#374151", fontSize: "12px", fontWeight: 600, flexShrink: 0 }}
      >
        <History size={14} /> History
      </button>
      {open && (
        <div role="dialog" aria-label="Inspection history" style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", justifyContent: "flex-end", background: "rgba(15,23,42,0.35)" }} onClick={() => setOpen(false)}>
          <div style={{ width: "min(720px, 100vw)", height: "100%", background: "white", boxShadow: "-8px 0 30px rgba(0,0,0,0.15)", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #e5e7eb" }}>
              <div>
                <div style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>Audit history</div>
                <div style={{ fontSize: "16px", fontWeight: 700, color: "#1a2a4a" }}>{jobNo ?? "Inspection"}</div>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close" style={{ border: "none", background: "transparent", cursor: "pointer", color: "#64748b" }}><X size={20} /></button>
            </div>
            <div style={{ padding: "16px 20px", overflowY: "auto", flex: 1 }}>
              <AuditTimeline inspectionId={inspectionId} isAdmin={currentUser?.role === "admin"} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
