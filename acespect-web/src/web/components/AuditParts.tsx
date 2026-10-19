import type { CSSProperties } from "react";
import { CATEGORY_STYLE, OUTCOME_STYLE, when, type AuditEvent, type VerifyResult } from "../auditApi";

const mono: CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "11px", color: "#475569" };
const label: CSSProperties = { fontSize: "11px", fontWeight: 600, color: "#94a3b8", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: "4px" };

export function Pill({ text, color, bg }: { text: string; color: string; bg: string }) {
  return <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: "20px", background: bg, color, whiteSpace: "nowrap" }}>{text}</span>;
}

export const CategoryPill = ({ category }: { category: string }) => {
  const s = CATEGORY_STYLE[category] ?? { label: category, color: "#475569", bg: "#f1f5f9" };
  return <Pill text={s.label} color={s.color} bg={s.bg} />;
};
export const OutcomePill = ({ outcome }: { outcome: string }) => {
  const s = OUTCOME_STYLE[outcome] ?? { label: outcome, color: "#475569", bg: "#f1f5f9" };
  return <Pill text={s.label} color={s.color} bg={s.bg} />;
};

const show = (v: unknown): string => {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length > 300 ? `${v.slice(0, 300)}…` : v;
  const t = JSON.stringify(v);
  return t.length > 300 ? `${t.slice(0, 300)}…` : t;
};

/** Who, from where, with what, and the proof it has not been altered: everything about one entry beyond the headline. */
export function AuditDetail({ e, showNetwork = true }: { e: AuditEvent; showNetwork?: boolean }) {
  const keys = [...new Set([...Object.keys(e.before ?? {}), ...Object.keys(e.after ?? {})])];
  const client = [e.client.app, e.client.version && `v${e.client.version}`, e.client.platform, e.client.os, e.client.device].filter(Boolean).join(" · ");
  return (
    <div style={{ display: "grid", gap: "14px", fontSize: "12px", color: "#374151" }}>
      {keys.length > 0 && (
        <div>
          <div style={label}>What changed</div>
          <table style={{ borderCollapse: "collapse", width: "100%", background: "white", border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {["Field", "Before", "After"].map((h) => <th key={h} style={{ textAlign: "left", padding: "6px 10px", fontSize: "11px", color: "#94a3b8" }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "6px 10px", fontWeight: 600 }}>{k}</td>
                  <td style={{ padding: "6px 10px", color: "#b91c1c", wordBreak: "break-word" }}>{show(e.before?.[k])}</td>
                  <td style={{ padding: "6px 10px", color: "#15803d", wordBreak: "break-word" }}>{show(e.after?.[k])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {e.reason && <div><div style={label}>Reason</div>{e.reason}</div>}
      {e.metadata && Object.keys(e.metadata).length > 0 && (
        <div>
          <div style={label}>Details</div>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", ...mono }}>{JSON.stringify(e.metadata, null, 2)}</pre>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "14px" }}>
        <div>
          <div style={label}>Who</div>
          {e.actor.name ?? "—"}{e.actor.role ? ` (${e.actor.role.toLowerCase()})` : ""}
          <div style={mono}>{e.actor.id ?? "no account"}</div>
        </div>
        <div>
          <div style={label}>From</div>
          {e.source === "mobile" ? "Phone app" : e.source === "web" ? "Web portal" : e.source === "system" ? "Server" : "API"}
          {client && <div>{client}</div>}
          {e.client.updateId && <div style={mono}>update {e.client.updateId}</div>}
          {showNetwork && e.ip && <div style={mono}>{e.ip}</div>}
          {showNetwork && e.userAgent && <div style={{ ...mono, maxWidth: "340px", wordBreak: "break-word" }}>{e.userAgent}</div>}
        </div>
        <div>
          <div style={label}>Time</div>
          Server: {when(e.occurredAt)}
          {e.clientTime && <div>Phone clock: {when(e.clientTime)}{e.clientSkewMs !== null ? ` (${Math.round(e.clientSkewMs / 1000)} s from the server)` : ""}</div>}
          {e.clientTime && <div style={{ color: "#94a3b8" }}>The phone's own clock is recorded but not trusted.</div>}
        </div>
        <div>
          <div style={label}>Linked</div>
          {e.correlationId && <div style={mono}>story {e.correlationId.slice(0, 8)}…</div>}
          {showNetwork && e.requestId && <div style={mono}>request {e.requestId.slice(0, 8)}…</div>}
          {e.target.type && <div>{e.target.type}{e.target.label ? `: ${e.target.label}` : ""}</div>}
        </div>
      </div>
      <div>
        <div style={label}>Integrity</div>
        <div style={mono}>chain {e.integrity.stream} · entry #{e.seq}</div>
        <div style={{ ...mono, wordBreak: "break-all" }}>hash {e.integrity.hash}</div>
        <div style={{ ...mono, wordBreak: "break-all" }}>previous {e.integrity.prevHash ?? "(first entry of this chain)"}</div>
      </div>
    </div>
  );
}

/** The result of an integrity check, in words. */
export function VerifyBanner({ result, scope }: { result: VerifyResult; scope: string }) {
  return (
    <div
      role="status"
      style={{ padding: "10px 14px", borderRadius: "10px", fontSize: "13px", border: `1px solid ${result.ok ? "#bbf7d0" : "#fecaca"}`, background: result.ok ? "#f0fdf4" : "#fef2f2", color: result.ok ? "#166534" : "#991b1b" }}
    >
      <strong>{result.ok ? `Integrity check passed — ${scope} has not been altered.` : `Integrity check FAILED — ${scope} does not match its records.`}</strong>
      <div style={{ marginTop: "3px", fontSize: "12px" }}>
        {result.eventsChecked.toLocaleString()} entries in {result.streams.toLocaleString()} chain{result.streams === 1 ? "" : "s"} recomputed
        {result.anchorsChecked ? `, ${result.anchorsChecked} daily seal${result.anchorsChecked === 1 ? "" : "s"} checked` : ""}
        {result.unsealedEvents ? `; ${result.unsealedEvents} recent entries are not yet sealed (sealed hourly)` : ""} · {when(result.verifiedAt)}
      </div>
      {result.problems.slice(0, 5).map((p, i) => <div key={i} style={{ marginTop: "4px", fontSize: "12px" }}>• {p.detail}</div>)}
    </div>
  );
}
