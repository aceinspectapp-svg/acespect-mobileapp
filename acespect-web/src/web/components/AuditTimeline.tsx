import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, ShieldCheck, ChevronDown, ChevronUp } from "lucide-react";
import { auditApi, dotColor, downloadAuditFile, labelOf, when, type AuditEvent, type AuditTimeline as Timeline, type VerifyResult } from "../auditApi";
import { AuditDetail, CategoryPill, OutcomePill, VerifyBanner } from "./AuditParts";

type Chip = "all" | "mobile" | "web" | "problems";

/**
 * One inspection's complete history, oldest first: taken on the phone, uploaded, submitted, reviewed, approved, downloaded -- including the
 * incidents (lost connection, retries, photos skipped) the phone recorded while it was offline.
 */
export function AuditTimeline({ inspectionId, isAdmin }: { inspectionId: string; isAdmin: boolean }) {
  const [data, setData] = useState<Timeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chip, setChip] = useState<Chip>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    auditApi.timeline(inspectionId).then(setData).catch((e: Error) => setError(e.message));
  }, [inspectionId]);
  useEffect(load, [load]);

  const shown = useMemo(() => {
    const all = data?.events ?? [];
    if (chip === "mobile") return all.filter((e) => e.source === "mobile");
    if (chip === "web") return all.filter((e) => e.source === "web");
    if (chip === "problems") return all.filter((e) => e.outcome !== "success" || e.severity === "warning" || e.severity === "error");
    return all;
  }, [data, chip]);

  const days = useMemo(() => {
    const g = new Map<string, AuditEvent[]>();
    for (const e of shown) {
      const d = new Date(e.occurredAt).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      g.set(d, [...(g.get(d) ?? []), e]);
    }
    return [...g.entries()];
  }, [shown]);

  const problems = (data?.events ?? []).filter((e) => e.outcome !== "success" || e.severity === "warning" || e.severity === "error").length;

  async function download(format: "pdf" | "csv") {
    setBusy(format);
    try {
      await downloadAuditFile(`/audit/reports/inspection/${inspectionId}?format=${format}`, `audit-${data?.inspection?.jobNo ?? inspectionId}.${format}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy(null);
    }
  }

  if (error && !data) return <p style={{ color: "#b91c1c", fontSize: "13px" }}>{error}</p>;
  if (!data) return <p style={{ color: "#94a3b8", fontSize: "13px" }}>Loading history…</p>;

  const chipStyle = (on: boolean) => ({ padding: "5px 12px", borderRadius: "20px", border: `1px solid ${on ? "#1a2a4a" : "#e5e7eb"}`, background: on ? "#1a2a4a" : "white", color: on ? "white" : "#475569", fontSize: "12px", fontWeight: 600, cursor: "pointer" }) as const;
  const btn = { display: "inline-flex", alignItems: "center", gap: "6px", padding: "7px 12px", borderRadius: "8px", border: "1px solid #e5e7eb", background: "white", color: "#374151", fontSize: "12px", fontWeight: 600, cursor: "pointer" } as const;

  return (
    <div style={{ display: "grid", gap: "14px" }}>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
        {([["all", `All (${data.events.length})`], ["mobile", "Phone"], ["web", "Portal"], ["problems", `Problems (${problems})`]] as const).map(([k, l]) => (
          <button key={k} style={chipStyle(chip === k)} onClick={() => setChip(k)}>{l}</button>
        ))}
        <span style={{ flex: 1 }} />
        <button style={btn} onClick={() => auditApi.verify(inspectionId).then(setVerify).catch((e: Error) => setError(e.message))}><ShieldCheck size={14} /> Verify integrity</button>
        {isAdmin && (
          <>
            <button style={btn} disabled={busy !== null} onClick={() => download("pdf")}><Download size={14} /> {busy === "pdf" ? "Preparing…" : "Audit report (PDF)"}</button>
            <button style={btn} disabled={busy !== null} onClick={() => download("csv")}><Download size={14} /> {busy === "csv" ? "Preparing…" : "CSV"}</button>
          </>
        )}
      </div>
      {error && <p style={{ color: "#b91c1c", fontSize: "12px", margin: 0 }}>{error}</p>}
      {verify && <VerifyBanner result={verify} scope="this inspection's history" />}
      {data.truncated && <p style={{ fontSize: "12px", color: "#b45309", margin: 0 }}>Showing the first 5,000 entries; use the audit report for the full history.</p>}
      {days.length === 0 && <p style={{ fontSize: "13px", color: "#94a3b8" }}>Nothing recorded for this view.</p>}

      {days.map(([day, events]) => (
        <section key={day}>
          <h4 style={{ margin: "0 0 8px", fontSize: "12px", color: "#64748b", fontWeight: 700 }}>{day}</h4>
          <ol style={{ listStyle: "none", margin: 0, padding: 0, borderLeft: "2px solid #e5e7eb" }}>
            {events.map((e) => {
              const isOpen = open === e.id;
              return (
                <li key={e.id} style={{ position: "relative", padding: "0 0 12px 18px" }}>
                  <span style={{ position: "absolute", left: "-6px", top: "4px", width: "10px", height: "10px", borderRadius: "50%", background: dotColor(e), border: "2px solid white", boxShadow: "0 0 0 1px #e5e7eb" }} />
                  <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", cursor: "pointer" }} onClick={() => setOpen(isOpen ? null : e.id)}>
                    <span style={{ fontSize: "12px", color: "#64748b", minWidth: "62px" }}>{new Date(e.occurredAt).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                    <strong style={{ fontSize: "13px", color: "#1a2a4a" }}>{labelOf(e)}</strong>
                    <CategoryPill category={e.category} />
                    {e.outcome !== "success" && <OutcomePill outcome={e.outcome} />}
                    {isOpen ? <ChevronUp size={13} color="#94a3b8" /> : <ChevronDown size={13} color="#94a3b8" />}
                  </div>
                  <div style={{ fontSize: "12px", color: "#64748b", marginLeft: "70px" }}>
                    {e.actor.name ?? "System"}{e.actor.role ? ` (${e.actor.role.toLowerCase()})` : ""}
                    {e.client.version ? ` · app ${e.client.version}` : ""}{e.client.device ? ` · ${e.client.device}` : ""}
                    {e.message ? ` — ${e.message}` : ""}
                  </div>
                  {isOpen && <div style={{ marginTop: "8px", marginLeft: "70px", padding: "12px", background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: "10px" }}><AuditDetail e={e} showNetwork={isAdmin} /></div>}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
