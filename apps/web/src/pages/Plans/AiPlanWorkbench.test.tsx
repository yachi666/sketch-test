import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { useAuthStore } from '../../stores/authStore';
import { AiPlanWorkbench } from './AiPlanWorkbench';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  listAgents: vi.fn(),
  save: vi.fn(),
  generate: vi.fn(),
  settings: vi.fn(),
  publish: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('../../lib/cp-client', () => ({ planClient: api, cpClient: api }));
const proposal = {
  name: '员工回归',
  objective: '员工管理',
  explanation: '发现一个发布用例和一个待审草稿',
  members: [{ key: 't1', reason: '已发布' }],
  gaps: [{ key: 'd1', reason: '未发布' }],
  noNewFailures: true,
  blockOnInfraError: true,
  precautions: ['准备清理数据'],
};
const job = {
  id: 'p1',
  status: 'completed',
  trigger: '自动建议',
  parentId: null,
  objective: '回归',
  assets: [
    {
      key: 't1',
      id: 't1',
      type: 'test',
      name: '删除员工',
      versionId: 'tv1',
      version: 1,
      route: 'DELETE /staff',
      sideEffect: 'high-risk',
    },
    {
      key: 'd1',
      id: 'd1',
      type: 'draft',
      name: '员工列表',
      route: 'GET /staff',
      sideEffect: 'read-only',
    },
  ],
  proposal,
  revision: 1,
  savedAt: null,
  suiteId: null,
  createdAt: '2026-09-28T10:00:00Z',
  model: { provider: 'test', model: 'test' },
};
function mount() {
  return render(
    <MemoryRouter>
      <AiPlanWorkbench onPublished={vi.fn()} />
    </MemoryRouter>,
  );
}
describe('AI plan review', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.listAgents.mockResolvedValue({
      agents: [
        {
          id: 'ag_plan',
          name: '计划 Agent',
          version: 1,
          enabled: true,
          capability: 'plan',
          model: 'test',
        },
      ],
    });
    useAuthStore.setState({
      user: {
        id: 'u',
        email: 'u@example.com',
        displayName: 'U',
        role: 'editor',
        workspaceId: 'ws',
      },
    });
    api.list.mockResolvedValue({ jobs: [job], settings: { enabled: false } });
  });
  test('saves edited draft without publishing and separates pending assets', async () => {
    api.save.mockResolvedValue({ job: { ...job, revision: 2, savedAt: 'now' } });
    mount();
    expect(await screen.findByText('当前执行成员（1）')).toBeInTheDocument();
    expect(screen.getByText('待补齐（1）')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('计划目标'), { target: { value: '只验证员工' } });
    fireEvent.click(screen.getByRole('button', { name: '保存计划草稿' }));
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith(
        'p1',
        1,
        expect.objectContaining({ objective: '只验证员工' }),
      ),
    );
    expect(api.publish).not.toHaveBeenCalled();
    expect(await screen.findByText('草稿已保存。尚未发布或执行。')).toBeInTheDocument();
  });
  test('sends natural language changes with the parent revision', async () => {
    api.generate.mockResolvedValue({
      job: { ...job, id: 'p2', status: 'pending', proposal: null, parentId: 'p1' },
    });
    mount();
    await screen.findByText('当前执行成员（1）');
    fireEvent.change(screen.getByLabelText('告诉 AI 如何调整计划'), {
      target: { value: '只保留只读用例' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送测试目标' }));
    await waitFor(() =>
      expect(api.generate).toHaveBeenCalledWith('只保留只读用例', 'p1', 1, 'ag_plan'),
    );
    expect(await screen.findByText('计划正在生成')).toBeInTheDocument();
  });
  test('keeps unsaved edits when polling discovers another automatic suggestion', async () => {
    vi.useFakeTimers();
    try {
      mount();
      await act(async () => {});
      fireEvent.change(screen.getByLabelText('计划目标'), { target: { value: '保留本次编辑' } });
      api.list.mockResolvedValue({
        jobs: [{ ...job, id: 'p2', proposal: { ...proposal, name: '新建议' } }, job],
        settings: { enabled: true },
      });
      await act(async () => vi.advanceTimersByTimeAsync(4000));
      expect(screen.getByLabelText('计划目标')).toHaveValue('保留本次编辑');
      expect(screen.getByLabelText('选择计划建议')).toHaveValue('p1');
    } finally {
      vi.useRealTimers();
    }
  });
  test('surfaces backend failure without inventing success', async () => {
    api.save.mockRejectedValue(new Error('草稿已变化，请刷新'));
    mount();
    await screen.findByText('当前执行成员（1）');
    fireEvent.click(screen.getByRole('button', { name: '保存计划草稿' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('草稿已变化');
    expect(api.publish).not.toHaveBeenCalled();
  });
  test('viewer can inspect but cannot save or generate', async () => {
    useAuthStore.setState({
      user: {
        id: 'u',
        email: 'u@example.com',
        displayName: 'U',
        role: 'viewer',
        workspaceId: 'ws',
      },
    });
    mount();
    await screen.findByText('当前执行成员（1）');
    expect(screen.getByRole('button', { name: '保存计划草稿' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '发送测试目标' })).toBeDisabled();
  });
});
