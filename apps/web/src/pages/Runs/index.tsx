import { ArrowClockwise, Pulse, Warning } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { cpClient, type RunReport, type RunSummary } from '../../lib/cp-client';

export function RunsPage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [report, setReport] = useState<RunReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await cpClient.listRuns();
      setRuns(response.runs);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法加载运行');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function inspect(runId: string) {
    setError(null);
    try {
      setReport(await cpClient.getReport(runId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法加载报告');
    }
  }

  return (
    <main className="page-view">
      <div className="page-intro">
        <div>
          <span className="eyebrow">RUN EVIDENCE</span>
          <h2>运行与报告</h2>
          <p>状态、来源和事件均直接读取 Control Plane。</p>
        </div>
        <button className="button button--outline" type="button" onClick={() => void refresh()}>
          <ArrowClockwise size={18} />
          刷新
        </button>
      </div>

      {error ? (
        <div className="paper-panel error-panel" role="alert">
          <Warning size={22} />
          {error}
        </div>
      ) : null}
      <section className="table-panel" aria-busy={loading}>
        <div className="section-heading">
          <h3>Runs</h3>
          <span className="status-badge">{runs.length}</span>
        </div>
        {loading ? <p>正在加载…</p> : null}
        {!loading && runs.length === 0 ? (
          <div className="empty-state">
            <Pulse size={42} />
            <h3>暂无运行</h3>
            <p>从流程执行页创建第一个 Run。</p>
          </div>
        ) : null}
        {runs.length > 0 ? (
          <div className="data-table runs-table">
            <div className="data-row data-row--head">
              <span>Run</span>
              <span>来源</span>
              <span>状态</span>
              <span>时间</span>
              <span>证据</span>
            </div>
            {runs.map((run) => (
              <div className="data-row" key={run.id}>
                <code>{run.id}</code>
                <code>
                  {run.workflowVersionId ?? run.testCaseVersionId ?? run.apiVersionId ?? 'ad-hoc'}
                </code>
                <span className={`status-badge status-badge--${run.status}`}>{run.status}</span>
                <span>{new Date(run.createdAt).toLocaleString()}</span>
                <button
                  className="button button--outline"
                  type="button"
                  onClick={() => void inspect(run.id)}
                >
                  查看报告
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {report ? (
        <section className="paper-panel report-panel" aria-label="运行报告">
          <div className="section-heading">
            <div>
              <span className="eyebrow">EVIDENCE REPORT</span>
              <h3>{report.run.id}</h3>
            </div>
            <span className={`status-badge status-badge--${report.run.status}`}>
              {report.run.status}
            </span>
          </div>
          {report.steps.map((step) => (
            <article className="report-step" key={step.stepIndex}>
              <header>
                <strong>Step {step.stepIndex + 1}</strong>
                <span>
                  {step.status} · {step.durationMs ?? '—'} ms
                </span>
              </header>
              <ol>
                {step.events.map((event, index) => (
                  <li key={`${event.eventType}-${index}`}>
                    <code>{event.eventType}</code>
                    <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </section>
      ) : null}
    </main>
  );
}
