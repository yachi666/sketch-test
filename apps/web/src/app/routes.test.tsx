import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { cpClient, type RunReport } from '../lib/cp-client';
import { useAuthStore } from '../stores/authStore';
import { AppRoutes } from './routes';

vi.mock('../lib/cp-client', () => ({
  cpClient: {
    listRuns: vi.fn(),
    getReport: vi.fn(),
    listWorkflows: vi.fn(),
    listTestCases: vi.fn(),
    listApiVersions: vi.fn(),
  },
}));

const report: RunReport = {
  run: {
    id: 'run-001',
    apiVersionId: null,
    workflowVersionId: 'wv-001',
    testCaseVersionId: null,
    status: 'passed',
    runnerId: 'runner-001',
    claimedAt: '2026-07-22T10:00:00.000Z',
    createdAt: '2026-07-22T10:00:00.000Z',
    finishedAt: '2026-07-22T10:00:01.000Z',
  },
  steps: [],
};

function renderRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('product routes', () => {
  beforeEach(() => {
    vi.mocked(cpClient.listRuns).mockReset();
    vi.mocked(cpClient.getReport).mockReset();
    vi.mocked(cpClient.listWorkflows).mockReset();
    vi.mocked(cpClient.listTestCases).mockReset();
    vi.mocked(cpClient.listApiVersions).mockReset();
    vi.mocked(cpClient.listRuns).mockResolvedValue({
      runs: [],
      total: 0,
      page: 1,
      pageSize: 20,
      summary: { total: 0, passed: 0, failed: 0, active: 0, unresolved: 0, cancelled: 0, other: 0 },
    });
    vi.mocked(cpClient.getReport).mockResolvedValue(report);
    vi.mocked(cpClient.listWorkflows).mockResolvedValue({ workflows: [] });
    vi.mocked(cpClient.listTestCases).mockResolvedValue({ testCases: [] });
    vi.mocked(cpClient.listApiVersions).mockResolvedValue({ apiVersions: [] });
    useAuthStore.setState({
      token: 'test-token',
      hydrated: true,
      user: {
        id: 'usr-owner',
        email: 'owner@example.test',
        displayName: 'Owner',
        role: 'owner',
        workspaceId: 'ws-primary',
      },
    });
  });

  test('redirects the removed login route to the product dashboard', () => {
    useAuthStore.setState({ token: null, user: null, hydrated: true });
    renderRoute('/login');
    expect(document.querySelector('.topbar-page-name')).toHaveTextContent('工作台');
    expect(screen.queryByRole('heading', { name: '登录工作区' })).not.toBeInTheDocument();
  });

  test('renders product routes without a login gate', () => {
    useAuthStore.setState({ token: null, user: null, hydrated: true });
    renderRoute('/reports');
    expect(document.querySelector('.topbar-page-name')).toHaveTextContent('报告中心');
    expect(screen.queryByRole('heading', { name: '登录工作区' })).not.toBeInTheDocument();
  });

  test('keeps the removed login route out of the product surface', () => {
    renderRoute('/login');
    expect(document.querySelector('.topbar-page-name')).toHaveTextContent('工作台');
  });

  test('keeps API identity in the shell instead of rendering a duplicate catalog heading', () => {
    renderRoute('/apis');
    expect(document.querySelector('.topbar-page-name')).toHaveTextContent('接口管理');
    expect(screen.queryByRole('heading', { name: '接口资产' })).not.toBeInTheDocument();
    expect(screen.queryByText('API CATALOG', { exact: true })).not.toBeInTheDocument();
  });

  test.each([
    ['/', '工作台'],
    ['/capabilities', '能力地图'],
    ['/workflows', '业务流程'],
    ['/apis', '接口管理'],
    ['/import', '导入中心'],
    ['/cases', '用例管理'],
    ['/plans', '测试计划'],
    ['/environments', '环境管理'],
    ['/variables', '变量管理'],
    ['/agent', '智能生成'],
  ])('keeps product route %s identified by its shell title', (path, title) => {
    renderRoute(path);
    expect(document.querySelector('.topbar-page-name')).toHaveTextContent(title);
  });

  test('loads the report list from the Control Plane', async () => {
    renderRoute('/reports');
    expect(document.querySelector('.topbar-page-name')).toHaveTextContent('报告中心');
    expect(await screen.findByRole('heading', { name: '还没有运行记录' })).toBeInTheDocument();
    expect(cpClient.listRuns).toHaveBeenCalledTimes(1);
  });

  test('loads a report detail by Run ID from the Control Plane', async () => {
    renderRoute('/reports/run-001');
    expect(await screen.findByRole('heading', { name: 'run-001' })).toBeInTheDocument();
    expect(cpClient.getReport).toHaveBeenCalledWith('run-001', expect.any(AbortSignal));
  });

  test.each(['/projects', '/workflow-execution', '/api-catalog', '/runs', '/team', '/trash'])(
    'redirects the removed route %s to the dashboard',
    (path) => {
      renderRoute(path);
      expect(document.querySelector('.topbar-page-name')).toHaveTextContent('工作台');
      expect(screen.queryByRole('button', { name: '项目管理' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '发布并运行' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '控制面资产' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '运行与证据' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '团队管理' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '回收站' })).not.toBeInTheDocument();
    },
  );
});
