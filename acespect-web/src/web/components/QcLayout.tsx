import { useCallback, useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import {
  LayoutDashboard, ShieldAlert, ClipboardCheck, Building2, Users, FileText, Gauge, BarChart3, ScrollText, Settings, Lock, UserCircle2,
  Bell, LogOut, HardHat, ArrowLeft, LifeBuoy, Layers,
} from "lucide-react";
import { AcespectLogo } from "../../components/AcespectLogo";
import { useAppData } from "../data";
import { QcProvider, useQc } from "../qcContext";
import { qcx, type Notification } from "../qcApi";
import { btnGhost, btnPrimary, ErrorNote, Field, Modal, Select } from "./QcUi";
import { inputStyle } from "./SpecForm";
import { api } from "../api";

interface NavItem { to: string; label: string; icon: React.ElementType; cap: string | string[]; end?: boolean }

const NAV: NavItem[] = [
  { to: "/qc", label: "Dashboard", icon: LayoutDashboard, cap: "reports.dashboard", end: true },
  { to: "/qc/defects", label: "Defects", icon: ShieldAlert, cap: "defects.view" },
  { to: "/qc/inspections", label: "Inspections", icon: ClipboardCheck, cap: "inspections.progress" },
  { to: "/qc/projects", label: "Projects", icon: HardHat, cap: "projects.view" },
  { to: "/qc/organisations", label: "Organisations", icon: Building2, cap: ["users.view", "client.manage"] },
  { to: "/qc/people", label: "People", icon: Users, cap: "users.view" },
  { to: "/qc/templates", label: "Templates", icon: FileText, cap: "templates.view" },
  { to: "/qc/policy", label: "SLA and escalation", icon: Gauge, cap: "projects.view" },
  { to: "/qc/reports", label: "Reports", icon: BarChart3, cap: "inspections.reports" },
  { to: "/qc/audit", label: "Audit and security", icon: ScrollText, cap: ["audit.view", "securitylog.view"] },
  { to: "/qc/settings", label: "Settings", icon: Settings, cap: "client.defaults" },
  { to: "/qc/privacy", label: "Privacy and records", icon: Lock, cap: "privacy.handle" },
];

/** Pages a Super Admin can open without being inside a client (platform-level data). */
const PLATFORM_PAGES = ["/qc/organisations", "/qc/privacy", "/qc/templates", "/qc/people", "/qc/audit", "/qc/account", "/qc/notifications"];

const ROLE_LABEL: Record<string, string> = {
  SA: "Super Admin", CLIENT_ADMIN: "Client Admin", CLIENT_USER: "Client User", MC_MANAGER: "Master Contractor Manager", MC_SITE_SUPERVISOR: "Site Supervisor",
  MC_PROJECT_MANAGER: "Project Manager", TRADE_USER: "Trade User", PRIVATE_INSPECTOR: "Private Inspector",
};
export const roleLabel = (r: string) => ROLE_LABEL[r] ?? r;

export function QcLayout() {
  return (
    <QcProvider>
      <Shell />
    </QcProvider>
  );
}

function Shell() {
  const { me, loading, error, pickClient, can, switchClient, exitSupport } = useQc();
  const { currentUser, logout } = useAppData();
  const navigate = useNavigate();
  const location = useLocation();
  const [supportOpen, setSupportOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  // Close the phone menu after choosing a page.
  useEffect(() => { setNavOpen(false); }, [location.pathname]);

  if (loading) return <div style={{ padding: 40, color: "#94a3b8", fontFamily: "Inter, sans-serif" }}>Loading…</div>;

  if (pickClient) {
    return (
      <Centered title="Which client are you working in?" sub="Your account has roles in more than one client.">
        {pickClient.map((c) => (
          <button key={c.id} style={{ ...btnGhost, display: "block", width: "100%", textAlign: "left", marginBottom: 8, padding: "12px 14px" }} onClick={() => switchClient(c.id)}>
            <b>{c.name}</b> <span style={{ color: "#94a3b8" }}>({roleLabel(c.role)})</span>
          </button>
        ))}
      </Centered>
    );
  }
  if (!me) {
    return (
      <Centered title="We could not load your account" sub={error ?? "Try signing in again."}>
        <button style={btnPrimary} onClick={() => { logout(); navigate("/"); }}>Sign out</button>
      </Centered>
    );
  }

  const items = NAV.filter((n) => (Array.isArray(n.cap) ? n.cap.some(can) : can(n.cap)));
  const needsClient = me.isSA && !me.clientId && !PLATFORM_PAGES.some((p) => location.pathname === p || location.pathname.startsWith(p + "/"));

  return (
    <div style={{ display: "flex", height: "100vh", background: "#f5f6fa", fontFamily: "Inter, -apple-system, sans-serif" }}>
      <a className="skip-link" href="#qc-main">Skip to the page content</a>
      <style>{`@media (max-width: 900px) { .qc-aside { position: fixed !important; z-index: 40; left: 0; top: 0; transform: translateX(-100%); transition: transform .2s; box-shadow: 0 0 30px rgba(0,0,0,.2); } .qc-aside.open { transform: none; } .qc-menu { display: inline-flex !important; } .qc-scrim { display: block !important; } main { -webkit-overflow-scrolling: touch; } }`}</style>
      {navOpen && <div className="qc-scrim" onClick={() => setNavOpen(false)} style={{ display: "none", position: "fixed", inset: 0, background: "rgba(15,23,42,.4)", zIndex: 30 }} />}
      <aside className={`qc-aside${navOpen ? " open" : ""}`} aria-label="Sidebar" style={{ width: 232, flexShrink: 0, background: "white", borderRight: "1px solid #e5e7eb", display: "flex", flexDirection: "column", height: "100vh" }}>
        <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid #f1f5f9" }}>
          <AcespectLogo size="sm" />
          <p style={{ fontSize: 10, color: "#94a3b8", margin: "6px 0 0", fontWeight: 500 }}>Inspection and defect platform</p>
        </div>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#1a2a4a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentUser?.name ?? currentUser?.email}</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed" }}>{roleLabel(me.role)}</div>
          {me.clients.length > 1 && !me.isSA && (
            <select value={me.clientId ?? ""} onChange={(e) => switchClient(e.target.value)} style={{ ...inputStyle, marginTop: 8, fontSize: 12, padding: "6px 8px" }} aria-label="Client">
              {me.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          {me.clients.length === 1 && !me.isSA && <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{me.clients[0]!.name}</div>}
        </div>
        <nav aria-label="Main" style={{ flex: 1, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" }}>
          {items.map(({ to, icon: Icon, label, end }) => {
            const active = end ? location.pathname === to : location.pathname === to || location.pathname.startsWith(to + "/");
            return (
              <Link key={to} to={to} aria-current={active ? "page" : undefined} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 10, textDecoration: "none",
                background: active ? "#f0f4ff" : "transparent", color: active ? "#1d4ed8" : "#475569", fontSize: 13, fontWeight: active ? 600 : 400,
                borderLeft: active ? "3px solid #2563eb" : "3px solid transparent",
              }}>
                <Icon size={15} strokeWidth={active ? 2.2 : 1.8} aria-hidden /> {label}
              </Link>
            );
          })}
        </nav>
        <div style={{ padding: 12, borderTop: "1px solid #f1f5f9", display: "flex", flexDirection: "column", gap: 4 }}>
          {currentUser?.role === "admin" && (
            <Link to="/admin/dashboard" style={footLink}><ArrowLeft size={14} aria-hidden /> Back to admin</Link>
          )}
          <Link to="/qc/account" style={footLink}><UserCircle2 size={14} aria-hidden /> My account</Link>
          <button style={{ ...footLink, border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }} onClick={() => { logout(); navigate("/"); }}>
            <LogOut size={14} aria-hidden /> Sign out
          </button>
        </div>
      </aside>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {me.supportSession && (
          <div role="status" style={{ background: "#7c2d12", color: "white", padding: "8px 24px", fontSize: 13, display: "flex", alignItems: "center", gap: 12 }}>
            <LifeBuoy size={15} aria-hidden />
            <span style={{ flex: 1 }}>
              <b>Support mode</b>: you are working inside {me.clients[0]?.name ?? "a client"} ({me.supportSession.reason}
              {me.supportSession.ticketRef ? `, ${me.supportSession.ticketRef}` : ""}). Everything you do is logged and visible to the client. Ends {new Date(me.supportSession.expiresAt).toLocaleTimeString()}.
            </span>
            <button style={{ ...btnGhost, padding: "5px 12px" }} onClick={() => exitSupport().then(() => navigate("/qc/organisations"))}>Leave support mode</button>
          </div>
        )}
        <header style={{ height: 56, flexShrink: 0, background: "white", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 16px", gap: 10 }}>
          <button className="qc-menu" aria-label="Open menu" aria-expanded={navOpen} onClick={() => setNavOpen(true)} style={{ display: "none", marginRight: "auto", width: 36, height: 36, borderRadius: 8, border: "1px solid #e5e7eb", background: "white", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 18 }}>☰</button>
          {me.isSA && !me.supportSession && (
            <button style={btnGhost} onClick={() => setSupportOpen(true)}><LifeBuoy size={13} aria-hidden style={{ verticalAlign: "-2px" }} /> Enter support mode</button>
          )}
          <Bell2 />
        </header>
        <main id="qc-main" tabIndex={-1} style={{ flex: 1, overflow: "auto", outline: "none" }}>
          {error && <div style={{ padding: "12px 32px" }}><ErrorNote message={error} /></div>}
          {needsClient ? <NeedsClient onEnter={() => setSupportOpen(true)} /> : <Outlet />}
        </main>
      </div>
      {supportOpen && <SupportDialog onClose={() => setSupportOpen(false)} />}
    </div>
  );
}

const footLink: React.CSSProperties = { display: "flex", alignItems: "center", gap: 9, padding: "8px 12px", borderRadius: 10, color: "#64748b", fontSize: 13, textDecoration: "none" };

function Centered({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f6fa", fontFamily: "Inter, sans-serif" }}>
      <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 14, padding: 28, width: 420, maxWidth: "calc(100vw - 32px)" }}>
        <h1 style={{ fontSize: 18, margin: "0 0 4px", color: "#1a2a4a" }}>{title}</h1>
        <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 16px" }}>{sub}</p>
        {children}
      </div>
    </div>
  );
}

function NeedsClient({ onEnter }: { onEnter: () => void }) {
  return (
    <div style={{ padding: "60px 32px", maxWidth: 560 }}>
      <Layers size={28} color="#94a3b8" aria-hidden />
      <h1 style={{ fontSize: 18, color: "#1a2a4a", margin: "12px 0 6px" }}>Choose a client to work in</h1>
      <p style={{ fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>
        A Super Admin sees a client's projects, defects and people only inside a support session. Start one with a reason; it is time limited, logged,
        and visible to that client.
      </p>
      <button style={btnPrimary} onClick={onEnter}>Enter support mode</button>
    </div>
  );
}

function SupportDialog({ onClose }: { onClose: () => void }) {
  const { enterSupport } = useQc();
  const navigate = useNavigate();
  const [clients, setClients] = useState<Array<{ id: string; label: string }>>([]);
  const [clientId, setClientId] = useState("");
  const [reason, setReason] = useState("");
  const [ticket, setTicket] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.qc.clients.list().then((c) => setClients(c.map((x) => ({ id: x.id, label: x.name })))).catch(() => undefined); }, []);
  return (
    <Modal title="Enter support mode" onClose={onClose} width={460}
      footer={<><button style={btnGhost} onClick={onClose}>Cancel</button>
        <button style={btnPrimary} disabled={busy || !clientId || reason.trim().length < 5} onClick={async () => {
          setBusy(true); setError(null);
          try { await enterSupport(clientId, reason.trim(), ticket.trim() || undefined); onClose(); navigate("/qc"); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
        }}>Start session</button></>}>
      <ErrorNote message={error} />
      <div style={{ display: "grid", gap: 12 }}>
        <Field label="Client" required><Select value={clientId} onChange={setClientId} options={clients} /></Field>
        <Field label="Reason" required><textarea style={{ ...inputStyle, minHeight: 70 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why do you need access?" /></Field>
        <Field label="Ticket reference"><input style={inputStyle} value={ticket} onChange={(e) => setTicket(e.target.value)} /></Field>
        <p style={{ fontSize: 12, color: "#64748b", margin: 0 }}>The session ends after an hour. The client can see it in their audit log.</p>
      </div>
    </Modal>
  );
}

/** The bell: unread count, the latest notices, and acknowledgement for Safety Hazard alerts. */
function Bell2() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const load = useCallback(async () => {
    try { const r = await qcx.notifications.list(); setItems(r.notifications.slice(0, 8)); setUnread(r.unread); } catch { /* signed out or no access */ }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);
  return (
    <div style={{ position: "relative" }}>
      <button aria-label={`Notifications, ${unread} unread`} onClick={() => setOpen((v) => !v)} style={{ width: 34, height: 34, borderRadius: 8, background: open ? "#eff6ff" : "#f8fafc", border: "1px solid #e5e7eb", cursor: "pointer", position: "relative" }}>
        <Bell size={15} color="#64748b" aria-hidden />
        {unread > 0 && <span style={{ position: "absolute", top: -5, right: -5, minWidth: 16, height: 16, borderRadius: 8, background: "#dc2626", color: "white", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 10 }} />
          <div style={{ position: "absolute", top: 42, right: 0, width: 340, zIndex: 11, background: "white", borderRadius: 10, border: "1px solid #e5e7eb", boxShadow: "0 8px 24px rgba(15,23,42,0.12)" }}>
            <div style={{ padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #f1f5f9" }}>
              <b style={{ fontSize: 13, color: "#1a2a4a" }}>Notifications</b>
              <button style={{ background: "none", border: "none", color: "#2563eb", fontSize: 12, cursor: "pointer" }} onClick={async () => { await qcx.notifications.readAll(); load(); }}>Mark all read</button>
            </div>
            <div style={{ maxHeight: 360, overflowY: "auto" }}>
              {items.length === 0 && <p style={{ padding: 14, margin: 0, fontSize: 12, color: "#94a3b8" }}>No notifications.</p>}
              {items.map((n) => (
                <div key={n.id} style={{ padding: "10px 14px", borderBottom: "1px solid #f8fafc", background: n.readAt ? "white" : "#f8fbff" }}>
                  <NotificationLink n={n} onGo={() => { setOpen(false); qcx.notifications.read(n.id).then(load); }} />
                  {n.mandatory && !n.ackedAt && n.type === "defect.safety_hazard" && (
                    <button style={{ ...btnPrimary, background: "#b91c1c", marginTop: 6, padding: "4px 10px" }} onClick={() => qcx.notifications.ack(n.id).then(load)}>Acknowledge</button>
                  )}
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>{new Date(n.createdAt).toLocaleString()}</div>
                </div>
              ))}
            </div>
            <Link to="/qc/notifications" onClick={() => setOpen(false)} style={{ display: "block", padding: 10, textAlign: "center", fontSize: 12, color: "#2563eb", textDecoration: "none" }}>See all and set preferences</Link>
          </div>
        </>
      )}
    </div>
  );
}

export function notificationPath(n: Pick<Notification, "entityType" | "entityId">): string | null {
  if (!n.entityId) return null;
  if (n.entityType === "QcDefect") return `/qc/defects/${n.entityId}`;
  if (n.entityType === "QcInspection") return `/qc/inspections/${n.entityId}`;
  if (n.entityType === "QcProject") return `/qc/projects/${n.entityId}`;
  if (n.entityType === "QcTemplate") return `/qc/templates/${n.entityId}`;
  return null;
}

export function NotificationLink({ n, onGo }: { n: Notification; onGo?: () => void }) {
  const to = notificationPath(n);
  const text = <span style={{ fontSize: 13, color: "#1a2a4a", fontWeight: n.readAt ? 400 : 600 }}>{n.title}</span>;
  return to ? <Link to={to} onClick={onGo} style={{ textDecoration: "none" }}>{text}</Link> : text;
}
