"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { clearToken, getRole } from "./api";
import type { JobStatus, SummaryStatus } from "./types";

const ROLE_LABEL: Record<string, string> = {
  INSPECTOR: "Inspector",
  REVIEWER: "Reviewer",
  ADMIN: "Admin",
};

export function TopBar() {
  const router = useRouter();
  const pathname = usePathname();
  // Read after mount: localStorage isn't available during SSR, and rendering a
  // different label on the server would trip a hydration mismatch.
  const [role, setRoleState] = useState<string | null>(null);
  useEffect(() => setRoleState(getRole()), []);

  return (
    <div className="topbar">
      <div className="row" style={{ gap: 20 }}>
        <div className="brand">
          ACE <span>SPECT</span>
          {role ? ` · ${ROLE_LABEL[role] ?? role}` : ""}
        </div>
        {/* QC is admin-only — enforced again server-side by requireRole('ADMIN') on every /qc/* write route. */}
        {role === "ADMIN" && (
          <nav className="row" style={{ gap: 4 }}>
            <TopBarLink href="/inspections" active={pathname.startsWith("/inspections")}>
              Inspections
            </TopBarLink>
            <TopBarLink href="/qc" active={pathname.startsWith("/qc")}>
              QC
            </TopBarLink>
          </nav>
        )}
      </div>
      <button
        onClick={() => {
          clearToken();
          router.push("/login");
        }}
      >
        Sign out
      </button>
    </div>
  );
}

function TopBarLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push(href)}
      className={active ? "toggle-btn active" : "toggle-btn"}
      style={{ padding: "6px 14px", fontSize: 13 }}
    >
      {children}
    </button>
  );
}

/** Sub-nav for the QC section's own pages. */
export function QcNav() {
  const router = useRouter();
  const pathname = usePathname();
  const tabs: { href: string; label: string }[] = [
    { href: "/qc", label: "Defects" },
    { href: "/qc/new", label: "+ New Defect" },
    { href: "/qc/config", label: "Configuration" },
    { href: "/qc/users", label: "Field Users" },
  ];
  return (
    <div className="toggle-row" style={{ marginBottom: 20 }}>
      {tabs.map((t) => (
        <button
          key={t.href}
          onClick={() => router.push(t.href)}
          className={pathname === t.href ? "toggle-btn active" : "toggle-btn"}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function JobBadge({ status }: { status: JobStatus | null }) {
  if (!status) return <span className="badge slate">no job</span>;
  const cls =
    status === "DONE" ? "green" : status === "FAILED" ? "red" : "amber";
  return <span className={`badge ${cls}`}>{status.toLowerCase()}</span>;
}

export function SummaryBadge({ status }: { status: SummaryStatus | null | undefined }) {
  if (!status) return <span className="badge slate">—</span>;
  const cls =
    status === "APPROVED"
      ? "green"
      : status === "REJECTED"
        ? "red"
        : status === "EDITED"
          ? "brand"
          : "amber";
  return <span className={`badge ${cls}`}>{status.toLowerCase()}</span>;
}

/** Risk score colour: low < 34 (green), 34–66 (amber), > 66 (red). */
export function RiskBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="muted">—</span>;
  const cls = score > 66 ? "red" : score >= 34 ? "amber" : "green";
  return <span className={`badge ${cls}`}>{score}</span>;
}
