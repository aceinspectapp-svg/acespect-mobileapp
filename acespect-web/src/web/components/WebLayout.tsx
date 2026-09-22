import { useState } from "react";
import { Link, Outlet, useNavigate, useLocation } from "react-router";
import {
  LayoutDashboard, FileText, Users, Settings, LogOut,
  Bell, BarChart3, ClipboardCheck,
} from "lucide-react";
import { AcespectLogo } from "../../components/AcespectLogo";
import { useAppData } from "../data";
import type { Role } from "../mockData";

const ROLE_NAV: Record<Role, { to: string; icon: React.ElementType; label: string }[]> = {
  reviewer: [
    { to: "/reviewer/dashboard",   icon: LayoutDashboard, label: "Dashboard" },
    { to: "/reviewer/inspections", icon: ClipboardCheck,  label: "Inspections" },
  ],
  inspector: [
    { to: "/inspector/dashboard", icon: LayoutDashboard, label: "Dashboard" },
    { to: "/inspector/forms",     icon: ClipboardCheck,   label: "Inspections" },
  ],
  admin: [
    { to: "/admin/dashboard",   icon: LayoutDashboard, label: "Dashboard" },
    { to: "/admin/inspections", icon: ClipboardCheck,  label: "Inspections" },
    { to: "/admin/templates",   icon: FileText,         label: "Templates" },
    { to: "/admin/users",       icon: Users,            label: "Users" },
    { to: "/admin/reports",     icon: BarChart3,        label: "Reports" },
    { to: "/admin/settings",    icon: Settings,         label: "Settings" },
  ],
};

const ROLE_META: Record<Role, { label: string; color: string; bg: string }> = {
  reviewer:  { label: "Reviewer",  color: "#2563eb", bg: "#eff6ff" },
  inspector: { label: "Inspector", color: "#16a34a", bg: "#f0fdf4" },
  admin:     { label: "Admin",     color: "#7c3aed", bg: "#faf5ff" },
};

