import {
  ArrowRight,
  ArrowSquareOut,
  ArrowsClockwise,
  Check,
  GitBranch,
  Info,
  Robot,
  ShieldCheck,
  SlidersHorizontal,
  Sparkle,
  User,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '../../components/shared/ConfirmDialog';
import {
  type PlanAsset,
  type PlanProposal,
  type PlanSuggestion,
  planClient,
} from '../../lib/cp-client';
import { useAuthStore } from '../../stores/authStore';
import './ai-plans.css';

export function AiPlanWorkbench({ onPublished }: { onPublished: () => void }) {
  const user = useAuthStore((s) => s.user);
  const canEdit = Boolean(user) && user?.role !== 'viewer';
  const [jobs, setJobs] = useState<PlanSuggestion[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<PlanProposal | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gatesOpen, setGatesOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [selected, jobs[0]?.status]);
  const evidenceRef = useRef<HTMLDialogElement>(null);
  const [evidence, setEvidence] = useState<PlanAsset | null>(null);
  useEffect(() => {
    if (evidence) evidenceRef.current?.showModal();
  }, [evidence]);
  const job = jobs.find((j) => j.id === selected) ?? jobs[0];
  const active = job?.status === 'pending' || job?.status === 'running';
  const refresh = useCallback(async () => {
    try {
      const result = await planClient.list();
      setJobs(result.jobs);
      setSelected((current) => current ?? result.jobs[0]?.id ?? null);
      setEnabled(result.settings.enabled);
      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法加载 AI 建议');
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    setDraft(job?.proposal ?? null);
    setDirty(false);
    setGatesOpen(false);
  }, [job?.id, job?.revision]);
  function edit(value: PlanProposal) {
    setDraft(value);
    setDirty(true);
    setNotice('');
  }
  async function generate(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      let parent = job;
      if (parent && dirty && draft)
        parent = (await planClient.save(parent.id, parent.revision, draft)).job;
      const result = await planClient.generate(
        text.trim(),
        parent?.status === 'completed' ? parent.id : undefined,
        parent?.status === 'completed' ? parent.revision : undefined,
      );
      setJobs((current) => [result.job, ...current.filter((j) => j.id !== result.job.id)]);
      setSelected(result.job.id);
      setMessage('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败');
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!job || !draft) return;
    setBusy(true);
    setError('');
    try {
      const result = await planClient.save(job.id, job.revision, draft);
      setJobs((v) => v.map((j) => (j.id === job.id ? result.job : j)));
      setDirty(false);
      setNotice('草稿已保存。尚未发布或执行。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    if (!job) return;
    setBusy(true);
    setError('');
    try {
      await planClient.publish(job.id, job.revision);
      setPublishOpen(false);
      onPublished();
    } catch (e) {
      setPublishOpen(false);
      setError(e instanceof Error ? e.message : '发布失败');
    } finally {
      setBusy(false);
    }
  }
  async function toggleAuto() {
    setBusy(true);
    setError('');
    try {
      const r = await planClient.settings(!enabled);
      setEnabled(r.enabled);
      setNotice(
        r.enabled
          ? '已开启。AI 将在用例资产变化后自动提出草稿。'
          : '已关闭后续自动建议，已有任务保持不变。',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '设置失败');
    } finally {
      setBusy(false);
    }
  }
  const conversation: PlanSuggestion[] = [];
  let node: PlanSuggestion | undefined = job;
  while (node && conversation.length < 8) {
    conversation.unshift(node);
    node = jobs.find((j) => j.id === node?.parentId);
  }
  const asset = (key: string) => job?.assets.find((a) => a.key === key);
  function rows(items: PlanProposal['members'], pending: boolean) {
    return (
      <div
        className="ai-plan-table"
        role="region"
        aria-label={pending ? '待补齐用例' : '当前执行成员'}
      >
        <div className="ai-plan-table-head">
          <span>用例 / 流程</span>
          <span>{pending ? '状态' : '版本'}</span>
          <span>依据</span>
        </div>
        {items.map((item) => {
          const source = asset(item.key);
          if (!source) return null;
          return (
            <div className="ai-plan-table-row" key={item.key}>
              <div>
                <strong>{source.name}</strong>
                <small>{source.route}</small>
              </div>
              <span className={pending ? 'ai-state ai-state--pending' : 'ai-state'}>
                {pending ? '待审核' : `已发布 v${source.version}`}
              </span>
              <button type="button" className="ai-text-button" onClick={() => setEvidence(source)}>
                查看依据 <ArrowSquareOut size={13} />
              </button>
            </div>
          );
        })}
        {!items.length ? (
          <p className="ai-empty-row">
            {pending ? '当前建议没有关联的待审草稿。' : '暂无执行成员，可先保存草稿并补齐用例。'}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <main className="ai-plans-page">
      <div className="ai-plan-toolbar">
        <div className="ai-plan-breadcrumb">
          测试计划 <span>/</span> AI 建议{' '}
          {job ? (
            <>
              <span>/</span>
              <select
                aria-label="选择计划建议"
                value={job.id}
                disabled={dirty || busy}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setNotice('');
                }}
              >
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.proposal?.name ?? j.trigger} ·{' '}
                    {new Date(j.createdAt).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </option>
                ))}
              </select>
            </>
          ) : null}
        </div>
        <button type="button" className="ai-text-button ai-manual-link" onClick={onPublished}>
          已发布计划
        </button>
        <button
          className="ai-auto-button"
          type="button"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((v) => !v)}
        >
          <Robot size={19} /> 自动建议 <b>{enabled ? '已开启' : '未开启'}</b>
          <span>设置</span>
        </button>
      </div>
      {settingsOpen ? (
        <section className="ai-settings" aria-label="自动建议设置">
          <div>
            <strong>用例变化后主动建议</strong>
            <p>
              独立 AI 服务每 30
              秒检查已发布用例、流程和待审草稿。同一来源只生成一次；关闭后不再新增建议。会向已配置模型发送用例名称、方法、路径和版本。
            </p>
          </div>
          <button
            type="button"
            className="button button--outline"
            disabled={busy || !canEdit}
            onClick={() => void toggleAuto()}
          >
            {enabled ? '关闭自动建议' : '开启自动建议'}
          </button>
        </section>
      ) : null}
      {error ? (
        <div className="ai-error" role="alert">
          {error}
          <button
            type="button"
            onClick={() => {
              setError('');
              void refresh();
            }}
          >
            刷新状态
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="ai-notice" role="status">
          <Check size={16} />
          {notice}
        </div>
      ) : null}
      <div className="ai-plan-columns">
        <section className="ai-plan-dialogue" aria-label="与 AI 调整计划">
          <header>
            <h2>对话共创与计划预览</h2>
            <p>与 AI 一起完善测试计划，边聊边预览</p>
          </header>
          <div className="ai-plan-messages" ref={messagesRef} aria-live="polite">
            {loading ? <p>正在加载工作区建议…</p> : null}
            {!loading && !job ? (
              <div className="ai-plan-welcome">
                <Robot size={32} />
                <h3>让已有测试组成一份计划</h3>
                <p>AI 会结合已发布资产与待审草稿，说明该测什么、为什么，以及还缺什么。</p>
                <p>输入本次回归目标，或开启自动建议，让 AI 在用例变化后主动准备草稿。</p>
              </div>
            ) : null}
            {conversation.map((entry, index) => (
              <div key={entry.id} className="ai-conversation-turn">
                <div className="ai-trigger">
                  {new Date(entry.createdAt).toLocaleDateString('zh-CN')} · {entry.trigger}
                </div>
                {entry.parentId || entry.trigger === '手动生成' ? (
                  <div className="ai-message">
                    <User size={23} />
                    <div>
                      <strong>我</strong>
                      <p>{entry.objective}</p>
                    </div>
                  </div>
                ) : null}
                {entry.proposal ? (
                  <div className="ai-message ai-message--assistant">
                    <Robot size={24} />
                    <div>
                      <strong>SketchTest AI</strong>
                      {entry.proposal.explanation.length > 150 ? (
                        <details className="ai-long-message">
                          <summary>
                            {entry.proposal.explanation.slice(0, 110)}… <span>展开说明</span>
                          </summary>
                          <p>{entry.proposal.explanation}</p>
                        </details>
                      ) : (
                        <p>{entry.proposal.explanation}</p>
                      )}
                      <small>
                        <GitBranch size={14} /> {entry.assets.length} 个来源资产 ·{' '}
                        {entry.model.model}
                      </small>
                    </div>
                  </div>
                ) : index === conversation.length - 1 ? (
                  <div className="ai-message ai-message--assistant">
                    <Robot size={24} />
                    <div>
                      <strong>SketchTest AI</strong>
                      <p>
                        {entry.status === 'failed'
                          ? '本次生成未完成，上一版草稿仍保留。请重新发送目标。'
                          : entry.status === 'cancelled'
                            ? '本次生成已取消。'
                            : '正在分析来源并整理计划建议…'}
                      </p>
                      {active ? (
                        <button
                          type="button"
                          className="ai-text-button"
                          onClick={() =>
                            void planClient
                              .cancel(entry.id, entry.revision)
                              .then(refresh)
                              .catch((e) => setError(String(e)))
                          }
                        >
                          取消生成
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <form
            className="ai-plan-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void generate(message);
            }}
          >
            <span>你可以这样说：</span>
            <div className="ai-prompt-chips">
              <button
                type="button"
                disabled={active || !canEdit}
                onClick={() => setMessage('先聚焦员工管理，暂不加入其他模块。')}
              >
                缩小范围
              </button>
              <button
                type="button"
                disabled={active || !canEdit}
                onClick={() =>
                  setMessage('请解释每个执行成员的推荐依据，并明确哪些业务预期尚未验证。')
                }
              >
                解释推荐依据
              </button>
            </div>
            <div className="ai-composer-input">
              <textarea
                aria-label="告诉 AI 如何调整计划"
                placeholder="告诉 AI 如何调整计划…"
                value={message}
                maxLength={4096}
                disabled={active || busy || !canEdit}
                onChange={(e) => setMessage(e.target.value)}
              />
              <button
                type="submit"
                aria-label="发送测试目标"
                disabled={!message.trim() || active || busy || !canEdit}
              >
                <ArrowRight size={23} />
              </button>
            </div>
            <small>仅发送测试目标，请勿填写凭据或真实个人数据。</small>
          </form>
        </section>
        <section className="ai-plan-preview" aria-label="计划草稿预览">
          {draft && job ? (
            <>
              <header className="ai-preview-heading">
                <input
                  aria-label="计划名称"
                  value={draft.name}
                  disabled={Boolean(job.suiteId) || !canEdit}
                  onChange={(e) => edit({ ...draft, name: e.target.value })}
                  maxLength={120}
                />
                <span className="ai-state">{job.suiteId ? '已发布' : 'AI 草稿'}</span>
              </header>
              <div className="ai-preview-body">
                <label className="ai-plan-goal">
                  计划目标
                  <textarea
                    value={draft.objective}
                    aria-label="计划目标"
                    disabled={Boolean(job.suiteId) || !canEdit}
                    maxLength={2000}
                    onChange={(e) => edit({ ...draft, objective: e.target.value })}
                  />
                </label>
                <section className="ai-plan-members">
                  <div className="ai-section-title">
                    <h3>当前执行成员（{draft.members.length}）</h3>
                    <small>从已发布用例中选择</small>
                  </div>
                  {rows(draft.members, false)}
                  {!job.suiteId ? (
                    <details className="ai-member-adjust">
                      <summary>调整执行成员</summary>
                      {job.assets
                        .filter((a) => a.type !== 'draft')
                        .map((a) => (
                          <label key={a.key}>
                            <input
                              type="checkbox"
                              disabled={!canEdit}
                              checked={draft.members.some((m) => m.key === a.key)}
                              onChange={(e) =>
                                edit({
                                  ...draft,
                                  members: e.target.checked
                                    ? [...draft.members, { key: a.key, reason: '人工加入计划' }]
                                    : draft.members.filter((m) => m.key !== a.key),
                                })
                              }
                            />
                            {a.name}
                          </label>
                        ))}
                    </details>
                  ) : null}
                </section>
                <section className="ai-plan-gaps">
                  <div className="ai-section-title">
                    <h3>待补齐（{draft.gaps.length}）</h3>
                    <Link to="/cases">
                      去审核草稿 <ArrowSquareOut size={13} />
                    </Link>
                  </div>
                  {rows(draft.gaps, true)}
                </section>
                <section className="ai-plan-gates">
                  <div className="ai-section-title">
                    <h3>门禁建议</h3>
                    <button
                      type="button"
                      className="ai-text-button"
                      onClick={() => setGatesOpen((v) => !v)}
                      aria-expanded={gatesOpen}
                    >
                      <SlidersHorizontal size={14} /> 调整
                    </button>
                  </div>
                  <div className="ai-gate-summary">
                    <ShieldCheck size={24} />
                    <span>
                      {draft.noNewFailures ? '不允许新增阻断失败' : '记录失败，不启用新增失败门禁'}
                    </span>
                  </div>
                  {gatesOpen ? (
                    <div className="ai-gate-fields">
                      <label>
                        <input
                          type="checkbox"
                          checked={draft.noNewFailures}
                          disabled={Boolean(job.suiteId) || !canEdit}
                          onChange={(e) => edit({ ...draft, noNewFailures: e.target.checked })}
                        />
                        不允许新增失败
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={draft.blockOnInfraError}
                          disabled={Boolean(job.suiteId) || !canEdit}
                          onChange={(e) => edit({ ...draft, blockOnInfraError: e.target.checked })}
                        />
                        基础设施故障返回无法判断
                      </label>
                    </div>
                  ) : null}
                </section>
                <aside className="ai-plan-precautions">
                  <Info size={20} />
                  <div>
                    <strong>执行注意事项</strong>
                    {draft.precautions.slice(0, 1).map((text) => (
                      <p key={text}>{text}</p>
                    ))}
                    {draft.precautions.length > 1 ? (
                      <details>
                        <summary>查看全部执行前提（{draft.precautions.length}）</summary>
                        {draft.precautions.slice(1).map((text) => (
                          <p key={text}>{text}</p>
                        ))}
                      </details>
                    ) : null}
                    {!draft.precautions.length ? <p>发布后仍需选择目标环境与测试身份。</p> : null}
                  </div>
                </aside>
              </div>
              <footer className="ai-preview-footer">
                <small>
                  {dirty
                    ? '有未保存的修改'
                    : job.savedAt
                      ? '已保存，发布和执行是独立步骤'
                      : '保存不会发布或执行'}
                </small>
                <div>
                  {job.savedAt && !dirty && !job.suiteId ? (
                    <button
                      className="button button--outline"
                      type="button"
                      disabled={busy || !canEdit || !draft.members.length}
                      onClick={() => setPublishOpen(true)}
                    >
                      审阅并发布
                    </button>
                  ) : null}
                  {job.suiteId ? (
                    <button className="button button--primary" type="button" onClick={onPublished}>
                      查看已发布计划
                    </button>
                  ) : (
                    <button
                      className="button button--primary"
                      type="button"
                      disabled={
                        busy || active || !canEdit || !draft.name.trim() || !draft.objective.trim()
                      }
                      onClick={() => void save()}
                    >
                      {busy ? '正在处理…' : '保存计划草稿'}
                    </button>
                  )}
                </div>
              </footer>
            </>
          ) : (
            <div className="ai-preview-empty">
              <Sparkle size={34} />
              <h2>{active ? '计划正在生成' : '计划草稿预览'}</h2>
              <p>
                {active
                  ? '生成完成后，执行成员、待补齐用例和推荐依据会显示在这里。'
                  : '从左侧描述测试目标，AI 会从真实资产中整理建议。'}
              </p>
              {active ? <ArrowsClockwise className="ai-spinner" size={22} /> : null}
            </div>
          )}
        </section>
      </div>
      {evidence ? (
        <dialog
          ref={evidenceRef}
          className="modal ai-evidence"
          onCancel={() => setEvidence(null)}
          aria-modal="true"
          aria-label="推荐依据"
        >
          <h2>{evidence.name}</h2>
          <p>{evidence.route}</p>
          <p>
            {
              [...(draft?.members ?? []), ...(draft?.gaps ?? [])].find(
                (m) => m.key === evidence.key,
              )?.reason
            }
          </p>
          <dl>
            <dt>来源版本</dt>
            <dd>{evidence.versionId ?? '待审核草稿'}</dd>
            <dt>操作风险</dt>
            <dd>{evidence.sideEffect}</dd>
          </dl>
          <p>这是模型建议，业务正确性仍需审阅。</p>
          <Link to={evidence.type === 'workflow' ? '/workflows' : '/cases'}>查看来源资产</Link>
          <button
            className="button button--outline"
            type="button"
            onClick={() => setEvidence(null)}
          >
            关闭
          </button>
        </dialog>
      ) : null}
      <ConfirmDialog
        open={publishOpen}
        title="发布这份测试计划？"
        message={`将固定 ${draft?.members.length ?? 0} 个已发布成员与当前门禁。${draft?.gaps.length ?? 0} 条待审草稿不会进入执行成员。发布不会立即运行。`}
        confirmLabel="确认发布 v1"
        onCancel={() => setPublishOpen(false)}
        onConfirm={() => void publish()}
      />
    </main>
  );
}
