import { CheckCircle, GitBranch, ShieldCheck, WarningCircle, X } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  QualityGateConfig,
  TestCase,
  TestSuiteMember,
  TestSuiteVersion,
  Workflow,
} from '../../lib/cp-client';

export interface PlanVersionDraft {
  name: string;
  description: string;
  members: TestSuiteMember[];
  qualityGate: QualityGateConfig;
}

interface PlanVersionDialogProps {
  open: boolean;
  mode: 'create' | 'version';
  suiteName?: string;
  baseVersion?: TestSuiteVersion | null;
  testCases: TestCase[];
  workflows: Workflow[];
  busy: boolean;
  onClose: () => void;
  onSave: (draft: PlanVersionDraft) => Promise<void>;
}

function memberKey(member: TestSuiteMember): string {
  return `${member.type}:${member.id}`;
}

export function PlanVersionDialog({
  open,
  mode,
  suiteName,
  baseVersion,
  testCases,
  workflows,
  busy,
  onClose,
  onSave,
}: PlanVersionDialogProps) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [requiredWorkflows, setRequiredWorkflows] = useState(true);
  const [noNewFailures, setNoNewFailures] = useState(true);
  const [maxFlakyRetries, setMaxFlakyRetries] = useState('2');
  const [minEndpointCoverage, setMinEndpointCoverage] = useState('80');
  const [requiredTags, setRequiredTags] = useState('critical');
  const [blockOnInfraError, setBlockOnInfraError] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const gate = baseVersion?.qualityGate;
    setName(mode === 'create' ? '' : (suiteName ?? ''));
    setDescription('');
    setSelected(new Set((baseVersion?.members ?? []).map(memberKey)));
    setRequiredWorkflows((gate?.requiredWorkflows?.length ?? 0) > 0 || !baseVersion);
    setNoNewFailures(gate?.noNewFailures ?? true);
    setMaxFlakyRetries(String(gate?.maxFlakyRetries ?? 2));
    setMinEndpointCoverage(String(gate?.minEndpointCoverage ?? 80));
    setRequiredTags((gate?.requiredTags ?? ['critical']).join(', '));
    setBlockOnInfraError(gate?.blockOnInfraError ?? true);
    setError(null);
    const focusId = window.setTimeout(() => nameRef.current?.focus(), 50);
    return () => window.clearTimeout(focusId);
  }, [baseVersion, mode, open, suiteName]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose, open]);

  const members = useMemo<TestSuiteMember[]>(() => {
    return [...selected].map((key) => {
      const [type, ...idParts] = key.split(':');
      return { type: type as TestSuiteMember['type'], id: idParts.join(':') };
    });
  }, [selected]);

  if (!open) return null;

  function toggleMember(member: TestSuiteMember) {
    const key = memberKey(member);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (mode === 'create' && !trimmedName) {
      setError('填写计划名称后才能创建。');
      return;
    }
    if (members.length === 0) {
      setError('至少选择一个已发布用例或业务流程。');
      return;
    }

    const retries = Number.parseInt(maxFlakyRetries, 10);
    const coverage = Number.parseFloat(minEndpointCoverage);
    if (!Number.isInteger(retries) || retries < 0) {
      setError('Flaky 重试上限必须是大于或等于 0 的整数。');
      return;
    }
    if (!Number.isFinite(coverage) || coverage < 0 || coverage > 100) {
      setError('端点覆盖率必须在 0 到 100 之间。');
      return;
    }

    const workflowIds = members
      .filter((member) => member.type === 'workflow')
      .map((member) => member.id);
    setError(null);
    try {
      await onSave({
        name: trimmedName,
        description: description.trim(),
        members,
        qualityGate: {
          requiredWorkflows: requiredWorkflows ? workflowIds : [],
          noNewFailures,
          maxFlakyRetries: retries,
          minEndpointCoverage: coverage,
          requiredTags: requiredTags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
          blockOnInfraError,
        },
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存测试计划失败。');
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="modal plan-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-editor-title"
      >
        <header className="plan-editor-header">
          <div>
            <span className="eyebrow">IMMUTABLE SUITE VERSION</span>
            <h2 id="plan-editor-title">
              {mode === 'create' ? '创建测试计划' : `发布 ${suiteName} 的新版本`}
            </h2>
            <p>每次保存都会生成不可变的 TestSuiteVersion，历史运行继续引用原版本。</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="关闭计划编辑器"
            disabled={busy}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>

        <form className="plan-editor-form" onSubmit={submit}>
          {mode === 'create' ? (
            <div className="plan-editor-identity">
              <label>
                计划名称
                <input
                  ref={nameRef}
                  className="text-input"
                  value={name}
                  maxLength={255}
                  placeholder="例如：主干合并门禁"
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label>
                说明
                <textarea
                  className="text-input plan-description-input"
                  value={description}
                  maxLength={2000}
                  placeholder="说明这组测试保护的业务边界。"
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
            </div>
          ) : (
            <input ref={nameRef} className="plan-hidden-focus" aria-hidden="true" tabIndex={-1} />
          )}

          <div className="plan-editor-columns">
            <fieldset className="plan-editor-section">
              <legend>
                <GitBranch size={18} /> 执行成员
              </legend>
              <p>选择已审核资产；草稿不会进入正式测试计划。</p>
              <div className="plan-member-picker">
                <span className="plan-picker-label">业务流程</span>
                {workflows.length === 0 ? <small>当前工作区暂无业务流程。</small> : null}
                {workflows.map((workflow) => {
                  const member = { type: 'workflow' as const, id: workflow.id };
                  return (
                    <label className="plan-member-option" key={workflow.id}>
                      <input
                        type="checkbox"
                        checked={selected.has(memberKey(member))}
                        onChange={() => toggleMember(member)}
                      />
                      <span>
                        <strong>{workflow.name}</strong>
                        <small>{workflow.description || workflow.id}</small>
                      </span>
                    </label>
                  );
                })}

                <span className="plan-picker-label">测试用例</span>
                {testCases.length === 0 ? <small>当前工作区暂无测试用例。</small> : null}
                {testCases.map((testCase) => {
                  const member = { type: 'test' as const, id: testCase.id };
                  return (
                    <label className="plan-member-option" key={testCase.id}>
                      <input
                        type="checkbox"
                        checked={selected.has(memberKey(member))}
                        onChange={() => toggleMember(member)}
                      />
                      <span>
                        <strong>{testCase.name}</strong>
                        <small>{testCase.description || testCase.id}</small>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="plan-editor-section plan-gate-editor">
              <legend>
                <ShieldCheck size={18} /> 质量门禁
              </legend>
              <p>确定什么情况下允许交付继续，以及何时返回无法判断。</p>
              <label className="plan-switch-field">
                <input
                  type="checkbox"
                  checked={requiredWorkflows}
                  onChange={(event) => setRequiredWorkflows(event.target.checked)}
                />
                <span>
                  <strong>所选关键流程必须通过</strong>
                  <small>把本版本中的业务流程列为阻断条件。</small>
                </span>
              </label>
              <label className="plan-switch-field">
                <input
                  type="checkbox"
                  checked={noNewFailures}
                  onChange={(event) => setNoNewFailures(event.target.checked)}
                />
                <span>
                  <strong>不允许新增失败</strong>
                  <small>阻断新的 block 级断言失败。</small>
                </span>
              </label>
              <label className="plan-switch-field">
                <input
                  type="checkbox"
                  checked={blockOnInfraError}
                  onChange={(event) => setBlockOnInfraError(event.target.checked)}
                />
                <span>
                  <strong>基础设施错误返回无法判断</strong>
                  <small>网络或 Runner 故障不会伪装成业务失败。</small>
                </span>
              </label>
              <div className="plan-number-grid">
                <label>
                  Flaky 重试上限
                  <input
                    className="text-input"
                    type="number"
                    min="0"
                    step="1"
                    value={maxFlakyRetries}
                    onChange={(event) => setMaxFlakyRetries(event.target.value)}
                  />
                </label>
                <label>
                  最低端点覆盖率
                  <span className="plan-suffixed-input">
                    <input
                      className="text-input"
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={minEndpointCoverage}
                      onChange={(event) => setMinEndpointCoverage(event.target.value)}
                    />
                    <b>%</b>
                  </span>
                </label>
              </div>
              <label className="plan-tags-field">
                必须覆盖的标签
                <input
                  className="text-input"
                  value={requiredTags}
                  placeholder="critical, smoke"
                  onChange={(event) => setRequiredTags(event.target.value)}
                />
                <small>多个标签用英文逗号分隔。</small>
              </label>
            </fieldset>
          </div>

          {error ? (
            <div className="plan-editor-error" role="alert">
              <WarningCircle aria-hidden="true" size={16} weight="fill" />
              {error}
            </div>
          ) : null}

          <footer className="plan-editor-footer">
            <span>
              <CheckCircle size={17} /> 已选择 {members.length} 个执行成员
            </span>
            <div>
              <button
                className="button button--outline"
                type="button"
                disabled={busy}
                onClick={onClose}
              >
                取消
              </button>
              <button className="button button--primary" type="submit" disabled={busy}>
                {busy ? '正在保存…' : mode === 'create' ? '创建并发布 v1' : '发布新版本'}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}
