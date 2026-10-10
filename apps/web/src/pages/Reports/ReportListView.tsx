import { ArrowClockwise, ArrowRight, FileText, MagnifyingGlass } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ErrorCallout } from '../../components/shared/ErrorCallout';
import { cpClient, type RunListResult } from '../../lib/cp-client';
import { statusLabel, statusTone } from '../../lib/run-status';

const filters = [
  ['all', '全部运行'],
  ['attention', '需要关注'],
  ['active', '进行中'],
  ['passed', '已通过'],
  ['cancelled', '已取消'],
] as const;
function date(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  );
}
export function ReportListView() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const status = params.get('status') ?? 'all';
  const days = [0, 1, 7, 30].includes(Number(params.get('days'))) ? Number(params.get('days')) : 0;
  const page = Math.max(1, Math.min(100000, Number(params.get('page')) || 1));
  const [search, setSearch] = useState(q);
  const [data, setData] = useState<RunListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  useEffect(() => setSearch(q), [q]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void cpClient
      .listRuns({ q, status, days, page, pageSize: 20 }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : '读取运行失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [q, status, days, page, revision]);
  useEffect(() => {
    if (!autoRefresh || !data?.summary.active) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setRevision((value) => value + 1);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, data?.summary.active]);
  function update(values: Record<string, string>) {
    const next = new URLSearchParams(params);
    next.delete('page');
    for (const [key, value] of Object.entries(values)) {
      if (value && value !== 'all' && value !== '0') next.set(key, value);
      else next.delete(key);
    }
    setParams(next);
  }
  const summary = data?.summary;
  const metrics = [
    ['passed', '通过', summary?.passed],
    ['failed', '失败', summary?.failed],
    ['warning', '无法判断 / 失联', summary?.unresolved],
    ['pending', '进行中', summary?.active],
    ['neutral', '已取消', summary?.cancelled],
  ] as const;
  return (
    <main className="page-view regression-reports">
      <header className="report-intro">
        <div>
          <span className="eyebrow">REGRESSION EVIDENCE</span>
          <h2>每次回归，都有据可查</h2>
          <p>找到需要关注的运行，从失败步骤追溯到真实请求、响应与断言。</p>
        </div>
        <button
          type="button"
          className="button button--outline"
          disabled={loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          <ArrowClockwise size={17} />
          刷新
        </button>
      </header>
      <section className="report-signals" aria-label="运行结果汇总" aria-busy={loading}>
        {metrics.map(([tone, label, value]) => (
          <div className={`report-signal report-signal--${tone}`} key={label}>
            <span>{label}</span>
            <strong>{error ? '—' : (value ?? '—')}</strong>
          </div>
        ))}
      </section>
      <div className="report-scope">
        <span>
          汇总范围：当前工作区 · {days ? `最近 ${days} 天` : '全部时间'} ·{' '}
          {q ? `搜索「${q}」` : '全部来源'}；不受分页和状态筛选影响。
        </span>
        {summary?.other ? <span>另有 {summary.other} 条未知状态</span> : null}
      </div>
      <section className="report-browser" aria-label="运行报告列表" aria-busy={loading}>
        <div className="report-filter-row">
          <div className="report-filter-tabs" aria-label="运行状态筛选">
            {filters.map(([value, label]) => (
              <button
                type="button"
                key={value}
                aria-pressed={status === value}
                onClick={() => update({ status: value })}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="report-period">
            <span className="sr-only">时间范围</span>
            <select value={days} onChange={(event) => update({ days: event.target.value })}>
              <option value={0}>全部时间</option>
              <option value={1}>最近 24 小时</option>
              <option value={7}>最近 7 天</option>
              <option value={30}>最近 30 天</option>
            </select>
          </label>
        </div>
        <form
          className="report-search-row"
          onSubmit={(event) => {
            event.preventDefault();
            update({ q: search.trim() });
          }}
        >
          <label className="report-search">
            <MagnifyingGlass size={18} />
            <input
              aria-label="搜索运行或业务名称"
              value={search}
              maxLength={200}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索业务名称、运行 ID、版本或 Runner"
            />
          </label>
          <button className="button button--outline" type="submit">
            搜索
          </button>
          <label className="report-refresh">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
            />
            执行中每 5 秒刷新
          </label>
        </form>
        {error ? (
          <ErrorCallout
            title="报告中心暂不可用"
            message={error}
            onRetry={() => setRevision((value) => value + 1)}
          />
        ) : null}
        {!data && loading ? (
          <p className="report-list-message" role="status">
            正在读取真实运行记录…
          </p>
        ) : null}
        {!error && data ? (
          <>
            <div className="report-table-wrap">
              <table className="regression-run-table">
                <thead>
                  <tr>
                    <th scope="col">业务与运行</th>
                    <th scope="col">结论</th>
                    <th scope="col">创建时间</th>
                    <th scope="col">执行来源</th>
                    <th scope="col">
                      <span className="sr-only">操作</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.runs.map((run) => (
                    <tr key={run.id}>
                      <td>
                        <strong>{run.sourceName ?? '运行记录'}</strong>
                        <code>{run.id}</code>
                      </td>
                      <td>
                        <span
                          className={`scenario-status scenario-status--${statusTone(run.status)}`}
                        >
                          {statusLabel(run.status)}
                        </span>
                      </td>
                      <td>
                        <time dateTime={run.createdAt}>{date(run.createdAt)}</time>
                        <small>{run.runnerId ?? '尚未分配 Runner'}</small>
                      </td>
                      <td>
                        {run.workflowVersionId
                          ? '已发布流程'
                          : run.testCaseVersionId
                            ? '已发布用例'
                            : '临时请求'}
                      </td>
                      <td>
                        <button
                          className="text-button"
                          type="button"
                          aria-label={`查看 ${run.sourceName ?? run.id} 的证据`}
                          onClick={() =>
                            navigate(`/reports/${encodeURIComponent(run.id)}?${params}`)
                          }
                        >
                          查看证据
                          <ArrowRight size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.runs.length === 0 ? (
              <div className="report-empty">
                <FileText size={36} />
                <h3>
                  {q || status !== 'all' || days || page > 1
                    ? '没有匹配的运行记录'
                    : '还没有运行记录'}
                </h3>
                <p>
                  {q || status !== 'all' || days || page > 1
                    ? '调整筛选条件，或返回全部运行。'
                    : '从一个已发布的业务流程开始，执行后即可在这里查看证据。'}
                </p>
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() =>
                    q || status !== 'all' || days || page > 1
                      ? setParams({})
                      : navigate('/workflows')
                  }
                >
                  {q || status !== 'all' || days || page > 1 ? '清除筛选' : '前往业务流程'}
                </button>
              </div>
            ) : null}
            <footer className="report-pagination">
              <span role="status">
                共 {data.total} 条 · 第 {page} / {Math.max(1, Math.ceil(data.total / 20))} 页
                {loading ? ' · 更新中…' : ''}
              </span>
              <div>
                <button
                  className="button button--outline"
                  type="button"
                  disabled={loading || page <= 1}
                  onClick={() => update({ page: String(page - 1) })}
                >
                  上一页
                </button>
                <button
                  className="button button--outline"
                  type="button"
                  disabled={loading || page * 20 >= data.total}
                  onClick={() => update({ page: String(page + 1) })}
                >
                  下一页
                </button>
              </div>
            </footer>
          </>
        ) : null}
      </section>
    </main>
  );
}
