import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { AppDataProvider, useAppData } from "./web/data";
import { RoleSelect } from "./web/pages/RoleSelect";
import { WebLayout } from "./web/components/WebLayout";
import { ReviewerDashboard } from "./web/pages/reviewer/ReviewerDashboard";
import { ReviewerInspections } from "./web/pages/reviewer/ReviewerInspections";
import { ReviewerFormView } from "./web/pages/reviewer/ReviewerFormView";
import { InspectorDashboard } from "./web/pages/inspector/InspectorDashboard";
import { InspectorFormEditor } from "./web/pages/inspector/InspectorFormEditor";
import { AdminDashboard } from "./web/pages/admin/AdminDashboard";
import { AdminInspections } from "./web/pages/admin/AdminInspections";
import { AdminUsers } from "./web/pages/admin/AdminUsers";
import { AdminTemplateProfiles } from "./web/pages/admin/AdminTemplateProfiles";
import { AdminTemplateSections } from "./web/pages/admin/AdminTemplateSections";
import { AdminTemplateAdoption } from "./web/pages/admin/AdminTemplateAdoption";
import { AdminTemplateEditor } from "./web/pages/admin/AdminTemplateEditor";
import { ReportView } from "./web/pages/ReportView";
import type { Role } from "./web/mockData";

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

export default function App() {
  return (
    <AppDataProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<RoleSelect />} />

          {/* Generated report — full screen (no app chrome) so it prints clean */}
          <Route path="/report/:id" element={<ReportView />} />

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
            <Route path="/admin/reports" element={<Placeholder title="Reports" />} />
            <Route path="/admin/settings" element={<Placeholder title="Settings" />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AppDataProvider>
  );
}
