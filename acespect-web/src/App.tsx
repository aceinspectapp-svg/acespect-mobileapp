import { Component, lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { AppDataProvider, useAppData } from "./web/data";
import { RoleSelect } from "./web/pages/RoleSelect";
import { WebLayout } from "./web/components/WebLayout";
import { QcLayout } from "./web/components/QcLayout";
import { useQc } from "./web/qcContext";
import { SsoCallback } from "./web/components/SignInSteps";
import type { Role } from "./web/mockData";

/**
 * Every screen except sign-in is loaded the first time it is opened, not up front: the whole app used to be one 900 KB file that every
 * visitor (and the PDF renderer) had to download before seeing anything.
 */
function lazyPage(load: () => Promise<Record<string, unknown>>, name: string) {
  return lazy(() => load().then((m) => ({ default: m[name] as ComponentType })));
}
const ReviewerDashboard = lazyPage(() => import("./web/pages/reviewer/ReviewerDashboard"), "ReviewerDashboard");
const ReviewerInspections = lazyPage(() => import("./web/pages/reviewer/ReviewerInspections"), "ReviewerInspections");
const ReviewerFormView = lazyPage(() => import("./web/pages/reviewer/ReviewerFormView"), "ReviewerFormView");
const InspectorDashboard = lazyPage(() => import("./web/pages/inspector/InspectorDashboard"), "InspectorDashboard");
const InspectorFormEditor = lazyPage(() => import("./web/pages/inspector/InspectorFormEditor"), "InspectorFormEditor");
const AdminDashboard = lazyPage(() => import("./web/pages/admin/AdminDashboard"), "AdminDashboard");
const AdminInspections = lazyPage(() => import("./web/pages/admin/AdminInspections"), "AdminInspections");
const AdminUsers = lazyPage(() => import("./web/pages/admin/AdminUsers"), "AdminUsers");
const AdminTemplateProfiles = lazyPage(() => import("./web/pages/admin/AdminTemplateProfiles"), "AdminTemplateProfiles");
const AdminTemplateSections = lazyPage(() => import("./web/pages/admin/AdminTemplateSections"), "AdminTemplateSections");
const AdminTemplateAdoption = lazyPage(() => import("./web/pages/admin/AdminTemplateAdoption"), "AdminTemplateAdoption");
const AdminTemplateEditor = lazyPage(() => import("./web/pages/admin/AdminTemplateEditor"), "AdminTemplateEditor");
const AdminQcDefects = lazyPage(() => import("./web/pages/admin/AdminQcDefects"), "AdminQcDefects");
const AdminQcDefectDetail = lazyPage(() => import("./web/pages/admin/AdminQcDefectDetail"), "AdminQcDefectDetail");
const AdminQcProjects = lazyPage(() => import("./web/pages/admin/AdminQcProjects"), "AdminQcProjects");
const AdminQcProjectDetail = lazyPage(() => import("./web/pages/admin/AdminQcProjects"), "AdminQcProjectDetail");
const AdminQcOrganisations = lazyPage(() => import("./web/pages/admin/AdminQcOrganisations"), "AdminQcOrganisations");
const AdminQcPeople = lazyPage(() => import("./web/pages/admin/AdminQcPeople"), "AdminQcPeople");
const AdminSubmissionLogs = lazyPage(() => import("./web/pages/admin/AdminSubmissionLogs"), "AdminSubmissionLogs");
const AdminAuditLog = lazyPage(() => import("./web/pages/admin/AdminAuditLog"), "AdminAuditLog");
const ReportView = lazyPage(() => import("./web/pages/ReportView"), "ReportView");
const AcceptInvitation = lazyPage(() => import("./web/pages/AuthPages"), "AcceptInvitation");
const ForgotPassword = lazyPage(() => import("./web/pages/AuthPages"), "ForgotPassword");
const ResetPassword = lazyPage(() => import("./web/pages/AuthPages"), "ResetPassword");
const QcDashboard = lazyPage(() => import("./web/pages/portal/QcDashboard"), "QcDashboard");
const QcInspections = lazyPage(() => import("./web/pages/portal/QcInspections"), "QcInspections");
const QcInspectionDetail = lazyPage(() => import("./web/pages/portal/QcInspectionDetail"), "QcInspectionDetail");
const QcTemplates = lazyPage(() => import("./web/pages/portal/QcTemplates"), "QcTemplates");
const QcTemplateDetail = lazyPage(() => import("./web/pages/portal/QcTemplates"), "QcTemplateDetail");
const QcPolicy = lazyPage(() => import("./web/pages/portal/QcPolicy"), "QcPolicy");
const QcReports = lazyPage(() => import("./web/pages/portal/QcReports"), "QcReports");
const QcNotifications = lazyPage(() => import("./web/pages/portal/QcAdminPages"), "QcNotifications");
const QcAudit = lazyPage(() => import("./web/pages/portal/QcAdminPages"), "QcAudit");
const QcSettings = lazyPage(() => import("./web/pages/portal/QcAdminPages"), "QcSettings");
const QcPrivacy = lazyPage(() => import("./web/pages/portal/QcAdminPages"), "QcPrivacy");
const QcAccount = lazyPage(() => import("./web/pages/portal/QcAdminPages"), "QcAccount");

const Loading = () => <div style={{ padding: 40, fontFamily: "Inter, sans-serif", color: "#94a3b8" }}>Loading…</div>;

/**
 * After a new version is published the old screens' files are gone, so a tab left open from before cannot load a screen it has not opened
 * yet. Reload once to pick up the new version; if it still fails, say so instead of showing a blank page.
 */
class ChunkBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    const stale = /dynamically imported module|Importing a module script failed|Loading chunk|Unexpected token '<'/i.test(error?.message ?? "");
    try {
      if (stale && !sessionStorage.getItem("chunk-reloaded")) {
        sessionStorage.setItem("chunk-reloaded", "1");
        window.location.reload();
      }
    } catch {
      /* storage blocked: fall through to the message */
    }
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div style={{ padding: 40, fontFamily: "Inter, sans-serif", color: "#475569" }}>
        <p style={{ fontSize: 16, fontWeight: 600 }}>This page could not be loaded.</p>
        <p style={{ fontSize: 13 }}>A new version may have just been released. Reload to continue.</p>
        <button onClick={() => { try { sessionStorage.removeItem("chunk-reloaded"); } catch { /* ignore */ } window.location.reload(); }} style={{ marginTop: 12, padding: "8px 16px", borderRadius: 8, border: "none", background: "#1a2a4a", color: "white", cursor: "pointer" }}>
          Reload
        </button>
      </div>
    );
  }
}

