import {
  CheckCircle,
  Clipboard,
  CreditCard,
  FlowArrow,
  Lock,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  ShoppingCart,
  User,
  X,
  XCircle,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorCallout } from '../../components/shared/ErrorCallout';
import { useAuthStore } from '../../stores/authStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import type { ExecutionLog, WorkflowStep } from '../../types';

function stepIcon(icon: WorkflowStep['icon'], size = 38) {
  const props = { size, weight: 'duotone' as const, 'aria-hidden': true };
  if (icon === 'user') return <User {...props} />;
  if (icon === 'lock') return <Lock {...props} />;
  if (icon === 'cart') return <ShoppingCart {...props} />;
  if (icon === 'card') return <CreditCard {...props} />;
  return <Clipboard {...props} />;
}

export function WorkflowCard({
  step,
  index,
  selected,
  executionStatus,
  onSelect,
}: {
  step: WorkflowStep;
  index: number;
  selected: boolean;
  executionStatus: ExecutionLog['status'];
  onSelect: () => void;
}) {
  return (
    <button
      className={`workflow-card tone-${step.tone} ${selected ? 'workflow-card--selected' : ''} status-${executionStatus}`}
      type="button"
      onClick={onSelect}
      aria-label={`编辑步骤 ${index + 1} ${step.name}`}
    >
      <span className="step-number">{index + 1}</span>
      <span className="rest-label">REST</span>
      <span className="step-icon">{stepIcon(step.icon)}</span>
      <strong>{step.name}</strong>
      <span className="endpoint">
        <em>{step.method}</em> {step.path}
      </span>
      {executionStatus === 'running' ? <span className="status-ribbon">执行中</span> : null}
      {executionStatus === 'passed' ? (
        <CheckCircle className="card-result card-result--success" size={22} weight="fill" />
      ) : null}
      {executionStatus === 'failed' ? (
        <XCircle className="card-result card-result--failure" size={22} weight="fill" />
      ) : null}
    </button>
  );
}

export function WorkflowListView() {
  const navigate = useNavigate();
  const workspaceId = useAuthStore((state) => state.user?.workspaceId);
  const workflows = useWorkflowStore((state) => state.cpWorkflows);
  const loading = useWorkflowStore((state) => state.loading);
  const saving = useWorkflowStore((state) => state.saving);
  const error = useWorkflowStore((state) => state.error);
  const fetchWorkflowsFromServer = useWorkflowStore((state) => state.fetchWorkflowsFromServer);
  const createWorkflow = useWorkflowStore((state) => state.createWorkflow);
  const [query, setQuery] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (workspaceId) void fetchWorkflowsFromServer(workspaceId);
  }, [fetchWorkflowsFromServer, workspaceId]);

  const filtered = useMemo(
    () =>
      workflows.filter((workflow) =>
        `${workflow.name} ${workflow.description}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      ),
    [query, workflows],
  );

  const handleCreate = async () => {
    if (!workspaceId || !name.trim()) return;
    const workflow = await createWorkflow(
      workspaceId,
      name.trim(),
      description.trim() || undefined,
    );
    if (workflow) {
      setComposerOpen(false);
      setName('');
      setDescription('');
      navigate(`/workflows/${workflow.id}`);
    }
  };

  return (
    <main className="page-view workflow-list-view">
      <div className="page-actions-row">
        <button
          className="button button--primary"
          type="button"
          onClick={() => setComposerOpen(true)}
          disabled={!workspaceId || saving}
        >
          <Plus size={18} />
          {saving ? '创建中...' : '新建流程'}
        </button>
      </div>

      <div className="workflow-filter-bar">
        <strong>全部 ({workflows.length})</strong>
        <span className="toolbar-spacer" />
        <label className="search-field" style={{ minWidth: 200 }}>
          <MagnifyingGlass size={16} />
          <span className="sr-only">搜索业务流程</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索名称或说明"
          />
        </label>
      </div>

      {error ? (
        <ErrorCallout
          title="流程数据暂不可用"
          message={error}
          onRetry={() => (workspaceId ? fetchWorkflowsFromServer(workspaceId) : undefined)}
        />
      ) : null}
      {loading ? (
        <section className="empty-module">
          <p>正在读取 Control Plane 中的流程...</p>
        </section>
      ) : null}
      {!loading ? (
        <section className="workflow-grid" aria-label="业务流程列表">
          {filtered.map((workflow) => {
            const version = workflow.latestVersion;
            const steps = (version?.definition as { steps?: unknown[] } | undefined)?.steps;
            const stepCount = Array.isArray(steps) ? steps.length : 0;
            const published = Boolean(version?.compiledPlan);
            return (
              <button
                key={workflow.id}
                type="button"
                className="workflow-item-card workflow-item--healthy"
                onClick={() => navigate(`/workflows/${workflow.id}`)}
              >
                <div className="workflow-item-header">
                  <span className="bp-badge bp-badge--normal">流程</span>
                  <span className="bp-status bp-status--healthy">
                    {published ? '已发布' : version ? '草稿' : '未配置'}
                  </span>
                </div>
                <h3>{workflow.name}</h3>
                <p>{workflow.description || '尚未添加流程说明。'}</p>
                <div className="workflow-item-meta">
                  <span title="步骤数">
                    <FlowArrow size={15} />
                    {stepCount} 步骤
                  </span>
                  <span>
                    <PencilSimple size={15} />
                    {version ? `v${version.version}` : '尚无版本'}
                  </span>
                </div>
                <div className="workflow-item-footer">
                  <time>更新于 {new Date(workflow.updatedAt).toLocaleString('zh-CN')}</time>
                </div>
              </button>
            );
          })}
        </section>
      ) : null}
      {!loading && filtered.length === 0 ? (
        <section className="empty-module">
          <FlowArrow size={58} weight="duotone" />
          <h3>{workflows.length ? '暂无匹配的业务流程' : '还没有业务流程'}</h3>
          <p>
            {workflows.length
              ? '调整搜索条件后再试。'
              : '新建一个流程，并在编辑器中添加真实请求地址。'}
          </p>
        </section>
      ) : null}
      {composerOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setComposerOpen(false);
          }}
        >
          <section
            aria-labelledby="new-workflow-title"
            aria-modal="true"
            className="modal"
            role="dialog"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">CREATE WORKFLOW</span>
                <h2 id="new-workflow-title">新建流程</h2>
              </div>
              <button
                aria-label="关闭"
                className="icon-button"
                onClick={() => setComposerOpen(false)}
                type="button"
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <label>
                流程名称 <span className="required">*</span>
                <input
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例如：创建订单并完成支付"
                  value={name}
                />
              </label>
              <label>
                说明
                <textarea
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="说明流程目标、前置条件或清理要求"
                  value={description}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button
                className="button button--ghost"
                onClick={() => setComposerOpen(false)}
                type="button"
              >
                取消
              </button>
              <button
                className="button button--primary"
                disabled={saving || !name.trim()}
                onClick={() => void handleCreate()}
                type="button"
              >
                {saving ? '创建中...' : '创建流程'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
