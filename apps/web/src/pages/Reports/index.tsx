import { useState, useMemo, type ElementType } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChartBar,
  MagnifyingGlass,
  CaretDown,
  CheckCircle,
  XCircle,
  Clock,
  Warning,
  User,
  CalendarCheck,
  GitBranch,
  LinkSimple,
  CaretLeft,
  ArrowsClockwise,
  Info,
  FileCode,
  Stack,
  Database,
  ArrowRight,
} from '@phosphor-icons/react';
import { initialRuns, testPlans } from '../../data';
import type { RunStatus, RunMeta, TriggerType, TestPlan } from '../../types';
import { useWorkflowStore } from '../../stores/workflowStore';
import { LiveRunPanel } from '../../components/reports/LiveRunPanel';

// ─── Report constants ──────────────────────────────────────────

const RUN_STATUS_LABEL: Record<RunStatus | 'all', string> = {
  all: '全部',
  passed: '通过',
  failed: '失败',
  inconclusive: '未决',
  'infra-error': '基础设施错误',
};

const WORKFLOW_STATUS_LABEL: Record<string, string> = {
  passed: '通过',
  failed: '失败',
  skipped: '跳过',
  error: '错误',
};

const TRIGGER_ICON: Record<TriggerType, ElementType> = {
  manual: User,
  scheduled: CalendarCheck,
  ci: GitBranch,
  webhook: LinkSimple,
};

const TRIGGER_LABEL: Record<TriggerType, string> = {
  manual: '手动',
  scheduled: '定时',
  ci: 'CI',
  webhook: 'Webhook',
};

function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

// ─── Report List ────────────────────────────────────────────────

