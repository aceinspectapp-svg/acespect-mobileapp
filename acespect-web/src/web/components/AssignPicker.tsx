import { useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { api } from "../api";

/** Admin control: pick an active reviewer and assign (or reassign) the inspection. The new assignee is emailed by the server. */
export function AssignPicker({
  inspectionId,
  currentReviewerId,
  reviewers,
  onDone,
}: {
  inspectionId: string;
  currentReviewerId: string | null;
  reviewers: { id: string; name: string }[];
  onDone: () => void | Promise<void>;
}) {
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const options = reviewers.filter((r) => r.id !== currentReviewerId);
  const unassigned = !currentReviewerId;

  async function go() {
    if (!choice) return;
    setBusy(true);
    try {
      await api.assignInspection(inspectionId, choice);
      setChoice("");
      await onDone();
    } catch (e) {
      alert((e as Error).message || "Could not assign the inspection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
      <select
        aria-label={unassigned ? "Reviewer to assign" : "Reviewer to reassign to"}
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        style={{ fontSize: "12px", padding: "5px 6px", borderRadius: "7px", border: "1px solid #e5e7eb", color: "#374151" }}
      >
        <option value="">{unassigned ? "Choose reviewer…" : "Reassign to…"}</option>
        {options.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      <button
        onClick={go}
        disabled={!choice || busy}
        title={unassigned ? "Assign reviewer" : "Reassign reviewer"}
        style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "5px 12px", borderRadius: "7px", background: choice ? "#1a2a4a" : "#94a3b8", color: "white", fontSize: "12px", fontWeight: 600, border: "none", cursor: choice ? "pointer" : "default", whiteSpace: "nowrap" }}
      >
        <ClipboardCheck size={13} />
        {unassigned ? "Assign" : "Reassign"}
      </button>
    </span>
  );
}
