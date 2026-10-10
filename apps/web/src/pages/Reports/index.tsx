import {
  ArrowClockwise,
  CaretLeft,
  CheckCircle,
  ClipboardText,
  Clock,
  Code,
  FileText,
  Info,
  Warning,
  XCircle,
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { cpClient, type RunReport, type RunSummary } from '../../lib/cp-client';
import { isActiveRun, statusLabel, statusTone } from '../../lib/run-status';
import { ReportListView } from './ReportListView';
import './reports.css';

type EvidenceTab = 'request' | 'response' | 'assertion' | 'events';

function StatusIcon({ status }: { status: string }) {
  const tone = statusTone(status);
  if (tone === 'passed') return <CheckCircle aria-hidden size={17} weight="fill" />;
  if (tone === 'failed') return <XCircle aria-hidden size={17} weight="fill" />;
  return <Warning aria-hidden size={17} weight="fill" />;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('zh-CN', {
        dateStyle: 'medium',
        timeStyle: 'medium',
        hour12: false,
      }).format(date);
}

function formatDuration(milliseconds?: number): string {
  if (milliseconds == null) return '—';
  return milliseconds >= 1000 ? `${(milliseconds / 1000).toFixed(1)}s` : `${milliseconds}ms`;
}

function runSource(run: RunSummary): string {
  if (run.workflowVersionId) return `WorkflowVersion · ${run.workflowVersionId}`;
  if (run.testCaseVersionId) return `TestCaseVersion · ${run.testCaseVersionId}`;
  if (run.apiVersionId) return `ApiVersion · ${run.apiVersionId}`;
  return 'Ad-hoc Run';
}

function payloadText(payload: unknown): string {
  if (payload == null) return '—';
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function latestPayload(
  step: RunReport['steps'][number] | undefined,
  eventTypes: string[],
): unknown {
  if (!step) return undefined;
  return [...step.events].reverse().find((event) => eventTypes.includes(event.eventType))?.payload;
}

function ReportDetailView({ runId }: { runId: string }) {
  const navigate = useNavigate();
  const [report, setReport] = useState<RunReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStepIndex, setSelectedStepIndex] = useState<number | null>(null);
  const [tab, setTab] = useState<EvidenceTab>('assertion');

  const [params] = useSearchParams();
  const [revision, setRevision] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const load = () => setRevision((value) => value + 1);
  const back = () => navigate(`/reports?${params}`);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void cpClient
      .getReport(runId, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setReport(next);
        setSelectedStepIndex((current) =>
          current !== null && next.steps.some((step) => step.stepIndex === current)
            ? current
            : (next.steps.find((step) => ['failed', 'error'].includes(step.status))?.stepIndex ??
              next.steps[0]?.stepIndex ??
              null),
        );
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : '无法读取报告');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [runId, revision]);
  useEffect(() => {
    if (!autoRefresh || !report || !isActiveRun(report.run.status)) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setRevision((value) => value + 1);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, report]);

  if (loading && !report)
    return (
      <main className="page-view">
        <div className="empty-module">
          <Clock aria-hidden size={36} weight="duotone" />
          <h3>正在加载报告</h3>
        </div>
      </main>
    );
  if (error || !report)
    return (
      <main className="page-view">
        <button className="report-detail-back" type="button" onClick={back}>
          <CaretLeft aria-hidden size={16} /> 返回报告中心
        </button>
        <div className="empty-module" role="alert">
          <Info aria-hidden size={42} weight="duotone" />
          <h3>无法打开运行报告</h3>
          <p>{error ?? '该运行不存在，或你没有访问权限。'}</p>
          <button
            className="button button--secondary"
            type="button"
            disabled={loading}
            onClick={() => void load()}
          >
            重试
          </button>
        </div>
      </main>
    );

  const problemSteps = report.steps.filter((step) => ['failed', 'error'].includes(step.status));
  const selectedStep = report.steps.find((step) => step.stepIndex === selectedStepIndex);
  const evidence: Record<EvidenceTab, unknown> = {
    request:
      latestPayload(selectedStep, ['request.prepared']) ??
      latestPayload(selectedStep, ['request.sent']),
    response: latestPayload(selectedStep, ['response.received']),
    assertion:
      selectedStep?.events
        .filter((event) => ['assertion.evaluated', 'assertion.ran'].includes(event.eventType))
        .map((event) => event.payload) ?? [],
    events: selectedStep?.events ?? [],
  };

  return (
    <main className="page-view scenario-report-detail">
      <button className="report-detail-back" type="button" onClick={back}>
        <CaretLeft aria-hidden size={16} /> 返回报告中心
      </button>
      <header className="scenario-report-detail__header">
        <div>
          <span className="eyebrow">RUN EVIDENCE</span>
          <h2>{report.run.sourceName ?? report.run.id}</h2>
          <code>{report.run.id}</code>
          <p>
            {runSource(report.run)} · 创建于 {formatDate(report.run.createdAt)}
          </p>
        </div>
        <button
          className="button button--secondary"
          type="button"
          disabled={loading}
          onClick={() => void load()}
        >
          <ArrowClockwise aria-hidden size={16} /> {loading ? '更新中…' : '刷新证据'}
        </button>
      </header>
      <section className="report-fact" aria-label="运行状态">
        <div
          className={`report-fact__assertion report-fact__assertion--${statusTone(report.run.status)}`}
        >
          <span className="eyebrow">RUN STATUS</span>
          <div>
            <StatusIcon status={report.run.status} />
            <strong>{statusLabel(report.run.status)}</strong>
          </div>
          <p>
            {report.run.status === 'passed'
              ? '已执行的断言通过；请结合业务覆盖范围判断。'
              : report.run.status === 'failed'
                ? '存在阻断失败，检查下方步骤证据。'
                : isActiveRun(report.run.status)
                  ? '运行尚未完成，当前证据不代表最终结论。'
                  : '请结合步骤事件判断原因，不能据此宣称业务通过。'}
          </p>
        </div>
        <div className="report-fact__execution">
          <span className="eyebrow">EXECUTION</span>
          <dl>
            <div>
              <dt>创建时间</dt>
              <dd>{formatDate(report.run.createdAt)}</dd>
            </div>
            <div>
              <dt>完成时间</dt>
              <dd>{formatDate(report.run.finishedAt)}</dd>
            </div>
            <div>
              <dt>Runner</dt>
              <dd>{report.run.runnerId ?? '—'}</dd>
            </div>
          </dl>
        </div>
      </section>
      <section className="report-diagnosis" aria-label="回归结论">
        <div>
          <span className="eyebrow">NEXT ACTION</span>
          <h3>
            {problemSteps.length
              ? '先看这些失败步骤'
              : isActiveRun(report.run.status)
                ? '等待执行完成'
                : '核对结果与业务预期'}
          </h3>
          <p>
            {report.steps.filter((step) => step.status === 'passed').length} 步通过 ·{' '}
            {problemSteps.length} 步失败或异常 ·{' '}
            {report.steps.filter((step) => ['not_run', 'skipped'].includes(step.status)).length}{' '}
            步未执行或跳过
          </p>
        </div>
        <div className="report-problem-links">
          {problemSteps.map((step) => (
            <button
              key={step.stepIndex}
              type="button"
              className="button button--outline"
              onClick={() => {
                setSelectedStepIndex(step.stepIndex);
                setTab(step.status === 'error' ? 'events' : 'assertion');
                document
                  .getElementById('step-evidence')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              {step.name ?? `步骤 ${step.stepIndex + 1}`} · {statusLabel(step.status)}
            </button>
          ))}
        </div>
        {isActiveRun(report.run.status) ? (
          <label>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
            />
            每 5 秒更新证据
          </label>
        ) : null}
      </section>
      <div className="scenario-report-detail__layout">
        <div>
          <section className="step-timeline" aria-label="StepRun 执行时间线">
            <div className="step-timeline__head">
              <div>
                <span className="eyebrow">STEPRUN TIMELINE</span>
                <h3>执行过程</h3>
              </div>
              <span>{report.steps.length} 个 StepRun</span>
            </div>
            {report.steps.length === 0 ? (
              <div className="empty-module">
                <Clock aria-hidden size={32} />
                <h3>Runner 尚未写入步骤事件</h3>
                <p>运行开始后，步骤证据会在此按序出现。</p>
              </div>
            ) : (
              report.steps.map((step) => (
                <button
                  aria-pressed={selectedStepIndex === step.stepIndex}
                  className={`step-timeline__row step-timeline__row--${statusTone(step.status)} ${selectedStepIndex === step.stepIndex ? 'is-selected' : ''}`}
                  key={step.stepIndex}
                  onClick={() => setSelectedStepIndex(step.stepIndex)}
                  type="button"
                >
                  <span className="step-timeline__index">{step.stepIndex + 1}</span>
                  <span className="step-timeline__state">
                    <StatusIcon status={step.status} />
                  </span>
                  <span className="step-timeline__name">
                    <strong>
                      {step.phase === 'teardown' ? '清理 · ' : ''}
                      {step.name ?? `步骤 ${step.stepIndex + 1}`}
                    </strong>
                    <code>{statusLabel(step.status)}</code>
                    <small>{step.events.length} 条事件</small>
                  </span>
                  <time>{formatDuration(step.durationMs)}</time>
                </button>
              ))
            )}
          </section>
          <section id="step-evidence" className="report-evidence" aria-label="步骤证据">
            <div className="report-evidence__head">
              <div>
                <span className="eyebrow">EVIDENCE</span>
                <h3>{selectedStep?.name ?? '步骤证据'}</h3>
                <p>
                  Runner 已脱敏 · {selectedStep?.method} {selectedStep?.url}
                </p>
              </div>
              <ClipboardText aria-hidden size={20} />
            </div>
            <div className="report-evidence__tabs" role="tablist" aria-label="证据类型">
              {(
                [
                  ['request', '请求'],
                  ['response', '响应'],
                  ['assertion', '断言'],
                  ['events', '事件'],
                ] as const
              ).map(([value, label]) => (
                <button
                  aria-selected={tab === value}
                  className={tab === value ? 'is-active' : ''}
                  key={value}
                  id={`evidence-tab-${value}`}
                  aria-controls="evidence-panel"
                  tabIndex={tab === value ? 0 : -1}
                  onKeyDown={(event) => {
                    const values: EvidenceTab[] = ['request', 'response', 'assertion', 'events'];
                    const offset =
                      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                    if (!offset && event.key !== 'Home' && event.key !== 'End') return;
                    event.preventDefault();
                    const index =
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? 3
                          : (values.indexOf(value) + offset + 4) % 4;
                    const next = values[index];
                    if (next) {
                      setTab(next);
                      document.getElementById(`evidence-tab-${next}`)?.focus();
                    }
                  }}
                  onClick={() => setTab(value)}
                  role="tab"
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            {selectedStep?.error ? (
              <div className="report-step-error" role="status">
                <strong>执行异常 · {selectedStep.error.type}</strong>
                <p>{selectedStep.error.message}</p>
              </div>
            ) : null}
            <div
              id="evidence-panel"
              role="tabpanel"
              aria-labelledby={`evidence-tab-${tab}`}
              aria-label={tab === 'assertion' ? '断言证据' : '步骤原始证据'}
            >
              {tab === 'assertion' && selectedStep?.assertions ? (
                <div className="report-assertions">
                  {selectedStep.assertions.length === 0 ? (
                    <p>该步骤尚无断言证据。没有断言记录不代表验证通过。</p>
                  ) : (
                    selectedStep.assertions.map((assertion, index) => (
                      <article
                        className={`report-assertion report-assertion--${assertion.passed ? 'passed' : 'failed'}`}
                        key={`${assertion.assertionId}-${index}`}
                      >
                        <header>
                          <strong>
                            {assertion.description ?? assertion.assertionId ?? '断言'}
                          </strong>
                          <span>
                            {assertion.passed
                              ? '通过'
                              : assertion.severity === 'warn'
                                ? '警告'
                                : '失败'}{' '}
                            · 第 {assertion.attempt ?? 1} 次尝试
                          </span>
                        </header>
                        <dl>
                          <div>
                            <dt>预期值</dt>
                            <dd>
                              <pre>{assertion.expected ?? '未记录'}</pre>
                            </dd>
                          </div>
                          <div>
                            <dt>实际值</dt>
                            <dd>
                              <pre>{assertion.actual ?? '未记录'}</pre>
                            </dd>
                          </div>
                        </dl>
                        {assertion.schemaDiff ? <pre>{assertion.schemaDiff}</pre> : null}
                      </article>
                    ))
                  )}
                </div>
              ) : (
                <pre>{payloadText(evidence[tab])}</pre>
              )}
            </div>
          </section>
        </div>
        <aside className="traceability-panel" aria-label="可追溯信息">
          <span className="eyebrow">TRACEABILITY</span>
          <h3>运行快照</h3>
          <dl>
            <div>
              <dt>
                <FileText aria-hidden size={15} /> Run
              </dt>
              <dd>{report.run.id}</dd>
            </div>
            <div>
              <dt>
                <Code aria-hidden size={15} /> WorkflowVersion
              </dt>
              <dd>{report.run.workflowVersionId ?? '—'}</dd>
            </div>
            <div>
              <dt>TestCaseVersion</dt>
              <dd>{report.run.testCaseVersionId ?? '—'}</dd>
            </div>
            <div>
              <dt>EnvironmentVersion</dt>
              <dd>{report.run.environmentVersionId ?? '—'}</dd>
            </div>
            <div>
              <dt>ApiVersion</dt>
              <dd>{report.run.apiVersionId ?? '—'}</dd>
            </div>
            <div>
              <dt>Runner</dt>
              <dd>{report.run.runnerId ?? '—'}</dd>
            </div>
            <div>
              <dt>
                <Clock aria-hidden size={15} /> StepRun
              </dt>
              <dd>
                {selectedStep
                  ? `${selectedStep.stepIndex + 1} · ${statusLabel(selectedStep.status)}`
                  : '—'}
              </dd>
            </div>
          </dl>
        </aside>
      </div>
    </main>
  );
}

export function ReportsPage() {
  return <ReportListView />;
}

export function ReportsDetailWrapper() {
  const { runId } = useParams<{ runId: string }>();
  if (!runId) return null;
  return <ReportDetailView key={runId} runId={runId} />;
}
