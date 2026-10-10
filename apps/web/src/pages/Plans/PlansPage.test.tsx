import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { useAuthStore } from '../../stores/authStore';
import { ManualPlansPage as PlansPage } from '.';

const api = vi.hoisted(() => ({
  listTestSuites: vi.fn(),
  listSchedules: vi.fn(),
  listTestCases: vi.fn(),
  listWorkflows: vi.fn(),
  getTestSuite: vi.fn(),
  listTestSuiteVersions: vi.fn(),
  createTestSuite: vi.fn(),
  createTestSuiteVersion: vi.fn(),
  deleteTestSuite: vi.fn(),
  createSchedule: vi.fn(),
  updateSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  triggerSchedule: vi.fn(),
}));

vi.mock('../../lib/cp-client', () => ({ cpClient: api }));

const suite = {
  id: 'suite-1',
  workspaceId: 'ws-1',
  name: '主干合并门禁',
  description: '保护支付主链路',
  createdAt: '2026-07-01T08:00:00.000Z',
  updatedAt: '2026-07-14T08:00:00.000Z',
};

const version = {
  id: 'suite-version-3',
  testSuiteId: suite.id,
  version: 3,
  members: [{ type: 'workflow' as const, id: 'workflow-1' }],
  qualityGate: {
    requiredWorkflows: ['workflow-1'],
    noNewFailures: true,
    maxFlakyRetries: 2,
    minEndpointCoverage: 80,
    requiredTags: ['critical'],
    blockOnInfraError: true,
  },
  createdAt: '2026-07-14T08:00:00.000Z',
};

const workflow = {
  id: 'workflow-1',
  workspaceId: 'ws-1',
  name: '支付成功链路',
  description: '下单、支付与确认',
  createdAt: '2026-07-01T08:00:00.000Z',
  updatedAt: '2026-07-14T08:00:00.000Z',
};

const schedule = {
  id: 'schedule-1',
  workspaceId: 'ws-1',
  testSuiteId: suite.id,
  cronExpression: '0 9 * * 1-5',
  environmentId: null,
  enabled: true,
  createdAt: '2026-07-14T08:00:00.000Z',
};

describe('PlansPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      token: 'token',
      user: {
        id: 'user-1',
        email: 'owner@example.com',
        displayName: 'Owner',
        role: 'owner',
        workspaceId: 'ws-1',
      },
      hydrated: true,
      loading: false,
      error: null,
    });
    api.listTestSuites.mockResolvedValue({ testSuites: [suite] });
    api.listSchedules.mockResolvedValue({ schedules: [schedule] });
    api.listTestCases.mockResolvedValue({ testCases: [] });
    api.listWorkflows.mockResolvedValue({ workflows: [workflow] });
    api.getTestSuite.mockResolvedValue({ testSuite: suite, latestVersion: version });
    api.listTestSuiteVersions.mockResolvedValue({ versions: [version] });
    api.triggerSchedule.mockResolvedValue({
      runId: 'run-1',
      runIds: ['run-1'],
      testSuiteVersionId: version.id,
    });
  });

  test('loads the real suite version, quality gate, and schedule', async () => {
    render(<PlansPage />);

    expect(await screen.findByText('当前不可变版本')).toBeInTheDocument();
    expect(screen.getByText('支付成功链路')).toBeInTheDocument();
    expect(screen.getByText('至少 80%')).toBeInTheDocument();
    expect(screen.getByText('0 9 * * 1-5')).toBeInTheDocument();
    expect(api.listTestSuites).toHaveBeenCalledWith('ws-1');

    fireEvent.click(screen.getByRole('button', { name: '立即运行' }));
    await waitFor(() => expect(api.triggerSchedule).toHaveBeenCalledWith('schedule-1'));
  });

  test('creates a suite and its first immutable version from selected assets', async () => {
    api.listTestSuites.mockResolvedValue({ testSuites: [] });
    api.listSchedules.mockResolvedValue({ schedules: [] });
    api.createTestSuite.mockResolvedValue({ testSuite: suite });
    api.createTestSuiteVersion.mockResolvedValue({ version: { ...version, version: 1 } });

    render(<PlansPage />);
    await waitFor(() => expect(api.listTestSuites).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '新建测试计划' }));

    fireEvent.change(screen.getByLabelText('计划名称'), {
      target: { value: '发布前冒烟' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /支付成功链路/ }));
    fireEvent.click(screen.getByRole('button', { name: '创建并发布 v1' }));

    await waitFor(() => {
      expect(api.createTestSuite).toHaveBeenCalledWith('ws-1', '发布前冒烟', undefined);
      expect(api.createTestSuiteVersion).toHaveBeenCalledWith(
        'suite-1',
        [{ type: 'workflow', id: 'workflow-1' }],
        expect.objectContaining({
          requiredWorkflows: ['workflow-1'],
          noNewFailures: true,
          minEndpointCoverage: 80,
          blockOnInfraError: true,
        }),
      );
    });
  });

  test('does not replace Control Plane data when there is no workspace session', () => {
    useAuthStore.setState({ token: null, user: null });
    render(<PlansPage />);

    expect(screen.getByText('连接工作区后管理真实计划')).toBeInTheDocument();
    expect(api.listTestSuites).not.toHaveBeenCalled();
  });
});
