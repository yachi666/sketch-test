import { List, SignOut } from '@phosphor-icons/react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { Sidebar } from './Sidebar';

/** Product shell exposing only routes backed by current Control Plane data. */
export function AppLayout({ children }: { children: React.ReactNode }) {
  const { sidebarOpen, setSidebarOpen } = useUIStore();
  const user = useAuthStore((state) => state.user);
  const clearSession = useAuthStore((state) => state.clearSession);
  const location = useLocation();
  const navigate = useNavigate();
  const title = location.pathname.startsWith('/workflows')
    ? '流程执行'
    : location.pathname.startsWith('/runs')
      ? '运行报告'
      : '接口管理';

  return (
    <div className="app-shell">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="app-main">
        <header className="topbar">
          <button
            className="mobile-menu"
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="打开导航"
          >
            <List size={22} />
          </button>
          <div>
            <span className="eyebrow">CONTROL PLANE</span>
            <strong>{title}</strong>
          </div>
          <div className="session-summary">
            <span>{user?.displayName || user?.email}</span>
            <small>{user?.role}</small>
            <button
              className="logout-button"
              type="button"
              onClick={() => {
                clearSession();
                navigate('/login', { replace: true });
              }}
            >
              <SignOut size={17} />
              退出
            </button>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
