/** Labels accept both persisted CP statuses and historical protocol names. */
export const runStatusLabels: Record<string, string> = {
  pending: '排队中',
  queued: '排队中',
  claimed: '已分配',
  leased: '已分配',
  running: '执行中',
  passed: '通过',
  failed: '失败',
  inconclusive: '无法判断',
  cancelled: '已取消',
  lost: '已失联',
  orphaned: '已失联',
  error: '执行异常',
  skipped: '已跳过',
  not_run: '未执行',
  unknown: '证据未完整',
};
export function statusLabel(status: string): string {
  return runStatusLabels[status] ?? `未知状态（${status}）`;
}
export function isActiveRun(status: string): boolean {
  return ['pending', 'queued', 'claimed', 'leased', 'running'].includes(status);
}
export function statusTone(
  status: string,
): 'passed' | 'failed' | 'pending' | 'neutral' | 'warning' {
  if (status === 'passed') return 'passed';
  if (status === 'failed') return 'failed';
  if (['inconclusive', 'lost', 'orphaned', 'error', 'unknown'].includes(status)) return 'warning';
  return isActiveRun(status) ? 'pending' : 'neutral';
}