export function WebLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser, logout } = useAppData();
  const [showNotifications, setShowNotifications] = useState(false);
  const role: Role = currentUser?.role ?? "reviewer";
  const nav = ROLE_NAV[role];
  const rm = ROLE_META[role];
  const displayName = currentUser?.name ?? currentUser?.email ?? "";
  const avatar = (currentUser?.name ?? currentUser?.email ?? "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div style={{
      display: "flex", height: "100vh",
      background: "#f5f6fa",
      fontFamily: "Inter, -apple-system, sans-serif",
    }}>
      {/* Sidebar */}
      <aside style={{
        width: "220px", flexShrink: 0,
        background: "white",
        borderRight: "1px solid #e5e7eb",
        display: "flex", flexDirection: "column",
        height: "100vh", position: "sticky", top: 0,
      }}>
        {/* Logo */}
        <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid #f1f5f9" }}>
          <AcespectLogo size="sm" />
          <p style={{ fontSize: "10px", color: "#94a3b8", margin: "6px 0 0", fontWeight: 500 }}>Review Portal</p>
        </div>

        {/* User chip */}
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #f1f5f9" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 10px", borderRadius: "10px", background: "#f8fafc" }}>
            <div style={{
              width: "32px", height: "32px", borderRadius: "50%",
              background: rm.bg, color: rm.color,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "11px", fontWeight: 700, flexShrink: 0,
            }}>
              {avatar}
            </div>
            <div style={{ overflow: "hidden" }}>
              <p style={{ fontSize: "12px", fontWeight: 600, color: "#1a2a4a", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {displayName}
              </p>
              <span style={{ fontSize: "10px", fontWeight: 700, color: rm.color }}>{rm.label}</span>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: "10px 12px", display: "flex", flexDirection: "column", gap: "2px" }}>
          {nav.map(({ to, icon: Icon, label }) => {
            const isActive = location.pathname === to || location.pathname.startsWith(to + "/");
            return (
              <Link key={to} to={to} style={{
                display: "flex", alignItems: "center", gap: "10px",
                padding: "9px 12px", borderRadius: "10px",
                textDecoration: "none",
                background: isActive ? "#f0f4ff" : "transparent",
                color: isActive ? "#2563eb" : "#64748b",
                fontSize: "13px", fontWeight: isActive ? 600 : 400,
                borderLeft: isActive ? "3px solid #2563eb" : "3px solid transparent",
                transition: "all 0.15s",
              }}>
                <Icon size={15} strokeWidth={isActive ? 2.2 : 1.8} />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Sign out */}
        <div style={{ padding: "12px", borderTop: "1px solid #f1f5f9" }}>
          <button
            onClick={() => { logout(); navigate("/"); }}
            style={{
              display: "flex", alignItems: "center", gap: "9px", width: "100%",
              padding: "9px 12px", borderRadius: "10px",
              background: "transparent", border: "none",
              color: "#94a3b8", fontSize: "13px", cursor: "pointer",
              transition: "all 0.15s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "#fef2f2"; (e.currentTarget as HTMLButtonElement).style.color = "#e63329"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "#94a3b8"; }}
          >
            <LogOut size={15} strokeWidth={1.8} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {/* Top bar */}
        <header style={{
          height: "56px", flexShrink: 0,
          background: "white",
          borderBottom: "1px solid #e5e7eb",
          display: "flex", alignItems: "center",
          justifyContent: "flex-end",
          padding: "0 24px", gap: "10px",
        }}>
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setShowNotifications((v) => !v)}
              style={{
                width: "34px", height: "34px", borderRadius: "8px",
                background: showNotifications ? "#eff6ff" : "#f8fafc",
                border: `1px solid ${showNotifications ? "#93c5fd" : "#e5e7eb"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", position: "relative",
              }}
            >
              <Bell size={15} color="#64748b" strokeWidth={1.8} />
              <span style={{ position: "absolute", top: "8px", right: "8px", width: "6px", height: "6px", borderRadius: "50%", background: "#e63329", border: "1.5px solid white" }} />
            </button>
            {showNotifications && (
              <>
                {/* Click-away catcher */}
                <div onClick={() => setShowNotifications(false)} style={{ position: "fixed", inset: 0, zIndex: 10 }} />
                <div style={{
                  position: "absolute", top: "42px", right: 0, width: "260px", zIndex: 11,
                  background: "white", borderRadius: "10px", border: "1px solid #e5e7eb",
                  boxShadow: "0 8px 24px rgba(15,23,42,0.12)", padding: "14px 16px",
                }}>
                  <p style={{ fontSize: "12px", fontWeight: 700, color: "#1a2a4a", margin: "0 0 4px" }}>Notifications</p>
                  <p style={{ fontSize: "12px", color: "#94a3b8", margin: 0 }}>No new notifications.</p>
                </div>
              </>
            )}
          </div>
        </header>

        {/* Page */}
        <main style={{ flex: 1, overflow: "auto" }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/* ─── Shared page shell ──────────────────────────────────────────── */
export function PageShell({ title, subtitle, actions, children }: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{ padding: "28px 32px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#1a2a4a", margin: 0 }}>{title}</h1>
          {subtitle && <p style={{ fontSize: "13px", color: "#94a3b8", margin: "4px 0 0" }}>{subtitle}</p>}
        </div>
        {actions && <div style={{ display: "flex", gap: "8px" }}>{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/* ─── Status badge ───────────────────────────────────────────────── */
export function StatusBadge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span style={{ fontSize: "11px", fontWeight: 700, padding: "3px 9px", borderRadius: "20px", background: bg, color, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

/* ─── Stat card ──────────────────────────────────────────────────── */
export function StatCard({ label, value, sub, color = "#2563eb", icon }: {
  label: string; value: string | number; sub?: string; color?: string; icon?: React.ReactNode;
}) {
  return (
    <div style={{
      background: "white", borderRadius: "12px",
      padding: "18px 22px", border: "1px solid #e5e7eb",
      boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
        <span style={{ fontSize: "12px", fontWeight: 500, color: "#94a3b8" }}>{label}</span>
        {icon && (
          <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: color + "15", display: "flex", alignItems: "center", justifyContent: "center", color }}>
            {icon}
          </div>
        )}
      </div>
      <p style={{ fontSize: "26px", fontWeight: 800, color: "#1a2a4a", margin: 0 }}>{value}</p>
      {sub && <p style={{ fontSize: "11px", color: "#94a3b8", margin: "4px 0 0" }}>{sub}</p>}
    </div>
  );
}

/* ─── Card wrapper ───────────────────────────────────────────────── */
export function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: "white", borderRadius: "12px",
      border: "1px solid #e5e7eb",
      boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
      ...style,
    }}>
      {children}
    </div>
  );
}

/* ─── Primary button ─────────────────────────────────────────────── */
export function PrimaryBtn({ children, onClick, color = "#1a2a4a" }: {
  children: React.ReactNode; onClick?: () => void; color?: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 16px", borderRadius: "8px",
        background: color, color: "white",
        fontSize: "13px", fontWeight: 600,
        border: "none", cursor: "pointer",
        display: "flex", alignItems: "center", gap: "6px",
        boxShadow: `0 2px 8px ${color}30`,
      }}
    >
      {children}
    </button>
  );
}

/* ─── Ghost button ───────────────────────────────────────────────── */
export function GhostBtn({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 14px", borderRadius: "8px",
        background: "white", color: "#374151",
        fontSize: "13px", fontWeight: 500,
        border: "1px solid #e5e7eb", cursor: "pointer",
        display: "flex", alignItems: "center", gap: "6px",
      }}
    >
      {children}
    </button>
  );
}

/* ─── Table ──────────────────────────────────────────────────────── */
export function TableCard({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div style={{ background: "white", borderRadius: "12px", border: "1px solid #e5e7eb", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#f8fafc" }}>
            {headers.map(h => (
              <th key={h} style={{ padding: "11px 16px", textAlign: "left", fontSize: "11px", fontWeight: 600, color: "#94a3b8", letterSpacing: "0.04em", textTransform: "uppercase", borderBottom: "1px solid #e5e7eb" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
