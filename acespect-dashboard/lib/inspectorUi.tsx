"use client";

import type { InspectionStatus } from "./types";

const STATUS_LABEL: Record<InspectionStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  "in-review": "In review",
  approved: "Approved",
  rejected: "Rejected",
};

/** Draft is the only status the inspector can still act on, so it reads warm. */
const STATUS_TONE: Record<InspectionStatus, string> = {
  draft: "badge amber",
  submitted: "badge brand",
  "in-review": "badge brand",
  approved: "badge green",
  rejected: "badge red",
};

export function StatusBadge({ status }: { status: InspectionStatus }) {
  return <span className={STATUS_TONE[status] ?? "badge"}>{STATUS_LABEL[status] ?? status}</span>;
}

/**
 * Renders one raw answer value for display. The answer tree mixes scalars,
 * multi-select arrays and nested instance trees (rooms, parts, damage lists),
 * so anything non-scalar is summarised rather than dumped as JSON.
 */
export function AnswerValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <span className="muted">—</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="muted">—</span>;
    if (typeof value[0] === "string") return <>{(value as string[]).join(", ")}</>;
    return <span className="muted">{value.length} entr{value.length === 1 ? "y" : "ies"}</span>;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return <span className="muted">{keys.length} entr{keys.length === 1 ? "y" : "ies"}</span>;
  }
  return <>{String(value)}</>;
}

/** Turns a camelCase / snake_case field key into something readable. */
export function humanizeKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}
