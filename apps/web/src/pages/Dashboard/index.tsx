import { CaretRight } from '@phosphor-icons/react/CaretRight';
import { CheckCircle } from '@phosphor-icons/react/CheckCircle';
import { ClipboardText } from '@phosphor-icons/react/ClipboardText';
import { FileArrowUp } from '@phosphor-icons/react/FileArrowUp';
import { FlowArrow } from '@phosphor-icons/react/FlowArrow';
import { PlugsConnected } from '@phosphor-icons/react/PlugsConnected';
import { XCircle } from '@phosphor-icons/react/XCircle';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorCallout } from '../../components/shared/ErrorCallout';
import {
  type ApiVersionSummary,
  cpClient,
  type RunCounts,
  type RunSummary,
  type Workflow,
} from '../../lib/cp-client';
import { statusLabel, statusTone } from '../../lib/run-status';
import { useAuthStore } from '../../stores/authStore';
import { MetricCard } from './MetricCard';

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(
    new Date(value),
  );
}

export default function DashboardOverview() {
  const navigate = useNavigate();
  const workspaceId = useAuthStore((state) => state.user?.workspaceId);
  const [summary, setSummary] = useState<RunCounts | null>(null);
  const [attentionRuns, setAttentionRuns] = useState<RunSummary[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [testCaseCount, setTestCaseCount] = useState(0);
  const [apiVersions, setApiVersions] = useState<ApiVersionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [runResult, workflowResult, testCaseResult, apiVersionResult, attentionResult] =
        await Promise.all([
          cpClient.listRuns({ days: 7, pageSize: 50 }),
          cpClient.listWorkflows(workspaceId),
          cpClient.listTestCases(workspaceId),
          cpClient.listApiVersions(),
          cpClient.listRuns({ days: 7, status: 'attention', pageSize: 3 }),
        ]);
      setRuns(runResult.runs);
      setAttentionRuns(attentionResult.runs);
      setSummary(runResult.summary);
      setWorkflows(workflowResult.workflows);
      setTestCaseCount(testCaseResult.testCases.length);
      setApiVersions(apiVersionResult.apiVersions);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法读取仪表盘数据。');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const passed = summary?.passed ?? 0;
    const failed = summary?.failed ?? 0;
    const finished = passed + failed;
    const endpointCount = apiVersions.reduce((total, version) => total + version.endpointCount, 0);
    return {
      passed,
      failed,
      endpointCount,
      active: summary?.active ?? 0,
      unresolved: summary?.unresolved ?? 0,
      cancelled: summary?.cancelled ?? 0,
      passRate: finished ? `${((passed / finished) * 100).toFixed(1)}%` : '—',
    };
  }, [apiVersions, summary]);

  return (
    <main className="page-view overview-view">
      <section className="paper-panel regression-start" aria-labelledby="regression-start-title">
        <span className="eyebrow">可信回归，从一个关键流程开始</span>
        <h2 id="regression-start-title">
          {runs.length ? '让每次回归都有可追溯的结论' : '建立第一条业务回归'}
        </h2>
        <p>选定一个必须正常工作的业务流程，明确预期结果，再用运行证据验证它。</p>
        <ol className="regression-steps">
          <li>
            <strong>01 · 准备接口</strong>
            <p>导入接口定义，确认请求与响应约定。</p>
            <button className="text-button" type="button" onClick={() => navigate('/apis')}>
              打开接口管理 <CaretRight size={15} />
            </button>
          </li>
          <li>
            <strong>02 · 编排与审阅</strong>
            <p>连接业务步骤，检查断言、变量和清理操作。</p>
            <button className="text-button" type="button" onClick={() => navigate('/workflows')}>
              打开业务流程 <CaretRight size={15} />
            </button>
          </li>
          <li>
            <strong>03 · 执行与取证</strong>
            <p>在流程中发布并运行，再查看失败步骤与证据。</p>
            <button
              className="text-button"
              type="button"
              onClick={() => navigate(runs.length ? '/reports' : '/workflows')}
            >
              {runs.length ? '查看运行证据' : '前往流程执行'} <CaretRight size={15} />
            </button>
          </li>
        </ol>
      </section>
      <div className="page-actions-row">
        <button className="button button--primary" type="button" onClick={() => navigate('/apis')}>
          <FileArrowUp size={18} />
          导入 OpenAPI
        </button>
      </div>
      {error ? <ErrorCallout title="仪表盘数据暂不可用" message={error} onRetry={load} /> : null}
      {!error ? (
        <>
          <section className="metrics-grid" aria-label="质量指标">
            <MetricCard
              icon={PlugsConnected}
              label="端点版本记录"
              value={String(stats.endpointCount)}
              delta={`${apiVersions.length} 个 API 版本`}
              tone="brown"
            />
            <MetricCard
              icon={CheckCircle}
              label="近 7 天明确结论通过率"
              value={stats.passRate}
              delta={`${stats.passed} 次通过 / ${stats.passed + stats.failed} 次有明确结论的运行`}
              tone="green"
            />
            <MetricCard
              icon={ClipboardText}
              label="测试用例"
              value={String(testCaseCount)}
              delta="已保存用例资产"
              tone="amber"
            />
            <MetricCard
              icon={FlowArrow}
              label="业务流程"
              value={String(workflows.length)}
              delta="来自当前工作区"
              tone="violet"
            />
            <MetricCard
              icon={XCircle}
              label="失败运行"
              value={String(stats.failed)}
              delta="可在报告中心查看证据"
              tone="brick"
            />
          </section>
          <div className="overview-grid">
            <section className="paper-panel health-panel">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">RUN STATUS</span>
                  <h3>运行健康度</h3>
                </div>
              </div>
              <div className="chart-legend">
                <span>
                  <i className="dot dot--success" />
                  通过 {stats.passed}
                </span>
                <span>
                  <i className="dot dot--failure" />
                  失败 {stats.failed}
                </span>
                <span>
                  <i className="dot dot--muted" />
                  进行中 {stats.active}
                </span>
                <span>无法判断或失联 {stats.unresolved}</span>
                <span>已取消 {stats.cancelled}</span>
              </div>
              <p>
                {loading
                  ? '正在读取运行记录...'
                  : runs.length
                    ? `近 7 天共 ${summary?.total ?? 0} 条运行记录；下方展示最近记录。`
                    : '尚无运行记录。发布流程或创建自定义运行后，数据会显示在此。'}
              </p>
            </section>
            <section className="paper-panel recent-panel">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">RECENT RUNS</span>
                  <h3>最近执行</h3>
                </div>
                <button className="text-button" type="button" onClick={() => navigate('/reports')}>
                  查看全部 <CaretRight size={15} />
                </button>
              </div>
              {runs.slice(0, 5).map((run) => {
                const status = statusTone(run.status);
                return (
                  <button
                    className="recent-row"
                    type="button"
                    key={run.id}
                    onClick={() => navigate(`/reports/${run.id}`)}
                  >
                    <time>{formatTime(run.createdAt)}</time>
                    <strong>
                      {run.sourceName ?? (run.workflowVersionId ? '流程运行' : '自定义运行')}
                    </strong>
                    <span className="env-tag">{run.id}</span>
                    <span>{statusLabel(run.status)}</span>
                    <span
                      className={`status-badge status-badge--${status === 'passed' ? 'passed' : status === 'failed' ? 'failed' : 'pending'}`}
                    >
                      {statusLabel(run.status)}
                    </span>
                    <CaretRight size={15} />
                  </button>
                );
              })}
              {!loading && !runs.length ? <p>尚未执行回归。</p> : null}
            </section>
            <section className="paper-panel attention-panel">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">NEEDS ATTENTION</span>
                  <h3>需要关注</h3>
                </div>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => navigate('/reports?status=attention&days=7')}
                >
                  查看全部 {stats.failed + stats.unresolved}
                </button>
              </div>
              {attentionRuns.map((run) => (
                <button
                  className="failure-row"
                  type="button"
                  key={run.id}
                  onClick={() => navigate(`/reports/${run.id}`)}
                >
                  <span className="failure-pin" />
                  <code>{run.id}</code>
                  <span>
                    {run.sourceName ?? '运行'} · {statusLabel(run.status)}
                  </span>
                  <time>{formatTime(run.createdAt)}</time>
                </button>
              ))}
              {!loading && !stats.failed && !stats.unresolved ? (
                <p>近 7 天没有需要关注的运行。</p>
              ) : null}
            </section>
            <section className="paper-panel flow-preview">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">BUSINESS FLOWS</span>
                  <h3>业务流程速览</h3>
                </div>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => navigate('/workflows')}
                >
                  浏览全部 <CaretRight size={15} />
                </button>
              </div>
              <div className="quick-flows-grid">
                {workflows.slice(0, 4).map((workflow) => (
                  <button
                    key={workflow.id}
                    type="button"
                    className="quick-flow-card"
                    onClick={() => navigate(`/workflows/${workflow.id}`)}
                  >
                    <span className="bp-badge bp-badge--normal">流程</span>
                    <strong>{workflow.name}</strong>
                    <small>{workflow.description || '尚无说明'}</small>
                    <span className="bp-status">查看流程</span>
                  </button>
                ))}
              </div>
              {!loading && !workflows.length ? <p>暂无流程。创建后会在此显示。</p> : null}
            </section>
          </div>
        </>
      ) : null}
    </main>
  );
}
