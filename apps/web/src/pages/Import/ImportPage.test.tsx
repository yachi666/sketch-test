import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { useAuthStore } from '../../stores/authStore';
import { ImportPage } from '.';

const api = vi.hoisted(() => ({ listApiVersions: vi.fn(), importSpec: vi.fn() }));
vi.mock('../../lib/cp-client', () => ({ cpClient: api }));
const version = {
  id: 'av-saved',
  label: '员工服务',
  sourceType: 'code-discovery',
  sourceLocation: `https://github.com/team/${'long-repository-name-'.repeat(15)}`,
  createdAt: '2026-09-28T08:30:00Z',
  endpointCount: 59,
  diagnosticCount: 2,
  contentHash: 'abc'.repeat(24),
};
beforeEach(() => {
  vi.resetAllMocks();
  useAuthStore.setState({
    user: {
      id: 'u1',
      email: 'owner@example.test',
      displayName: 'Owner',
      role: 'owner',
      workspaceId: 'w1',
    },
  });
  api.listApiVersions.mockResolvedValue({ apiVersions: [version] });
});
function renderPage() {
  return render(
    <MemoryRouter>
      <ImportPage />
    </MemoryRouter>,
  );
}
function submit(value = 'https://example.test/openapi.yaml') {
  fireEvent.change(screen.getByLabelText('OpenAPI 文档地址'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: '导入接口' }));
}

test('shows structured history, searchable source metadata, and clear no-match recovery', async () => {
  renderPage();
  const record = await screen.findByRole('article', { name: '员工服务' });
  expect(within(record).getByText('已导入')).toBeInTheDocument();
  expect(within(record).getByText('代码发现')).toBeInTheDocument();
  expect(within(record).getByText('59')).toBeInTheDocument();
  expect(within(record).getByText('2 条诊断')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'av-saved' } });
  expect(screen.getByRole('article', { name: '员工服务' })).toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'does-not-exist' } });
  expect(screen.getByRole('heading', { name: '没有找到匹配的版本' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
  expect(screen.getByRole('article', { name: '员工服务' })).toBeInTheDocument();
});

test('does not show an empty state before loading or mislabel a failed request as empty', async () => {
  let rejectRequest: ((reason: Error) => void) | undefined;
  api.listApiVersions.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectRequest = reject;
      }),
  );
  renderPage();
  expect(screen.getByText('正在读取导入记录…')).toBeInTheDocument();
  expect(screen.queryByText('第一份接口来源，等待从这里开始。')).not.toBeInTheDocument();
  await act(async () => {
    rejectRequest?.(new Error('服务暂不可用'));
  });
  expect(screen.getByText('导入记录读取失败')).toBeInTheDocument();
  expect(screen.queryByText('第一份接口来源，等待从这里开始。')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
  expect(await screen.findByRole('article', { name: '员工服务' })).toBeInTheDocument();
});

test('validates URL locally and preserves the source when the import fails', async () => {
  renderPage();
  await screen.findByRole('article', { name: '员工服务' });
  submit('file:///tmp/spec.json');
  expect(api.importSpec).not.toHaveBeenCalled();
  expect(screen.getByText('导入未完成')).toBeInTheDocument();
  expect(screen.getByLabelText('OpenAPI 文档地址')).toHaveAttribute('aria-invalid', 'true');
  api.importSpec.mockRejectedValueOnce(new Error('不是有效的 OpenAPI 文档'));
  submit();
  expect(await screen.findByText('不是有效的 OpenAPI 文档')).toBeInTheDocument();
  expect(screen.queryByText('导入记录读取失败')).not.toBeInTheDocument();
  expect(screen.getByLabelText('OpenAPI 文档地址')).toHaveValue(
    'https://example.test/openapi.yaml',
  );
  expect(screen.getByRole('article', { name: '员工服务' })).toBeInTheDocument();
});

test('retains successful import confirmation when the subsequent history refresh fails', async () => {
  renderPage();
  await screen.findByRole('article', { name: '员工服务' });
  api.importSpec.mockResolvedValueOnce({
    apiVersionId: 'av-new',
    endpointCount: 3,
    diagnostics: [{ level: 'warning', message: '部分结构未识别' }],
  });
  api.listApiVersions.mockRejectedValueOnce(new Error('刷新超时'));
  submit('  https://example.test/openapi.yaml  ');
  expect(await screen.findByText('导入完成，已解析 3 个接口')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: '刷新记录' })).toBeEnabled());
  expect(api.importSpec).toHaveBeenCalledWith('url', 'https://example.test/openapi.yaml');
  expect(screen.getByText('导入记录读取失败')).toBeInTheDocument();
  expect(screen.queryByText('导入未完成')).not.toBeInTheDocument();
  expect(screen.getByRole('article', { name: '员工服务' })).toBeInTheDocument();
  expect(screen.getByLabelText('OpenAPI 文档地址')).toHaveValue('');
  expect(screen.getByText('查看 1 条导入诊断')).toBeInTheDocument();
});
