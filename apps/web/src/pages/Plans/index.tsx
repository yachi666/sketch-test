import {
  ArrowClockwise,
  CalendarBlank,
  CaretRight,
  CheckCircle,
  ClockCounterClockwise,
  GitBranch,
  PauseCircle,
  Play,
  Plus,
  ShieldCheck,
  TrashSimple,
  Warning,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ConfirmDialog } from '../../components/shared/ConfirmDialog';
import { ErrorCallout } from '../../components/shared/ErrorCallout';
import {
  cpClient,
  type Schedule,
  type TestCase,
  type TestSuite,
  type TestSuiteDetail,
  type TestSuiteMember,
  type TestSuiteVersion,
  type Workflow,
} from '../../lib/cp-client';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { AiPlanWorkbench } from './AiPlanWorkbench';
import { PlanVersionDialog, type PlanVersionDraft } from './PlanVersionDialog';

const roleRank = { viewer: 0, editor: 1, maintainer: 2, owner: 3 } as const;

function formatDate(value: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function memberLabel(
  member: TestSuiteMember,
  testCases: TestCase[],
  workflows: Workflow[],
): string {
  if (member.type === 'workflow') {
    return workflows.find((workflow) => workflow.id === member.id)?.name ?? member.id;
  }
  return testCases.find((testCase) => testCase.id === member.id)?.name ?? member.id;
}

function gateItems(version: TestSuiteVersion) {
  const gate = version.qualityGate;
  return [
    {
      label: '关键流程',
      value: gate.requiredWorkflows?.length
        ? `${gate.requiredWorkflows.length} 个必须通过`
        : '未启用',
      enabled: Boolean(gate.requiredWorkflows?.length),
    },
    {
      label: '新增失败',
      value: gate.noNewFailures ? '不允许' : '允许',
      enabled: Boolean(gate.noNewFailures),
    },
    {
      label: 'Flaky 重试',
      value: gate.maxFlakyRetries === undefined ? '未限制' : `最多 ${gate.maxFlakyRetries} 次`,
      enabled: gate.maxFlakyRetries !== undefined,
    },
    {
      label: '端点覆盖',
      value:
        gate.minEndpointCoverage === undefined ? '未限制' : `至少 ${gate.minEndpointCoverage}%`,
      enabled: gate.minEndpointCoverage !== undefined,
    },
    {
      label: '基础设施错误',
      value: gate.blockOnInfraError ? '返回无法判断' : '按运行结果处理',
      enabled: Boolean(gate.blockOnInfraError),
    },
  ];
}

export function ManualPlansPage() {
  const user = useAuthStore((state) => state.user);
  const notify = useUIStore((state) => state.notify);
  const workspaceId = user?.workspaceId;
  const canEdit = Boolean(user && roleRank[user.role] >= roleRank.editor);
  const canSchedule = Boolean(user && roleRank[user.role] >= roleRank.maintainer);

  const [suites, setSuites] = useState<TestSuite[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TestSuiteDetail | null>(null);
  const [versions, setVersions] = useState<TestSuiteVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<'create' | 'version' | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TestSuite | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState('0 9 * * 1-5');
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [scheduleBusy, setScheduleBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [suiteResult, scheduleResult, testCaseResult, workflowResult] = await Promise.all([
        cpClient.listTestSuites(workspaceId),
        cpClient.listSchedules(),
        cpClient.listTestCases(workspaceId),
        cpClient.listWorkflows(workspaceId),
      ]);
      setSuites(suiteResult.testSuites);
      setSchedules(scheduleResult.schedules);
      setTestCases(testCaseResult.testCases);
      setWorkflows(workflowResult.workflows);
      setSelectedId((current) => {
        if (current && suiteResult.testSuites.some((suite) => suite.id === current)) return current;
        return suiteResult.testSuites[0]?.id ?? null;
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法加载测试计划。');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setVersions([]);
      return;
    }
    let active = true;
    setDetailLoading(true);
    Promise.all([cpClient.getTestSuite(selectedId), cpClient.listTestSuiteVersions(selectedId)])
      .then(([nextDetail, versionResult]) => {
        if (!active) return;
        setDetail(nextDetail);
        setVersions(versionResult.versions);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : '无法加载计划版本。');
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedId]);

  const selectedSchedules = useMemo(
    () => schedules.filter((schedule) => schedule.testSuiteId === selectedId),
    [schedules, selectedId],
  );
  const selectedMemberCount = detail?.latestVersion?.members.length ?? 0;

  async function savePlan(draft: PlanVersionDraft) {
    if (!workspaceId) throw new Error('当前会话缺少工作区信息。');
    setSaving(true);
    let suiteId = selectedId;
    try {
      if (editorMode === 'create') {
        const created = await cpClient.createTestSuite(
          workspaceId,
          draft.name,
          draft.description || undefined,
        );
        suiteId = created.testSuite.id;
      }
      if (!suiteId) throw new Error('缺少测试计划标识。');
      await cpClient.createTestSuiteVersion(suiteId, draft.members, draft.qualityGate);
      setSelectedId(suiteId);
      setEditorMode(null);
      notify(editorMode === 'create' ? '测试计划已创建并发布 v1' : '测试计划新版本已发布');
      await refresh();
      const [nextDetail, versionResult] = await Promise.all([
        cpClient.getTestSuite(suiteId),
        cpClient.listTestSuiteVersions(suiteId),
      ]);
      setDetail(nextDetail);
      setVersions(versionResult.versions);
    } finally {
      setSaving(false);
    }
  }

  async function deleteSuite() {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await cpClient.deleteTestSuite(deleteTarget.id);
      notify(`已删除测试计划「${deleteTarget.name}」`);
      setDeleteTarget(null);
      setSelectedId(null);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除测试计划失败。');
    } finally {
      setSaving(false);
    }
  }

  async function createOrUpdateSchedule() {
    if (!workspaceId || !selectedId) return;
    const cron = scheduleDraft.trim();
    if (!cron) {
      setError('填写 Cron 表达式后才能保存定时计划。');
      return;
    }
    const busyId = editingScheduleId ?? 'create';
    setScheduleBusy(busyId);
    setError(null);
    try {
      if (editingScheduleId) {
        await cpClient.updateSchedule(editingScheduleId, { cronExpression: cron });
        notify('定时计划已更新');
      } else {
        await cpClient.createSchedule(workspaceId, selectedId, cron);
        notify('定时计划已创建');
      }
      setEditingScheduleId(null);
      setScheduleDraft('0 9 * * 1-5');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存定时计划失败。');
    } finally {
      setScheduleBusy(null);
    }
  }

  async function mutateSchedule(schedule: Schedule, action: 'toggle' | 'run' | 'delete') {
    setScheduleBusy(schedule.id);
    setError(null);
    try {
      if (action === 'toggle') {
        await cpClient.updateSchedule(schedule.id, { enabled: !schedule.enabled });
        notify(schedule.enabled ? '定时计划已暂停' : '定时计划已启用');
      } else if (action === 'run') {
        const result = await cpClient.triggerSchedule(schedule.id);
        notify(`已创建 ${result.runIds.length} 个 Run`);
      } else {
        await cpClient.deleteSchedule(schedule.id);
        notify('定时计划已删除');
      }
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '定时计划操作失败。');
    } finally {
      setScheduleBusy(null);
    }
  }

  return (
    <main className="page-view plans-page">
      <div className="page-actions-row">
        <div className="plan-header-actions">
          <button
            className="button button--outline"
            type="button"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <ArrowClockwise size={18} /> 刷新
          </button>
          {canEdit ? (
            <button
              className="button button--primary"
              type="button"
              onClick={() => setEditorMode('create')}
            >
              <Plus size={18} /> 新建测试计划
            </button>
          ) : null}
        </div>
      </div>

      {!workspaceId ? (
        <section className="paper-panel plan-connect-state">
          <ShieldCheck size={34} />
          <div>
            <h3>连接工作区后管理真实计划</h3>
            <p>测试计划只读取 Control Plane 数据，不会用浏览器示例数据替代。</p>
          </div>
        </section>
      ) : null}

      {error ? <ErrorCallout title="测试计划操作未完成" message={error} onRetry={refresh} /> : null}

      {workspaceId ? (
        <>
          <section className="plan-signal-rail" aria-label="测试计划摘要">
            <div>
              <span>计划</span>
              <strong>{suites.length}</strong>
            </div>
            <i aria-hidden="true" />
            <div>
              <span>当前版本成员</span>
              <strong>{selectedMemberCount}</strong>
            </div>
            <i aria-hidden="true" />
            <div>
              <span>定时规则</span>
              <strong>{schedules.length}</strong>
            </div>
            <small>每个版本一经发布不可修改；变更会生成新的证据边界。</small>
          </section>

          <div className="plans-workbench" aria-busy={loading || detailLoading}>
            <aside className="plan-index" aria-label="测试计划列表">
              <div className="plan-index-heading">
                <span>工作区计划</span>
                <b>{suites.length}</b>
              </div>
              {loading && suites.length === 0 ? <p className="plan-loading">正在加载…</p> : null}
              {!loading && suites.length === 0 ? (
                <div className="plan-index-empty">
                  <CalendarBlank size={30} />
                  <strong>还没有测试计划</strong>
                  <p>从一个关键流程和一条阻断规则开始。</p>
                </div>
              ) : null}
              {suites.map((suite) => (
                <button
                  className={`plan-index-item${selectedId === suite.id ? ' plan-index-item--active' : ''}`}
                  type="button"
                  key={suite.id}
                  onClick={() => setSelectedId(suite.id)}
                >
                  <span>
                    <strong>{suite.name}</strong>
                    <small>{suite.description || '未填写说明'}</small>
                    <time>{formatDate(suite.updatedAt)}</time>
                  </span>
                  <CaretRight size={17} />
                </button>
              ))}
            </aside>

            <section className="plan-detail" aria-live="polite">
              {!selectedId ? (
                <div className="empty-state">
                  <ShieldCheck size={42} />
                  <h3>选择一个测试计划</h3>
                  <p>查看不可变版本、执行成员、质量门禁和定时规则。</p>
                </div>
              ) : null}
              {selectedId && detailLoading && !detail ? (
                <p className="plan-loading">正在读取版本…</p>
              ) : null}
              {detail ? (
                <>
                  <header className="plan-detail-header">
                    <div>
                      <span className="eyebrow">TEST SUITE</span>
                      <h3>{detail.testSuite.name}</h3>
                      <p>{detail.testSuite.description || '这个计划还没有说明。'}</p>
                    </div>
                    <div>
                      {canEdit ? (
                        <button
                          className="button button--outline"
                          type="button"
                          onClick={() => setEditorMode('version')}
                        >
                          <GitBranch size={17} /> 发布新版本
                        </button>
                      ) : null}
                      {canEdit ? (
                        <button
                          className="icon-button plan-delete-button"
                          type="button"
                          aria-label={`删除 ${detail.testSuite.name}`}
                          disabled={selectedSchedules.length > 0}
                          title={selectedSchedules.length > 0 ? '先删除关联定时规则' : undefined}
                          onClick={() => setDeleteTarget(detail.testSuite)}
                        >
                          <TrashSimple size={18} />
                        </button>
                      ) : null}
                    </div>
                  </header>

                  {detail.latestVersion ? (
                    <>
                      <div className="plan-version-strip">
                        <span className="plan-version-mark">v{detail.latestVersion.version}</span>
                        <div>
                          <strong>当前不可变版本</strong>
                          <small>{formatDate(detail.latestVersion.createdAt)} 发布</small>
                        </div>
                        <span>{detail.latestVersion.members.length} 个执行成员</span>
                      </div>

                      <section className="plan-detail-section">
                        <div className="plan-section-title">
                          <div>
                            <GitBranch size={19} />
                            <span>
                              <strong>执行成员</strong>
                              <small>Runner 将为每个成员创建独立、可追溯的 Run。</small>
                            </span>
                          </div>
                        </div>
                        <div className="plan-member-list">
                          {detail.latestVersion.members.map((member) => (
                            <span
                              className={`plan-member-chip plan-member-chip--${member.type}`}
                              key={`${member.type}:${member.id}`}
                            >
                              <small>{member.type === 'workflow' ? 'FLOW' : 'CASE'}</small>
                              {memberLabel(member, testCases, workflows)}
                            </span>
                          ))}
                        </div>
                      </section>

                      <section className="plan-detail-section">
                        <div className="plan-section-title">
                          <div>
                            <ShieldCheck size={19} />
                            <span>
                              <strong>质量门禁轨道</strong>
                              <small>从确定性失败到基础设施无法判断，保持结果语义清晰。</small>
                            </span>
                          </div>
                        </div>
                        <ol className="plan-gate-rail">
                          {gateItems(detail.latestVersion).map((item) => (
                            <li
                              className={item.enabled ? 'plan-gate--enabled' : ''}
                              key={item.label}
                            >
                              <i>{item.enabled ? <CheckCircle size={18} weight="fill" /> : null}</i>
                              <span>{item.label}</span>
                              <strong>{item.value}</strong>
                            </li>
                          ))}
                        </ol>
                        {detail.latestVersion.qualityGate.requiredTags?.length ? (
                          <div className="plan-required-tags">
                            <span>必须覆盖标签</span>
                            {detail.latestVersion.qualityGate.requiredTags.map((tag) => (
                              <code key={tag}>{tag}</code>
                            ))}
                          </div>
                        ) : null}
                      </section>

                      <section className="plan-detail-section">
                        <div className="plan-section-title">
                          <div>
                            <ClockCounterClockwise size={19} />
                            <span>
                              <strong>版本历史</strong>
                              <small>旧版本保持只读，历史运行始终可复现。</small>
                            </span>
                          </div>
                        </div>
                        <div className="plan-history-list">
                          {versions.map((version) => (
                            <span key={version.id}>
                              <b>v{version.version}</b>
                              <small>
                                {version.members.length} 个成员 · {formatDate(version.createdAt)}
                              </small>
                            </span>
                          ))}
                        </div>
                      </section>

                      <section className="plan-detail-section plan-schedule-section">
                        <div className="plan-section-title">
                          <div>
                            <CalendarBlank size={19} />
                            <span>
                              <strong>定时执行</strong>
                              <small>Cron 使用 UTC；立即执行会创建真实 Run，不绕过 Runner。</small>
                            </span>
                          </div>
                        </div>
                        {selectedSchedules.map((schedule) => (
                          <div className="plan-schedule-row" key={schedule.id}>
                            {editingScheduleId === schedule.id ? (
                              <input
                                className="text-input"
                                aria-label="Cron 表达式"
                                value={scheduleDraft}
                                onChange={(event) => setScheduleDraft(event.target.value)}
                              />
                            ) : (
                              <span>
                                <code>{schedule.cronExpression}</code>
                                <small>{schedule.enabled ? '已启用' : '已暂停'}</small>
                              </span>
                            )}
                            <div>
                              {editingScheduleId === schedule.id ? (
                                <button
                                  className="button button--outline"
                                  type="button"
                                  disabled={scheduleBusy === schedule.id || !canSchedule}
                                  onClick={() => void createOrUpdateSchedule()}
                                >
                                  保存
                                </button>
                              ) : (
                                <button
                                  className="button button--outline"
                                  type="button"
                                  disabled={!canSchedule}
                                  onClick={() => {
                                    setEditingScheduleId(schedule.id);
                                    setScheduleDraft(schedule.cronExpression);
                                  }}
                                >
                                  编辑
                                </button>
                              )}
                              <button
                                className="icon-button"
                                type="button"
                                aria-label={schedule.enabled ? '暂停定时计划' : '启用定时计划'}
                                disabled={scheduleBusy === schedule.id || !canSchedule}
                                onClick={() => void mutateSchedule(schedule, 'toggle')}
                              >
                                {schedule.enabled ? <PauseCircle size={19} /> : <Play size={19} />}
                              </button>
                              <button
                                className="button button--primary"
                                type="button"
                                disabled={scheduleBusy === schedule.id || !canSchedule}
                                onClick={() => void mutateSchedule(schedule, 'run')}
                              >
                                <Play size={16} /> 立即运行
                              </button>
                              <button
                                className="icon-button plan-delete-button"
                                type="button"
                                aria-label="删除定时计划"
                                disabled={scheduleBusy === schedule.id || !canSchedule}
                                onClick={() => void mutateSchedule(schedule, 'delete')}
                              >
                                <TrashSimple size={17} />
                              </button>
                            </div>
                          </div>
                        ))}
                        {canSchedule && !editingScheduleId ? (
                          <div className="plan-schedule-create">
                            <label htmlFor="new-plan-cron">新增 Cron 规则</label>
                            <input
                              id="new-plan-cron"
                              className="text-input"
                              value={scheduleDraft}
                              placeholder="0 9 * * 1-5"
                              onChange={(event) => setScheduleDraft(event.target.value)}
                            />
                            <button
                              className="button button--outline"
                              type="button"
                              disabled={scheduleBusy === 'create'}
                              onClick={() => void createOrUpdateSchedule()}
                            >
                              <Plus size={17} /> 添加规则
                            </button>
                          </div>
                        ) : null}
                        {!canSchedule ? (
                          <p className="plan-permission-note">
                            需要 maintainer 或 owner 权限才能管理定时执行。
                          </p>
                        ) : null}
                      </section>
                    </>
                  ) : (
                    <div className="plan-unversioned-state">
                      <Warning size={30} />
                      <div>
                        <strong>尚未发布可执行版本</strong>
                        <p>选择成员并设置质量门禁，发布第一个不可变版本。</p>
                      </div>
                      {canEdit ? (
                        <button
                          className="button button--primary"
                          type="button"
                          onClick={() => setEditorMode('version')}
                        >
                          发布 v1
                        </button>
                      ) : null}
                    </div>
                  )}
                </>
              ) : null}
            </section>
          </div>
        </>
      ) : null}

      <PlanVersionDialog
        open={editorMode !== null}
        mode={editorMode ?? 'create'}
        suiteName={detail?.testSuite.name}
        baseVersion={editorMode === 'version' ? detail?.latestVersion : null}
        testCases={testCases}
        workflows={workflows}
        busy={saving}
        onClose={() => {
          if (!saving) setEditorMode(null);
        }}
        onSave={savePlan}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除测试计划？"
        message={`将删除「${deleteTarget?.name ?? ''}」及其所有版本。已有运行证据不会被改写。`}
        variant="danger"
        confirmLabel="删除计划"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void deleteSuite()}
      />
    </main>
  );
}

export function PlansPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = searchParams.get('view') === 'published' ? 'manual' : 'ai';
  const setMode = (next: 'ai' | 'manual') =>
    setSearchParams((previous) => {
      const params = new URLSearchParams(previous);
      if (next === 'manual') params.set('view', 'published');
      else params.delete('view');
      return params;
    });
  return (
    <>
      {mode === 'manual' ? (
        <nav className="plan-mode-tabs" aria-label="测试计划视图">
          <button type="button" onClick={() => setMode('ai')}>
            AI 计划建议
          </button>
          <button
            type="button"
            aria-current={mode === 'manual' ? 'page' : undefined}
            onClick={() => setMode('manual')}
          >
            已发布计划
          </button>
        </nav>
      ) : null}
      {mode === 'ai' ? (
        <AiPlanWorkbench onPublished={() => setMode('manual')} />
      ) : (
        <ManualPlansPage />
      )}
    </>
  );
}
