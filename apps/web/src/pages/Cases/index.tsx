import { Check, CheckCircle, MagnifyingGlass, X } from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ErrorCallout } from '../../components/shared/ErrorCallout';
import { cpClient, type Draft, type TestCase } from '../../lib/cp-client';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { CaseProvenance } from '../AgentSettings/Execution';
import { RunPublishedTest } from './RunPublishedTest';
import './cases.css';
import '../Agent/agent.css';

function definitionName(draft: Draft): string {
  if (typeof draft.definition?.['name'] === 'string') return draft.definition['name'];
  return draft.definitionSummary?.name ?? '未命名生成草稿';
}

function endpoint(draft: Draft): string {
  const method = draft.sourceInfo['method'];
  const path = draft.sourceInfo['path'];
  return typeof method === 'string' && typeof path === 'string'
    ? `${method} ${path}`
    : typeof draft.sourceInfo['endpointId'] === 'string'
      ? `接口 ${draft.sourceInfo['endpointId']}`
      : '来源接口未提供';
}

function versionLabel(testCase: TestCase): string {
  const version = testCase.latestVersion;
  if (!version) return '尚无版本';
  return `v${version.version}${version.publishedBy ? ' · 已发布' : ' · 草稿'}`;
}

function CodeEvidence({ draft }: { draft: Draft }) {
  const commit = draft.sourceInfo['commit'];
  const locations = draft.sourceInfo['codeLocations'];
  if (typeof commit !== 'string' || !Array.isArray(locations)) return null;
  return (
    <section className="agent-source-evidence" aria-label="草稿代码来源">
      <strong>代码提交 {commit}</strong>
      <ul>
        {locations.map((item: { sourceLabel?: string; location?: string }, index: number) =>
          typeof item.location === 'string' && item.location.startsWith('https://github.com/') ? (
            <li key={`${index}-${item.location}`}>
              <a href={item.location} target="_blank" rel="noreferrer">
                {item.sourceLabel} · {item.location.split('#').at(-1)}
              </a>
            </li>
          ) : null,
        )}
      </ul>
      <p>代码静态证据用于定位来源；鉴权、异常与业务规则仍需人工核验。</p>
    </section>
  );
}