function ReportListView() {
  const navigate = useNavigate();
  const runs = initialRuns;
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | RunStatus>('all');
  const [planFilter, setPlanFilter] = useState('all');
  const [envFilter, setEnvFilter] = useState('all');

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: runs.length };
    for (const s of ['passed', 'failed', 'inconclusive', 'infra-error'] as RunStatus[]) {
      counts[s] = runs.filter((r) => r.status === s).length;
    }
    return counts;
  }, [runs]);

  const envNames = useMemo(() => [...new Set(runs.map((r) => r.environment))].sort(), [runs]);

  const filtered = useMemo(
    () =>
      runs.filter((r) => {
        const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
        const matchesPlan = planFilter === 'all' || r.planId === planFilter;
        const matchesEnv = envFilter === 'all' || r.environment === envFilter;
        const q = query.toLowerCase();
        const matchesQuery =
          !q ||
          r.runId.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          (r.gitCommit ?? '').toLowerCase().includes(q) ||
          r.selectedTags.some((t) => t.toLowerCase().includes(q));
        return matchesStatus && matchesPlan && matchesEnv && matchesQuery;
      }),
    [runs, statusFilter, planFilter, envFilter, query],
  );

  return (
    <main className="page-view">
      <div className="page-intro">
        <div>
          <span className="eyebrow">REPORTS</span>
          <h2>报告中心</h2>
          <p>
            每次测试运行聚合多个业务流程的执行结果，支持按计划选择子集。 共 {runs.length}{' '}
            个运行报告。
          </p>
        </div>
      </div>
      <div className="report-filter-bar variable-filter-bar">
        <div className="filter-tabs">
          {(Object.entries(RUN_STATUS_LABEL) as [RunStatus | 'all', string][]).map(
            ([key, label]) => (
              <button
                key={key}
                type="button"
                className={`filter-tab ${statusFilter === key ? 'filter-tab--active' : ''}`}
                onClick={() => setStatusFilter(key)}
              >
                {label}
                <span className="filter-count">({statusCounts[key] ?? 0})</span>
              </button>
            ),
          )}
        </div>
        <span className="toolbar-spacer" />
        <label className="search-field" style={{ minWidth: 200 }}>
          <MagnifyingGlass size={16} />
          <span className="sr-only">搜索报告</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索运行ID、名称、标签或提交"
          />
        </label>
        <label className="select-wrap">
          <span className="sr-only">计划筛选</span>
          <select value={planFilter} onChange={(e) => setPlanFilter(e.target.value)}>
            <option value="all">全部计划</option>
            {testPlans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <CaretDown size={15} aria-hidden />
        </label>
        <label className="select-wrap">
          <span className="sr-only">环境筛选</span>
          <select value={envFilter} onChange={(e) => setEnvFilter(e.target.value)}>
            <option value="all">全部环境</option>
            {envNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <CaretDown size={15} aria-hidden />
        </label>
      </div>
      <section className="table-panel">
        <div className="data-table reports-table">
          <div className="data-row data-row--head">
            <span>运行 ID</span>
            <span>执行批次</span>
            <span>流程结果</span>
            <span>持续时间</span>
            <span>触发方式</span>
            <span>时间</span>
          </div>
          {filtered.length === 0 ? (
            <div className="empty-module" style={{ border: 'none', minHeight: 240 }}>
              <ChartBar size={42} weight="duotone" />
              <h3>
                {query || statusFilter !== 'all' || planFilter !== 'all' || envFilter !== 'all'
                  ? '没有匹配的报告'
                  : '暂无运行报告'}
              </h3>
              <p>
                {query || statusFilter !== 'all' || planFilter !== 'all' || envFilter !== 'all'
                  ? '试试调整搜索条件或筛选器。'
                  : '触发一次测试运行后，聚合报告将出现在这里。'}
              </p>
            </div>
          ) : (
            filtered.map((r) => {
              const total = r.totalWorkflows;
              const planName = testPlans.find((p) => p.id === r.planId)?.name;
              const TrieIcon = TRIGGER_ICON[r.trigger];
              return (
                <div
                  className="data-row"
                  key={r.id}
                  role="link"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') navigate(`/reports/${r.id}`);
                  }}
                  onClick={() => navigate(`/reports/${r.id}`)}
                >
                  <span>
                    <code className="variable-name-code">{r.runId}</code>
                    <span className={`report-status-dot report-status-dot--${r.status}`}>
                      {r.status === 'passed' ? (
                        <CheckCircle size={14} weight="fill" />
                      ) : r.status === 'failed' ? (
                        <XCircle size={14} weight="fill" />
                      ) : r.status === 'inconclusive' ? (
                        <Clock size={14} weight="fill" />
                      ) : (
                        <Warning size={14} weight="fill" />
                      )}
                      {RUN_STATUS_LABEL[r.status]}
                    </span>
                  </span>
                  <span>
                    <strong>{r.name}</strong>
                    {planName ? (
                      <code>
                        {planName} · {total} 流程
                      </code>
                    ) : (
                      <code>
                        {r.selectedTags.join(' · ')} · {total} 流程
                      </code>
                    )}
                  </span>
                  <span>
                    <span className="report-stats-mini">
                      <span className="pass-count">{r.workflowsPassed}</span>/
                      <span className="fail-count">{r.workflowsFailed}</span>/
                      <span className="skip-count">{r.workflowsSkipped}</span>
                      <span className="report-stats-bar">
                        <span
                          className="bar-pass"
                          style={{ width: `${total > 0 ? (r.workflowsPassed / total) * 100 : 0}%` }}
                        />
                        <span
                          className="bar-fail"
                          style={{ width: `${total > 0 ? (r.workflowsFailed / total) * 100 : 0}%` }}
                        />
                        <span
                          className="bar-skip"
                          style={{
                            width: `${total > 0 ? (r.workflowsSkipped / total) * 100 : 0}%`,
                          }}
                        />
                      </span>
                    </span>
                  </span>
                  <span className="report-duration">{formatDuration(r.totalDurationMs)}</span>
                  <span>
                    <span className="report-trigger-tag">
                      <TrieIcon size={13} /> {TRIGGER_LABEL[r.trigger]}
                    </span>
                  </span>
                  <span className="variable-time-cell">{r.startedAt}</span>
                </div>
              );
            })
          )}
        </div>
      </section>
      <LiveRunPanel />
    </main>
  );
}

// ─── Report Detail ───────────────────────────────────────────────

