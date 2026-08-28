"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { TopBar } from "@/lib/ui";
import { StatusBadge } from "@/lib/inspectorUi";
import type { WebInspection } from "@/lib/types";

/**
 * The inspector's own dashboard: everything they've captured, newest first.
 * Drafts are the actionable ones -- they can still be edited and finalized;
 * anything already submitted is in the reviewer's hands and read-only.
 */
export default function MyInspectionsPage() {
  const router = useRouter();
  const [items, setItems] = useState<WebInspection[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ inspections: WebInspection[] }>("/web/inspections")
      .then((d) => setItems(d.inspections))
      .catch((e: ApiError) => {
        if (e.status === 401 || e.status === 403) router.replace("/login");
        else setError(e.message);
      });
  }, [router]);

  const drafts = (items ?? []).filter((i) => i.status === "draft");
  const sent = (items ?? []).filter((i) => i.status !== "draft");

  return (
    <>
      <TopBar />
      <div className="container">
        <h1>My Inspections</h1>
        <p className="muted">
          Drafts can still be edited. Finalizing sends an inspection to a reviewer
          and locks it.
        </p>

        {error && <div className="error">{error}</div>}
        {!items && !error && <p className="muted">Loading…</p>}

        {items && items.length === 0 && (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>
              Nothing here yet. Complete an inspection in the mobile app and it
              will appear as a draft.
            </p>
          </div>
        )}

        {drafts.length > 0 && (
          <>
            <h2 style={{ marginBottom: 8 }}>Drafts ({drafts.length})</h2>
            <InspectionTable items={drafts} onOpen={(id) => router.push(`/my-inspections/${id}`)} />
          </>
        )}

        {sent.length > 0 && (
          <>
            <h2 style={{ marginTop: 28, marginBottom: 8 }}>Sent for review ({sent.length})</h2>
            <InspectionTable items={sent} onOpen={(id) => router.push(`/my-inspections/${id}`)} />
          </>
        )}
      </div>
    </>
  );
}

function InspectionTable({
  items,
  onOpen,
}: {
  items: WebInspection[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="card" style={{ padding: 0, overflowX: "auto" }}>
      <table>
        <thead>
          <tr>
            <th>Job No</th>
            <th>Address</th>
            <th>Client</th>
            <th>Type</th>
            <th>Date</th>
            <th>Sections</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} onClick={() => onOpen(i.id)} style={{ cursor: "pointer" }}>
              <td>{i.jobNo || <span className="muted">—</span>}</td>
              <td>{i.address || <span className="muted">—</span>}</td>
              <td>{i.client || <span className="muted">—</span>}</td>
              <td className="muted">
                {i.type} · {i.propertyType.replace(/_/g, " ")}
              </td>
              <td>{i.date}</td>
              <td>{i.sections.length}</td>
              <td>
                <StatusBadge status={i.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
