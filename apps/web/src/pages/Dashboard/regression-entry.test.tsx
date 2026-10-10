import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { AppLayout } from '../../components/layout/AppLayout';
import { cpClient } from '../../lib/cp-client';
import { useAuthStore } from '../../stores/authStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import DashboardOverview from './index';

vi.mock('../../lib/cp-client', () => ({
  cpClient: {
    listRuns: vi.fn(),
    listWorkflows: vi.fn(),
    listTestCases: vi.fn(),
    listApiVersions: vi.fn(),
  },
}));

describe('regression entry and contextual actions', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: {
        id: 'u-1',
        workspaceId: 'ws-1',
        displayName: 'Tester',
        email: 'test@example.test',
        role: 'owner',
      },
    });
    vi.mocked(cpClient.listRuns).mockResolvedValue({
      runs: [],
      total: 0,
      page: 1,
      pageSize: 20,
      summary: { total: 0, passed: 0, failed: 0, active: 0, unresolved: 0, cancelled: 0, other: 0 },
    });
    vi.mocked(cpClient.listWorkflows).mockResolvedValue({ workflows: [] });
    vi.mocked(cpClient.listTestCases).mockResolvedValue({ testCases: [] });
    vi.mocked(cpClient.listApiVersions).mockResolvedValue({ apiVersions: [] });
  });
  test('provides a first regression path without meaningless action buttons', async () => {
    render(
      <MemoryRouter>
        <AppLayout>
          <DashboardOverview />
        </AppLayout>
      </MemoryRouter>,
    );
    await waitFor(() => expect(cpClient.listRuns).toHaveBeenCalled());
    expect(screen.getByRole('heading', { name: '建立第一条业务回归' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '前往流程执行' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '运行' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /端点版本记录/ })).not.toBeInTheDocument();
  });
  test('does not execute a previously opened workflow from a global shortcut', () => {
    const run = vi.fn();
    const save = vi.fn();
    const previous = useWorkflowStore.getState();
    useWorkflowStore.setState({ runWorkflow: run, saveDraft: save });
    try {
      render(
        <MemoryRouter initialEntries={['/reports']}>
          <AppLayout>
            <p>报告</p>
          </AppLayout>
        </MemoryRouter>,
      );
      fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
      fireEvent.keyDown(window, { key: 's', metaKey: true });
      expect(run).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    } finally {
      useWorkflowStore.setState(previous);
    }
  });
  test('keeps cancelled and inconclusive runs out of in-progress counts', async () => {
    vi.mocked(cpClient.listRuns).mockResolvedValue({
      total: 3,
      page: 1,
      pageSize: 20,
      summary: { total: 3, passed: 0, failed: 0, active: 0, unresolved: 2, cancelled: 1, other: 0 },
      runs: ['cancelled', 'inconclusive', 'lost'].map((status, index) => ({
        id: `run-${index}`,
        status,
        apiVersionId: null,
        workflowVersionId: null,
        testCaseVersionId: null,
        createdAt: '2026-09-12T10:00:00Z',
        finishedAt: null,
        runnerId: null,
        claimedAt: null,
      })),
    });
    render(
      <MemoryRouter>
        <DashboardOverview />
      </MemoryRouter>,
    );
    expect(await screen.findByText('无法判断或失联 2')).toBeInTheDocument();
    expect(screen.getByText('进行中 0')).toBeInTheDocument();
    expect(screen.getByText('已取消 1')).toBeInTheDocument();
  });
});
