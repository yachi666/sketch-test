import {
  BracketsCurly,
  CalendarCheck,
  ChartBar,
  ClipboardText,
  Cube,
  FileArrowUp,
  FlowArrow,
  House,
  MapTrifold,
  PlugsConnected,
  Robot,
  Stack,
  X,
} from '@phosphor-icons/react';
import type { ElementType } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const navItems: Array<{ path: string; label: string; icon: ElementType; accent?: boolean }> = [
  { path: '/', label: '工作台', icon: House },
  { path: '/capabilities', label: '能力地图', icon: MapTrifold },
  { path: '/workflows', label: '业务流程', icon: FlowArrow },
  { path: '/apis', label: '接口管理', icon: PlugsConnected },
  { path: '/import', label: '导入中心', icon: FileArrowUp },
  { path: '/cases', label: '用例管理', icon: ClipboardText },
  { path: '/plans', label: '测试计划', icon: CalendarCheck },
  { path: '/environments', label: '环境管理', icon: Stack },
  { path: '/variables', label: '变量管理', icon: BracketsCurly },
  { path: '/reports', label: '报告中心', icon: ChartBar },
  { path: '/agent', label: '智能生成', icon: Robot },
];

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <>
      <aside className={`sidebar ${open ? 'sidebar--open' : ''}`} aria-label="主导航">
        <div className="brand-lockup">
          <span className="brand-mark">
            <Cube size={28} weight="duotone" />
          </span>
          <span>
            <strong>SketchTest</strong>
            <small>API 自动化测试平台</small>
          </span>
          <button className="mobile-close" type="button" onClick={onClose} aria-label="关闭导航">
            <X size={20} />
          </button>
        </div>

        <nav className="nav-group" aria-label="主导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <button
                key={item.path}
                type="button"
                className={`nav-item ${active ? 'nav-item--active' : ''}`}
                onClick={() => {
                  navigate(item.path);
                  onClose();
                }}
                aria-current={active ? 'page' : undefined}
              >
                <Icon size={20} weight={active ? 'duotone' : 'regular'} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>
      {open ? (
        <div
          className="sidebar-overlay"
          role="presentation"
          onMouseDown={onClose}
          aria-hidden="true"
        />
      ) : null}
    </>
  );
}