export function CasesPage() {
  const user = useAuthStore((state) => state.user);
  const notify = useUIStore((state) => state.notify);
  const [params] = useSearchParams();
  const generationJobId = params.get('generationJobId');
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeDraft, setActiveDraft] = useState<Draft | null>(null);
  const [definitionText, setDefinitionText] = useState('');
  const [reviewReason, setReviewReason] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [generationStatus, setGenerationStatus] = useState<
    'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | null
  >(null);

  const refresh = useCallback(async () => {
    if (!user?.workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await cpClient.listTestCases(user.workspaceId);
      setTestCases(result.testCases);
      setSelectedId((current) => current ?? result.testCases[0]?.id ?? null);
      if (generationJobId) {
        const job = await cpClient.getGenerationJob(generationJobId);
        setGenerationStatus(job.status);
        if (job.status === 'completed')
          setDrafts((await cpClient.listDrafts(generationJobId)).drafts);
        else if (job.status === 'failed') setError('生成任务失败，未产生可审核草稿。');
      } else {
        const jobs = (await cpClient.listGenerationJobs(user.workspaceId)).jobs.filter(
          (j) => j.status === 'completed',
        );
        const queues = await Promise.all(jobs.map((job) => cpClient.listDrafts(job.id)));
        setDrafts(queues.flatMap((queue) => queue.drafts).filter((d) => d.status === 'pending'));
        setGenerationStatus(null);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法加载 Control Plane 用例数据。');
    } finally {
      setLoading(false);
    }
  }, [generationJobId, user?.workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (generationStatus !== 'pending' && generationStatus !== 'running') return;
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [generationStatus, refresh]);

  const visibleCases = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return testCases.filter((item) =>
      `${item.name} ${item.description}`.toLowerCase().includes(needle),
    );
  }, [query, testCases]);
  const selected = visibleCases.find((item) => item.id === selectedId) ?? visibleCases[0] ?? null;

  const review = async (draft: Draft, decision: 'accept' | 'reject') => {
    setReviewing(draft.id);
    try {
      if (decision === 'accept') {
        const definition = JSON.parse(definitionText) as Record<string, unknown>;
        const changed = JSON.stringify(definition) !== JSON.stringify(activeDraft?.definition);
        const result = await cpClient.acceptDraft(
          draft.id,
          undefined,
          changed ? definition : undefined,
        );
        setSelectedId(result.testCaseId);
      } else await cpClient.rejectDraft(draft.id, reviewReason || undefined);
      setActiveDraft(null);
      notify(
        decision === 'accept' ? '草稿已接受。用例版本尚未发布，请确认后发布。' : '草稿已拒绝。',
      );
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '草稿审核失败。');
    } finally {
      setReviewing(null);
    }
  };

  return (
    <main className="case-workbench" aria-label="用例管理">
      {error ? <ErrorCallout title="用例操作未完成" message={error} onRetry={refresh} /> : null}
      {generationJobId || drafts.length ? (
        <section className="case-live-drafts" aria-label="生成草稿审核">
          <div>
            <span className="eyebrow">人工审阅</span>
            <h3>{generationJobId ? '本次生成草稿' : '工作区待审草稿'}</h3>
            <p>先核对请求与断言，再接受为用例草稿。发布与执行是后续独立操作。</p>
          </div>
          <div
            className="case-live-drafts__list"
            role="region"
            aria-label="待审草稿列表"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access to the scrollable queue.
            tabIndex={0}
          >
            {drafts.map((draft) => (
              <article key={draft.id}>
                <div>
                  <strong>{definitionName(draft)}</strong>
                  <span>
                    {endpoint(draft)} ·{' '}
                    {draft.confidence === null
                      ? '模型草稿 · 未验证'
                      : `规则评分 ${Math.round(draft.confidence * 100)}%`}{' '}
                    · {draft.status}
                  </span>
                </div>
                {draft.status === 'pending' ? (
                  <div className="case-live-drafts__actions">
                    <button
                      className="button button--primary button--sm"
                      type="button"
                      disabled={reviewing === draft.id}
                      onClick={async () => {
                        try {
                          const full = await cpClient.getDraft(draft.id);
                          setActiveDraft(full);
                          setDefinitionText(JSON.stringify(full.definition, null, 2));
                          setReviewReason('');
                        } catch (e) {
                          setError(e instanceof Error ? e.message : '无法读取草稿');
                        }
                      }}
                    >
                      <Check size={14} /> 查看并审阅
                    </button>
                  </div>
                ) : (
                  <span className="case-live-drafts__state">已审核</span>
                )}
              </article>
            ))}
          </div>
          {activeDraft ? (
            <section className="draft-review" aria-label="审阅完整草稿">
              <h3>{definitionName(activeDraft)}</h3>
              <dl>
                <dt>来源 API 版本</dt>
                <dd>{String(activeDraft.sourceInfo['apiVersionId'] ?? '未提供')}</dd>
                <dt>模型 / 规则</dt>
                <dd>
                  {String(
                    activeDraft.sourceInfo['model'] ??
                      activeDraft.sourceInfo['strategy'] ??
                      '未提供',
                  )}
                </dd>
                <dt>风险</dt>
                <dd>{String(activeDraft.definition?.['sideEffect'] ?? '未分类')}</dd>
                <dt>来源校验</dt>
                <dd>{String(activeDraft.sourceInfo['sourceHash'] ?? '规则生成')}</dd>
              </dl>
              <CodeEvidence draft={activeDraft} />
              <p>
                {String(
                  activeDraft.sourceInfo['rationale'] ??
                    '请核对契约与业务预期；规则评分不代表测试已经通过。',
                )}
              </p>
              <label>
                请求与断言（可修改）
                <textarea
                  aria-label="草稿定义"
                  value={definitionText}
                  onChange={(e) => setDefinitionText(e.target.value)}
                  spellCheck={false}
                />
              </label>
              <label>
                审阅说明
                <input
                  aria-label="审阅说明"
                  value={reviewReason}
                  onChange={(e) => setReviewReason(e.target.value)}
                  maxLength={4096}
                  placeholder="拒绝时可记录原因"
                />
              </label>
              <div className="draft-review-actions">
                <button
                  className="button button--primary"
                  type="button"
                  disabled={reviewing !== null}
                  onClick={() => void review(activeDraft, 'accept')}
                >
                  <Check size={14} /> 接受为用例草稿
                </button>
                <button
                  className="button button--outline"
                  type="button"
                  disabled={reviewing !== null}
                  onClick={() => void review(activeDraft, 'reject')}
                >
                  <X size={14} /> 拒绝草稿
                </button>
                <button
                  className="button button--outline"
                  type="button"
                  onClick={() => setActiveDraft(null)}
                >
                  关闭审阅
                </button>
              </div>
            </section>
          ) : null}
          {!loading &&
          !drafts.length &&
          (generationStatus === 'pending' || generationStatus === 'running') ? (
            <p>正在生成可审核草稿…</p>
          ) : null}
          {!loading && !drafts.length && generationStatus === 'completed' ? (
            <p>该生成任务没有产生草稿。</p>
          ) : null}
        </section>
      ) : null}
      <div className="case-workbench__content">
        <aside className="case-queue" aria-label="测试用例列表">
          <div className="case-queue__filters">
            <label className="case-search">
              <MagnifyingGlass size={18} />
              <span className="sr-only">搜索用例</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索名称或说明"
              />
            </label>
          </div>
          <div className="case-queue__list">
            {loading ? <p className="case-queue__empty">正在读取真实用例…</p> : null}
            {!loading &&
              visibleCases.map((item) => (
                <button
                  className={`case-task ${selected?.id === item.id ? 'is-selected' : ''}`}
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="case-priority case-priority--p2">TC</span>
                  <span className="case-task__main">
                    <strong>{item.name}</strong>
                    <code>{versionLabel(item)}</code>
                    <span className="case-task__reason">{item.description || '未添加说明'}</span>
                    <small>更新于 {new Date(item.updatedAt).toLocaleString('zh-CN')}</small>
                  </span>
                </button>
              ))}
            {!loading && !visibleCases.length ? (
              <div className="case-queue__empty">
                <CheckCircle size={24} weight="fill" />
                <strong>当前工作区没有测试用例</strong>
                <span>通过 API 资产或生成任务创建后会显示在这里。</span>
              </div>
            ) : null}
          </div>
        </aside>
        <section className="case-detail" aria-label="用例详情">
          {selected ? (
            <>
              <header className="case-detail__header">
                <div>
                  <p className="case-detail__meta">
                    {selected.id} · {versionLabel(selected)}
                  </p>
                  <h2>{selected.name}</h2>
                  <p className="case-detail__impact">{selected.description || '未添加说明。'}</p>
                </div>
              </header>
              <div className="case-detail__sections">
                <section className="case-detail__section">
                  <h3>
                    {selected.latestVersion?.publishedBy ? '已发布版本定义' : '待发布版本定义'}
                  </h3>
                  <p>发布会固定此版本；之后的修改必须创建新版本。未发布的草稿不能进入回归计划。</p>
                  <pre>
                    {JSON.stringify(
                      selected.latestVersion?.definition ?? { message: '尚无版本定义' },
                      null,
                      2,
                    )}
                  </pre>
                </section>
                <section className="case-detail__section">
                  <CaseProvenance id={selected.id} />
                  <h3>关联操作</h3>
                  <p>可在测试计划中引用已发布用例；运行与证据请在报告中心查看。</p>
                  {selected.latestVersion && !selected.latestVersion.publishedBy ? (
                    <button
                      type="button"
                      className="button button--primary"
                      disabled={publishing}
                      onClick={async () => {
                        setPublishing(true);
                        try {
                          const versionId = selected.latestVersion?.id;
                          if (!versionId) return;
                          await cpClient.publishVersion(versionId);
                          notify('版本已发布，可加入回归计划。');
                          await refresh();
                        } catch (e) {
                          setError(e instanceof Error ? e.message : '发布失败');
                        } finally {
                          setPublishing(false);
                        }
                      }}
                    >
                      发布此版本
                    </button>
                  ) : (
                    <div className="draft-review-actions">
                      {selected.latestVersion ? (
                        <RunPublishedTest version={selected.latestVersion} />
                      ) : null}
                      <Link className="button button--outline" to="/plans">
                        加入回归计划
                      </Link>
                    </div>
                  )}
                </section>
              </div>
            </>
          ) : (
            <div className="case-queue__empty">
              <strong>选择一个真实用例查看详情</strong>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
