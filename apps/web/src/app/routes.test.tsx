import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { useAuthStore } from '../stores/authStore';
import { AppRoutes } from './routes';

vi.mock('../hooks/useApi', () => ({
  useApiVersions: () => ({ data: [], loading: false, error: null, refetch: vi.fn() }),
}));

vi.mock('../components/api/CpImportPanel', () => ({
  CpImportPanel: () => <section aria-label="真实导入入口">Control Plane import</section>,
}));

vi.mock('../lib/cp-client', () => ({
  cpClient: {
    listRuns: vi.fn().mockResolvedValue({ runs: [] }),
    getReport: vi.fn(),
  },
}));

function renderRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('product routes', () => {
  beforeEach(() => {
    useAuthStore.setState({
      token: 'test-token',
      hydrated: true,
      user: {
        id: 'usr_test',
        email: 'owner@example.test',
        displayName: 'Owner',
        role: 'owner',
        workspaceId: 'ws_test',
      },
    });
  });

  test('renders the Control Plane-backed API catalog', () => {
    renderRoute('/apis');
    expect(screen.getByRole('heading', { name: '接口资产' })).toBeInTheDocument();
    expect(screen.getByLabelText('真实导入入口')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '接口管理' })).toHaveLength(1);
  });

  test.each([
    '/projects',
    '/plans',
    '/team',
    '/trash',
    '/agent',
    '/reports',
  ])('redirects unavailable or mock-backed route %s to the real catalog', (path) => {
    renderRoute(path);
    expect(screen.getByRole('heading', { name: '接口资产' })).toBeInTheDocument();
    expect(screen.queryByText('该模块正在准备。')).not.toBeInTheDocument();
  });

  test('renders the real workflow publishing surface', () => {
    renderRoute('/workflows');
    expect(screen.getByRole('heading', { name: '流程执行' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发布并运行' })).toBeInTheDocument();
  });

  test('renders the Control Plane-backed runs surface', async () => {
    renderRoute('/runs');
    expect(screen.getByRole('heading', { name: '运行与报告' })).toBeInTheDocument();
    expect(await screen.findByText('暂无运行')).toBeInTheDocument();
  });
});
