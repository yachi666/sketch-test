import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { cpClient, type RunListResult, type RunReport } from '../../lib/cp-client';
import { ReportsDetailWrapper, ReportsPage } from './index';

vi.mock('../../lib/cp-client', () => ({ cpClient: { listRuns: vi.fn(), getReport: vi.fn() } }));
const result: RunListResult = {
  runs: [
    {
      id: 'r-1',
      sourceName: '支付回归',
      status: 'pending',
      apiVersionId: null,
      runnerId: null,
      claimedAt: null,
      createdAt: '2026-09-23T10:00:00Z',
      finishedAt: null,
    },
  ],
  total: 61,
  page: 1,
  pageSize: 20,
  summary: { total: 61, passed: 50, failed: 4, active: 2, unresolved: 3, cancelled: 2, other: 0 },
};
function open(path = '/reports') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/reports/:runId" element={<ReportsDetailWrapper />} />
      </Routes>
    </MemoryRouter>,
  );
}
describe('report investigation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(cpClient.listRuns).mockResolvedValue(result);
  });
  test('reads totals beyond the current page and sends pagination and filters to the backend', async () => {
    open('/reports?days=7');
    expect(await screen.findByText('共 61 条 · 第 1 / 4 页')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('排队中')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() =>
      expect(cpClient.listRuns).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2, days: 7 }),
        expect.any(AbortSignal),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: '需要关注' }));
    await waitFor(() =>
      expect(cpClient.listRuns).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, status: 'attention' }),
        expect.any(AbortSignal),
      ),
    );
    fireEvent.change(screen.getByRole('textbox', { name: '搜索运行或业务名称' }), {
      target: { value: '付款' },
    });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await waitFor(() =>
      expect(cpClient.listRuns).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: '付款', page: 1 }),
        expect.any(AbortSignal),
      ),
    );
  });
  test('does not replace fresh results with a slow previous filter response', async () => {
    let resolveOld!: (value: RunListResult) => void;
    vi.mocked(cpClient.listRuns).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    open();
    fireEvent.click(screen.getByRole('button', { name: '需要关注' }));
    expect(await screen.findByText('支付回归')).toBeInTheDocument();
    resolveOld({ ...result, runs: [] });
    await waitFor(() => expect(screen.getByText('支付回归')).toBeInTheDocument());
  });
  test('opens the failed step first, compares assertions, and retains filters on return', async () => {
    const run = result.runs[0];
    if (!run) throw new Error('Missing test run');
    const report: RunReport = {
      run: { ...run, status: 'failed' },
      steps: [
        { stepIndex: 0, name: '准备用户', status: 'passed', events: [] },
        {
          stepIndex: 1,
          name: '检查付款',
          status: 'failed',
          events: [],
          assertions: [
            {
              assertionId: 'a',
              description: '付款应完成',
              expected: 'paid',
              actual: 'pending',
              passed: false,
              severity: 'block',
              attempt: 1,
            },
          ],
        },
        { stepIndex: 2, name: '核对订单', status: 'not_run', events: [] },
      ],
    };
    vi.mocked(cpClient.getReport).mockResolvedValue(report);
    open('/reports/r-1?status=attention&days=7');
    const timeline = await screen.findByRole('region', { name: 'StepRun 执行时间线' });
    expect(within(timeline).getByRole('button', { name: /检查付款/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('tab', { name: '断言' }));
    expect(screen.getByText('paid')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(screen.getByText('未执行')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回报告中心' }));
    await waitFor(() =>
      expect(cpClient.listRuns).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'attention', days: 7 }),
        expect.any(AbortSignal),
      ),
    );
  });
});