function ReportsDetailView({ runId }: { runId: string }) {
  const navigate = useNavigate();
  const runs = initialRuns;
  const plans = testPlans;
  const { runWorkflow } = useWorkflowStore();
  const run = runs.find((r) => r.id === runId);

  if (!run) {
    return (
      <main className="page-view">
        <button className="report-detail-back" type="button" onClick={() => navigate('/reports')}>
          <CaretLeft size={16} /> 返回报告列表
        </button>
        <div className="empty-module" style={{ minHeight: 240 }}>
          <Info size={42} weight="duotone" />
          <h3>未找到报告</h3>
          <p>找不到运行 ID 为 {runId} 的报告。</p>
        </div>
      </main>
    );
  }

  const planName = plans.find((p) => p.id === run.planId)?.name;
  const [expandedWf, setExpandedWf] = useState<string | null>(null);

  const toggleWf = (wfId: string) => {
    setExpandedWf((prev) => (prev === wfId ? null : wfId));
  };

  return (
    <main className="page-view report-view">
      <button className="report-detail-back" type="button" onClick={() => navigate('/reports')}>
        <CaretLeft size={16} /> 返回报告列表
      </button>
      <div className="page-intro report-intro">
        <div>
          <span className="eyebrow">RUN {run.runId}</span>
          <h2>{run.name}</h2>
          <p>
            {planName ? `${planName} · ` : ''}
            {run.environment} · {TRIGGER_LABEL[run.trigger]}触发
            {run.selectedTags.length > 0 ? ` · 标签: ${run.selectedTags.join(', ')}` : ''}
          </p>
        </div>
        <div className="report-stats">
          <span>
            <CheckCircle size={22} weight="fill" />
            {run.workflowsPassed}
            <small>流程通过</small>
          </span>
          <span>
            <XCircle size={22} weight="fill" />
            {run.workflowsFailed}
            <small>流程失败</small>
          </span>
          {run.workflowsSkipped > 0 ? (
            <span>
              <Warning size={22} weight="fill" />
              {run.workflowsSkipped}
              <small>跳过</small>
            </span>
          ) : null}
          <span>
            <Clock size={22} />
            {formatDuration(run.totalDurationMs)}
            <small>总耗时</small>
          </span>
          <button
            className="button button--danger"
            type="button"
            onClick={() => void runWorkflow()}
          >
            <ArrowsClockwise size={18} />
            重新运行
          </button>
        </div>
      </div>
      <div className="report-grid">
        <section className="paper-panel report-timeline">
          <h3>执行批次 · {run.totalWorkflows} 个业务流程</h3>
          <div className="data-table" style={{ marginTop: 12 }}>
            <div className="data-row data-row--head workflow-result-head">
              <span>BP ID</span>
              <span>业务流程</span>
              <span>通过/失败</span>
              <span>耗时</span>
              <span>状态</span>
              <span />
            </div>
            {run.workflows.map((wf) => {
              const isExpanded = expandedWf === wf.workflowId;
              const wfTotal = wf.stepsPassed + wf.stepsFailed + wf.stepsSkipped;
              return (
                <div key={wf.workflowId}>
                  <div
                    className={`data-row workflow-result-row workflow-result-row--${wf.status}`}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') toggleWf(wf.workflowId);
                    }}
                    onClick={() => toggleWf(wf.workflowId)}
                  >
                    <span>
                      <code className="variable-name-code">{wf.bpId}</code>
                    </span>
                    <span>
                      <strong>{wf.workflowName}</strong>
                    </span>
                    <span>
                      <span className="report-stats-mini">
                        <span className="pass-count">{wf.stepsPassed}</span>
                        {wf.stepsFailed > 0 ? (
                          <>
                            /<span className="fail-count">{wf.stepsFailed}</span>
                          </>
                        ) : null}
                        {wf.stepsSkipped > 0 ? (
                          <>
                            /<span className="skip-count">{wf.stepsSkipped}</span>
                          </>
                        ) : null}
                        <span className="report-stats-bar">
                          <span
                            className="bar-pass"
                            style={{
                              width: `${wfTotal > 0 ? (wf.stepsPassed / wfTotal) * 100 : 0}%`,
                            }}
                          />
                          <span
                            className="bar-fail"
                            style={{
                              width: `${wfTotal > 0 ? (wf.stepsFailed / wfTotal) * 100 : 0}%`,
                            }}
                          />
                          <span
                            className="bar-skip"
                            style={{
                              width: `${wfTotal > 0 ? (wf.stepsSkipped / wfTotal) * 100 : 0}%`,
                            }}
                          />
                        </span>
                      </span>
                    </span>
                    <span className="report-duration">
                      {wf.totalDurationMs > 0 ? formatDuration(wf.totalDurationMs) : '—'}
                    </span>
                    <span>
                      <span
                        className={`status-badge status-badge--${wf.status === 'passed' ? 'passed' : wf.status === 'failed' ? 'failed' : 'warning'}`}
                      >
                        {WORKFLOW_STATUS_LABEL[wf.status]}
                      </span>
                    </span>
                    <span className="variable-time-cell">
                      <CaretDown
                        size={16}
                        style={{
                          transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 160ms ease',
                        }}
                      />
                    </span>
                  </div>
                  {isExpanded ? (
                    <div className="workflow-expand-panel">
                      {wf.steps.length === 0 ? (
                        <div className="empty-module" style={{ border: 'none', minHeight: 100 }}>
                          <Info size={20} weight="duotone" />
                          <p>该流程没有步骤数据。</p>
                        </div>
                      ) : (
                        wf.steps.map((step, stepIdx) => {
                          const isLast = stepIdx === wf.steps.length - 1;
                          return (
                            <div
                              className={`timeline-step ${step.status === 'failed' ? 'timeline-step--failed' : ''} ${step.status === 'skipped' ? 'timeline-step--failed' : ''} ${isLast ? 'timeline-step--last' : ''}`}
                              key={step.id}
                            >
                              <span className="timeline-index">{stepIdx + 1}</span>
                              <span className="timeline-status">
                                {step.status === 'passed' ? (
                                  <CheckCircle size={20} weight="fill" />
                                ) : step.status === 'failed' ? (
                                  <XCircle size={20} weight="fill" />
                                ) : (
                                  <Warning size={20} weight="fill" />
                                )}
                              </span>
                              <div>
                                <strong>{step.name}</strong>
                                <code>
                                  {step.method} {step.path}
                                </code>
                                {step.status === 'failed' ? (
                                  <div className="evidence-grid">
                                    {step.requestEvidence ? (
                                      <span>
                                        <small>请求证据</small>
                                        <pre>{step.requestEvidence}</pre>
                                      </span>
                                    ) : null}
                                    {step.responseEvidence ? (
                                      <span>
                                        <small>响应</small>
                                        <pre>{step.responseEvidence}</pre>
                                      </span>
                                    ) : null}
                                    {step.assertionFailure ? (
                                      <span>
                                        <small>断言失败</small>
                                        <p>{step.assertionFailure}</p>
                                      </span>
                                    ) : null}
                                  </div>
                                ) : null}
                                {step.status === 'skipped' && step.assertionFailure ? (
                                  <div className="evidence-grid">
                                    <span>
                                      <small>跳过原因</small>
                                      <p>{step.assertionFailure}</p>
                                    </span>
                                  </div>
                                ) : null}
                              </div>
                              <time>{step.durationMs > 0 ? `${step.durationMs}ms` : '—'}</time>
                            </div>
                          );
                        })
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
        <aside className="trace-card">
          <span className="eyebrow">TRACEABILITY</span>
          <h3>可追溯信息</h3>
          <dl>
            <dt>
              <GitBranch size={16} /> Git 提交
            </dt>
            <dd>{run.gitCommit ? `${run.gitSha} · ${run.gitCommit}` : '—'}</dd>
            <dt>
              <FileCode size={16} /> OpenAPI 版本
            </dt>
            <dd>{run.openapiVersion ?? '—'}</dd>
            <dt>
              <Stack size={16} /> 环境
            </dt>
            <dd>{run.environment}</dd>
            <dt>
              <Database size={16} /> 执行机
            </dt>
            <dd>runner-02 · {run.runnerVersion ?? '未知'}</dd>
          </dl>
        </aside>
      </div>
    </main>
  );
}

// ─── Page Router ─────────────────────────────────────────────────

export function ReportsPage() {
  return <ReportListView />;
}

export function ReportsDetailWrapper({ runId }: { runId: string }) {
  return <ReportsDetailView runId={runId} />;
}
