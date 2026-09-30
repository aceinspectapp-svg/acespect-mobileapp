"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, getRole } from "@/lib/api";
import { TopBar, QcNav } from "@/lib/ui";
import type { QcConfigBundle, QcDefect, QcPerson, QcStatus } from "@/lib/qcTypes";

export default function QcDefectsPage() {
  const router = useRouter();
  const [defects, setDefects] = useState<QcDefect[] | null>(null);
  const [statuses, setStatuses] = useState<QcStatus[]>([]);
  const [users, setUsers] = useState<QcPerson[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  function reload() {
    Promise.all([
      api<{ defects: QcDefect[] }>("/qc/defects"),
      api<QcConfigBundle>("/qc/config"),
      api<{ users: QcPerson[] }>("/qc/users"),
    ])
      .then(([d, c, u]) => {
        setDefects(d.defects);
        setStatuses(c.statuses);
        setUsers(u.users);
      })
      .catch((e: ApiError) => {
        if (e.status === 401 || e.status === 403) router.replace("/login");
        else setError(e.message);
      });
  }

  useEffect(() => {
    if (getRole() !== "ADMIN") {
      router.replace("/inspections");
      return;
    }
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function patchDefect(id: string, body: Record<string, unknown>) {
    setSavingId(id);
    try {
      await api(`/qc/defects/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <>
      <TopBar />
      <div className="container">
        <h1 className="page-title">QC Defects</h1>
        <p className="page-sub">Every logged defect — reassign or change status directly from this list.</p>
        <QcNav />

        {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}

        <div className="card" style={{ padding: 0, overflow: "visible" }}>
          <table>
            <thead>
              <tr>
                <th>Property</th>
                <th>Defect</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Assigned to</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {defects?.map((d) => (
                <tr key={d.id} style={{ cursor: "default" }}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{d.property.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{d.project.name} · {d.client.name}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{d.summary}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{d.location}</div>
                  </td>
                  <td>
                    <span className="badge" style={{ background: `${d.severity.color}22`, color: d.severity.color }}>
                      {d.severity.label}
                    </span>
                  </td>
                  <td>
                    <select
                      value={d.status.id}
                      disabled={savingId === d.id}
                      onChange={(e) => patchDefect(d.id, { statusId: e.target.value })}
                      style={{ width: "auto", padding: "6px 8px", fontSize: 12 }}
                    >
                      {statuses.map((s) => (
                        <option key={s.id} value={s.id}>{s.label}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={d.assignedTo?.id ?? ""}
                      disabled={savingId === d.id}
                      onChange={(e) => patchDefect(d.id, { assignedToId: e.target.value || null })}
                      style={{ width: "auto", padding: "6px 8px", fontSize: 12 }}
                    >
                      <option value="">Unassigned</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>{u.name ?? u.email}</option>
                      ))}
                    </select>
                  </td>
                  <td className="muted">{d.dueDate ? new Date(d.dueDate).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
              {defects && defects.length === 0 && (
                <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 28 }}>No defects logged yet.</td></tr>
              )}
              {!defects && !error && (
                <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 28 }}>Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
