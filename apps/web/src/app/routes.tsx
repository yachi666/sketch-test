import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { ApiManagementPage } from '../pages/ApiManagement';
import { LoginPage } from '../pages/Login';
import { RunsPage } from '../pages/Runs';
import { WorkflowsPage } from '../pages/Workflows';
import { useAuthStore } from '../stores/authStore';

function ProtectedProductRoutes() {
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Navigate to="/apis" replace />} />
        <Route path="/apis" element={<ApiManagementPage />} />
        <Route path="/workflows" element={<WorkflowsPage />} />
        <Route path="/runs" element={<RunsPage />} />
        <Route path="*" element={<Navigate to="/apis" replace />} />
      </Routes>
    </AppLayout>
  );
}

export function AppRoutes() {
  const token = useAuthStore((state) => state.token);
  const hydrated = useAuthStore((state) => state.hydrated);

  if (!hydrated) {
    return <main className="auth-loading">正在验证会话…</main>;
  }

  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/apis" replace /> : <LoginPage />} />
      <Route
        path="*"
        element={token ? <ProtectedProductRoutes /> : <Navigate to="/login" replace />}
      />
    </Routes>
  );
}
