import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { AgentPage } from '../pages/Agent';
import { ApiManagementPage } from '../pages/ApiManagement';
import { CapabilitiesPage } from '../pages/Capabilities';
import { CasesPage } from '../pages/Cases';
import DashboardOverview from '../pages/Dashboard';
import EnvironmentView from '../pages/Environments';
import { ImportPage } from '../pages/Import';
import { PlansPage } from '../pages/Plans';
import { ReportsDetailWrapper, ReportsPage } from '../pages/Reports';
import VariablesView from '../pages/Variables';
import WorkflowsPage from '../pages/Workflows';

function ProductRoutes() {
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<DashboardOverview />} />
        <Route path="/capabilities" element={<CapabilitiesPage />} />
        <Route path="/apis" element={<ApiManagementPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/cases" element={<CasesPage />} />
        <Route path="/agent" element={<AgentPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/reports/:runId/:legacyWorkflowId?" element={<ReportsDetailWrapper />} />
        <Route path="/variables" element={<VariablesView />} />
        <Route path="/environments" element={<EnvironmentView />} />
        <Route path="/workflows" element={<WorkflowsPage />} />
        <Route path="/workflows/:id" element={<WorkflowsPage />} />
        <Route path="/plans" element={<PlansPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppLayout>
  );
}

export function AppRoutes() {
  return <ProductRoutes />;
}
