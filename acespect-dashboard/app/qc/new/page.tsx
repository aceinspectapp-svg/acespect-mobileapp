"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, getRole } from "@/lib/api";
import { TopBar, QcNav } from "@/lib/ui";
import type { QcConfigBundle, QcPerson } from "@/lib/qcTypes";

export default function QcNewDefectPage() {
  const router = useRouter();
  const [config, setConfig] = useState<QcConfigBundle | null>(null);
  const [users, setUsers] = useState<QcPerson[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [location, setLocation] = useState("");
  const [locationDetails, setLocationDetails] = useState("");
  const [summary, setSummary] = useState("");
  const [severityId, setSeverityId] = useState("");
  const [assignedToId, setAssignedToId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (getRole() !== "ADMIN") {
      router.replace("/inspections");
      return;
    }
    Promise.all([api<QcConfigBundle>("/qc/config"), api<{ users: QcPerson[] }>("/qc/users")])
      .then(([c, u]) => {
        setConfig(c);
        setUsers(u.users);
        if (c.severities[0]) setSeverityId(c.severities[0].id);
      })
      .catch((e: ApiError) => {
        if (e.status === 401 || e.status === 403) router.replace("/login");
        else setError(e.message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const projects = useMemo(
    () => config?.clients.find((c) => c.id === clientId)?.projects ?? [],
    [config, clientId],
  );
  const properties = useMemo(
    () => projects.find((p) => p.id === projectId)?.properties ?? [],
    [projects, projectId],
  );

  const canSubmit = !!propertyId && !!summary.trim() && !!location.trim() && !!severityId && !!assignedToId;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setSubmitErr(null);
    try {
      await api("/qc/defects", {
        method: "POST",
        body: JSON.stringify({
          propertyId,
          location: location.trim(),
          locationDetails: locationDetails.trim() || undefined,
          summary: summary.trim(),
          severityId,
          assignedToId,
          dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        }),
      });
      setDone(true);
      setLocation("");
      setLocationDetails("");
      setSummary("");
      setDueDate("");
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : "Failed to create defect");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <>
        <TopBar />
        <div className="container"><div className="error">{error}</div></div>
      </>
    );
  }
  if (!config) {
    return (
      <>
        <TopBar />
        <div className="container muted">Loading…</div>
      </>
    );
  }

  return (
    <>
      <TopBar />
      <div className="container">
        <h1 className="page-title">New Defect</h1>
        <p className="page-sub">Logs the defect and assigns it in one step — the assignee sees it immediately in their mobile Tasks.</p>
        <QcNav />

        <div className="card" style={{ maxWidth: 640 }}>
          {submitErr && <div className="error" style={{ marginBottom: 12 }}>{submitErr}</div>}
          {done && (
            <div className="ok-note">
              Defect created and assigned.{" "}
              <button className="link" onClick={() => setDone(false)}>Log another</button>
              {" · "}
              <button className="link" onClick={() => router.push("/qc")}>View all defects</button>
            </div>
          )}

          <form onSubmit={submit}>
            <div className="grid2">
              <div>
                <label>Client</label>
                <select value={clientId} onChange={(e) => { setClientId(e.target.value); setProjectId(""); setPropertyId(""); }}>
                  <option value="">Select client…</option>
                  {config.clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Project</label>
                <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setPropertyId(""); }} disabled={!clientId}>
                  <option value="">Select project…</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="spacer" />
            <label>Property</label>
            <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} disabled={!projectId}>
              <option value="">Select property…</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.propertyType.label})</option>
              ))}
            </select>

            <div className="spacer" />
            <label>Location</label>
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Kitchen / Dining, Balcony…" />

            <div className="spacer" />
            <label>Location details (optional)</label>
            <input value={locationDetails} onChange={(e) => setLocationDetails(e.target.value)} placeholder="e.g. north-facing wall, bottom hinge" />

            <div className="spacer" />
            <label>Summary</label>
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} placeholder="Describe the defect…" />

            <div className="spacer" />
            <div className="grid2">
              <div>
                <label>Severity</label>
                <select value={severityId} onChange={(e) => setSeverityId(e.target.value)}>
                  {config.severities.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Due date (optional)</label>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>

            <div className="spacer" />
            <label>Assign to</label>
            <select value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)}>
              <option value="">Select assignee…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name ?? u.email} ({u.role})</option>
              ))}
            </select>
            {users.length === 0 && (
              <p className="muted" style={{ fontSize: 13 }}>
                No assignable users yet — <button type="button" className="link" onClick={() => router.push("/qc/users")}>create one first</button>.
              </p>
            )}

            <div className="spacer" />
            <button className="primary" disabled={!canSubmit || busy}>
              {busy ? "Creating…" : "Create & assign defect"}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
