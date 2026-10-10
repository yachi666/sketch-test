import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { useAuthStore } from '../../stores/authStore';
import { CapabilitiesPage } from '.';

const api = vi.hoisted(() => ({
  listApiVersions: vi.fn(),
  aiCapabilities: vi.fn(),
  listSchedules: vi.fn(),
  listEnvironments: vi.fn(),
  list: vi.fn(),
}));
vi.mock('../../lib/cp-client', () => ({ cpClient: api, planClient: { list: api.list } }));

const user = {
  id: 'user-1',
  email: 'owner@example.test',
  displayName: 'Owner',
  role: 'owner' as const,
  workspaceId: 'workspace-a',
};
beforeEach(() => {
  vi.resetAllMocks();
  useAuthStore.setState({ user, token: 'test-token', hydrated: true });
  api.listApiVersions.mockResolvedValue({ apiVersions: [{ id: 'api-1' }] });
  api.aiCapabilities.mockResolvedValue({ available: true, configured: true, workers: [] });
  api.list.mockResolvedValue({ jobs: [], settings: { enabled: false } });
  api.listSchedules.mockResolvedValue({ schedules: [{ enabled: true }] });
  api.listEnvironments.mockResolvedValue({ environments: [] });
});

function renderPage() {
  return render(
    <MemoryRouter>
      <CapabilitiesPage />
    </MemoryRouter>,
  );
}

test('keeps successful states when one source fails and refreshes unknown states', async () => {
  api.aiCapabilities.mockRejectedValueOnce(new Error('Unavailable'));
  renderPage();
  const workspace = screen.getByRole('region', { name: '当前工作区' });
  expect(await within(workspace).findByText('状态未知')).toBeInTheDocument();
  expect(within(workspace).getByText('1 个 API 版本')).toBeInTheDocument();
  expect(within(workspace).getByText('自动建议未开启')).toBeInTheDocument();
  expect(within(workspace).getByText('尚未配置环境')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '刷新状态' }));
  expect(await within(workspace).findByText('生成服务可用')).toBeInTheDocument();
  expect(within(workspace).queryByText('状态未知')).not.toBeInTheDocument();
});

test('combines independent filters, handles no matches and resets all criteria', async () => {
  renderPage();
  await screen.findAllByText('1 个 API 版本');
  fireEvent.change(screen.getByLabelText('由谁完成'), { target: { value: 'AI 辅助' } });
  fireEvent.change(screen.getByLabelText('如何触发'), { target: { value: '资产变化' } });
  expect(screen.getByText('显示 1 / 10 项能力')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'AI 测试计划建议' })).toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '不存在的能力' } });
  expect(screen.getByRole('heading', { name: '没有匹配的能力' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '查看全部能力' }));
  expect(screen.getByText('显示 10 / 10 项能力')).toBeInTheDocument();
});

test('does not equate enabled schedules with active scheduling and links to published plans', async () => {
  renderPage();
  const schedule = screen.getByRole('article', { name: '发起运行与管理定时规则' });
  expect(await within(schedule).findByText('1 条定时规则')).toBeInTheDocument();
  expect(
    within(schedule).getByText('按 UTC 定时派发；实际运行结果以报告为准，停机期间不补跑。'),
  ).toBeInTheDocument();
  expect(within(schedule).getByRole('link', { name: '管理计划与规则' })).toHaveAttribute(
    'href',
    '/plans?view=published',
  );
});

test('discards a slow response from the previous workspace', async () => {
  let finishOld: ((value: { apiVersions: Array<{ id: string }> }) => void) | undefined;
  api.listApiVersions.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
  );
  renderPage();
  act(() => useAuthStore.setState({ user: { ...user, workspaceId: 'workspace-b' } }));
  const workspace = screen.getByRole('region', { name: '当前工作区' });
  expect(await within(workspace).findByText('1 个 API 版本')).toBeInTheDocument();
  await act(async () => {
    finishOld?.({ apiVersions: Array.from({ length: 9 }, (_, index) => ({ id: String(index) })) });
  });
  expect(within(workspace).queryByText('9 个 API 版本')).not.toBeInTheDocument();
  act(() => useAuthStore.setState({ user: null }));
  await waitFor(() =>
    expect(within(workspace).queryByText('1 个 API 版本')).not.toBeInTheDocument(),
  );
  expect(within(workspace).getAllByText('尚未连接工作区')).toHaveLength(4);
});

test('separates rules, AI drafts and review into distinct visible responsibility blocks', async () => {
  renderPage();
  await screen.findAllByText('1 个 API 版本');
  const automatic = screen.getByRole('region', { name: '系统自动完成' });
  const ai = screen.getByRole('region', { name: 'AI 辅助生成' });
  const manual = screen.getByRole('region', { name: '需要你操作' });
  expect(
    within(automatic).getByRole('article', { name: '按规则生成基础草稿' }),
  ).toBeInTheDocument();
  expect(
    within(automatic).queryByRole('article', { name: 'AI 生成测试草稿' }),
  ).not.toBeInTheDocument();
  expect(within(ai).getByRole('article', { name: 'AI 生成测试草稿' })).toBeInTheDocument();
  expect(within(ai).queryByRole('article', { name: '审核与发布测试' })).not.toBeInTheDocument();
  expect(within(manual).getByRole('article', { name: '审核与发布测试' })).toBeInTheDocument();
  expect(
    within(manual).getByRole('article', { name: '发起运行与管理定时规则' }),
  ).toBeInTheDocument();
  expect(screen.getAllByRole('article')).toHaveLength(10);
});
