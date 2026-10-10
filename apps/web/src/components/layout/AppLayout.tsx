import { CheckCircle, List, UploadSimple } from '@phosphor-icons/react';
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useUIStore } from '../../stores/uiStore';
import { Sidebar } from './Sidebar';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { sidebarOpen, setSidebarOpen, toast } = useUIStore();
  const location = useLocation();
  const navigate = useNavigate();
  const section = location.pathname.split('/')[1];
  const pageMeta = {
    '': { title: '工作台', description: '关键流程、质量信号与最近执行' },
    capabilities: { title: '能力地图', description: '了解平台能力、自动化边界与当前工作区状态' },
    workflows: { title: '业务流程', description: '编排多接口流程、变量与清理步骤' },
    apis: { title: '接口管理', description: '管理接口定义，支持 OpenAPI 导入与手动录入' },
    import: { title: '导入中心', description: '预检来源并写入接口资产' },
    cases: { title: '用例管理', description: '维护契约、AI 与人工创建的测试资产' },
    plans: { title: '测试计划', description: '组合关键流程并设置质量门禁' },
    environments: { title: '环境管理', description: '隔离 Base URL、变量覆盖与运行环境' },
    variables: { title: '变量管理', description: '按环境和流程作用域管理变量与 Secret 引用' },
    reports: { title: '报告中心', description: '查看运行结果、证据与失败上下文' },
    agent: { title: '智能生成', description: '从 GitHub 代码或 API 契约生成有来源的测试草稿' },
  }[section] ?? { title: 'SketchTest', description: '' };

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [setSidebarOpen]);

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
          <div className="topbar-title">
            <div className="topbar-title__identity">
              <span className="eyebrow">回归测试</span>
              <strong className="topbar-page-name">{pageMeta.title}</strong>
            </div>
            {pageMeta.description ? (
              <p className="topbar-description">{pageMeta.description}</p>
            ) : null}
          </div>
          <div className="topbar-actions">
            <button
              className="button button--ghost button--sm"
              type="button"
              onClick={() => navigate('/import')}
            >
              <UploadSimple size={16} />
              导入
            </button>
          </div>
        </header>
        {children}
      </div>
      <div className={`toast ${toast ? 'toast--visible' : ''}`} role="status" aria-live="polite">
        <CheckCircle size={18} weight="fill" />
        {toast}
      </div>
    </div>
  );
}