function Placeholder({ title }: { title: string }) {
  return (
    <div style={{ padding: "40px 32px", fontFamily: "Inter, sans-serif" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "#1a2a4a", margin: 0 }}>{title}</h1>
      <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 6 }}>This section is coming soon.</p>
    </div>
  );
}

/** Gate a role's route group; renders the shared WebLayout (which reads the user from context). */
function Protected({ role }: { role: Role }) {
  const { currentUser, loading } = useAppData();
  if (loading) {
    return (
      <div style={{ padding: 40, fontFamily: "Inter, sans-serif", color: "#94a3b8" }}>Loading…</div>
    );
  }
  if (!currentUser) return <Navigate to="/" replace />;
  if (currentUser.role !== role) return <Navigate to={`/${currentUser.role}/dashboard`} replace />;
  return <WebLayout />;
}

/** Anyone signed in may enter the QC area; what they see is decided by their role's capabilities. */
function QcGate() {
  const { currentUser, loading } = useAppData();
  if (loading) return <div style={{ padding: 40, fontFamily: "Inter, sans-serif", color: "#94a3b8" }}>Loading…</div>;
  if (!currentUser) return <Navigate to="/" replace />;
  return <QcLayout />;
}

/** The first page a role has: the dashboard, or its work list if it has no dashboard. */
function QcIndex() {
  const { can } = useQc();
  if (can("reports.dashboard")) return <QcDashboard />;
  return <Navigate to={can("defects.view") ? "/qc/defects" : "/qc/account"} replace />;
}

export default function App() {
  return (
    <AppDataProvider>
      <BrowserRouter>
        <ChunkBoundary>
        <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<RoleSelect />} />

          {/* Generated report — full screen (no app chrome) so it prints clean */}
          <Route path="/report/:id" element={<ReportView />} />

          {/* Account activation, password reset and single sign-on callback: no app chrome */}
          <Route path="/accept/:token" element={<AcceptInvitation />} />
          <Route path="/forgot" element={<ForgotPassword />} />
          <Route path="/reset/:token" element={<ResetPassword />} />
          <Route path="/sso-callback" element={<SsoCallback />} />

          {/* The QC area: every role, scoped by its capabilities */}
          <Route element={<QcGate />}>
            <Route path="/qc" element={<QcIndex />} />
            <Route path="/qc/defects" element={<AdminQcDefects />} />
            <Route path="/qc/defects/:id" element={<AdminQcDefectDetail />} />
            <Route path="/qc/projects" element={<AdminQcProjects />} />
            <Route path="/qc/projects/:id" element={<AdminQcProjectDetail />} />
            <Route path="/qc/organisations" element={<AdminQcOrganisations />} />
            <Route path="/qc/people" element={<AdminQcPeople />} />
            <Route path="/qc/inspections" element={<QcInspections />} />
            <Route path="/qc/inspections/:id" element={<QcInspectionDetail />} />
            <Route path="/qc/templates" element={<QcTemplates />} />
            <Route path="/qc/templates/:id" element={<QcTemplateDetail />} />
            <Route path="/qc/policy" element={<QcPolicy />} />
            <Route path="/qc/reports" element={<QcReports />} />
            <Route path="/qc/audit" element={<QcAudit />} />
            <Route path="/qc/settings" element={<QcSettings />} />
            <Route path="/qc/privacy" element={<QcPrivacy />} />
            <Route path="/qc/notifications" element={<QcNotifications />} />
            <Route path="/qc/account" element={<QcAccount />} />
          </Route>

          <Route element={<Protected role="reviewer" />}>
            <Route path="/reviewer/dashboard" element={<ReviewerDashboard />} />
            <Route path="/reviewer/inspections" element={<ReviewerInspections />} />
            <Route path="/reviewer/review/:id" element={<ReviewerFormView />} />
          </Route>

          <Route element={<Protected role="inspector" />}>
            <Route path="/inspector/dashboard" element={<InspectorDashboard />} />
            <Route path="/inspector/forms" element={<InspectorDashboard />} />
            <Route path="/inspector/form/:id" element={<InspectorFormEditor />} />
          </Route>

          <Route element={<Protected role="admin" />}>
            <Route path="/admin/dashboard" element={<AdminDashboard />} />
            <Route path="/admin/inspections" element={<AdminInspections />} />
            <Route path="/admin/inspections/:id" element={<ReviewerFormView />} />
            <Route path="/admin/users" element={<AdminUsers />} />
            <Route path="/admin/templates" element={<AdminTemplateProfiles />} />
            <Route path="/admin/templates/:inspectionType/:propertyType" element={<AdminTemplateSections />} />
            <Route path="/admin/templates/:inspectionType/:propertyType/adoption" element={<AdminTemplateAdoption />} />
            <Route path="/admin/templates/:inspectionType/:propertyType/:sectionKey/:id" element={<AdminTemplateEditor />} />
            <Route path="/admin/qc" element={<Navigate to="/qc" replace />} />
            <Route path="/admin/qc/*" element={<Navigate to="/qc" replace />} />
            <Route path="/admin/reports" element={<Placeholder title="Reports" />} />
            <Route path="/admin/troubleshoot" element={<AdminSubmissionLogs />} />
            <Route path="/admin/audit" element={<AdminAuditLog />} />
            <Route path="/admin/settings" element={<Placeholder title="Settings" />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
        </ChunkBoundary>
      </BrowserRouter>
    </AppDataProvider>
  );
}
