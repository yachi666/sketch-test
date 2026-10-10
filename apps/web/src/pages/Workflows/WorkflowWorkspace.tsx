import {
  ArrowRight,
  BracketsAngle,
  CaretDown,
  Check,
  CheckCircle,
  Clock,
  Code,
  Copy,
  DownloadSimple,
  Lightning,
  MagnifyingGlass,
  PlugsConnected,
  Plus,
  SlidersHorizontal,
  TrashSimple,
  X,
  XCircle,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorCallout } from '../../components/shared/ErrorCallout';
import { cpClient } from '../../lib/cp-client';
import { useWorkflowStore } from '../../stores/workflowStore';
import type { ApiEndpoint, ExecutionLog, StepTone, WorkflowStep } from '../../types';
import { WorkflowCard } from './WorkflowListView';

function methodTone(method: string): StepTone {
  if (method === 'POST') return 'green';
  if (method === 'GET') return 'brown';
  if (method === 'DELETE') return 'brick';
  if (method === 'PUT' || method === 'PATCH') return 'amber';
  return 'violet';
}

function methodIcon(method: string): WorkflowStep['icon'] {
  if (method === 'POST') return 'cart';
  if (method === 'GET') return 'verify';
  if (method === 'DELETE') return 'card';
  if (method === 'PUT' || method === 'PATCH') return 'lock';
  return 'verify';
}

function methodDefaultStatus(method: string): number {
  if (method === 'POST') return 201;
  return 200;
}

function EndpointPickerDialog({
  open,
  endpoints: catalog,
  onSelect,
  onClose,
}: {
  open: boolean;
  endpoints: ApiEndpoint[];
  onSelect: (endpoint: ApiEndpoint) => void;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (open) {
      searchRef.current?.focus();
      setQuery('');
    }
  }, [open]);

  if (!open) return null;

  const q = query.toLowerCase();
  const filtered = catalog.filter((ep) =>
    `${ep.method} ${ep.path} ${ep.summary}`.toLowerCase().includes(q),
  );

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="picker-title">
        <div className="modal-heading">
          <div>
            <span className="eyebrow">ADD STEP FROM CATALOG</span>
            <h2 id="picker-title">选择接口</h2>
          </div>
          <button
            className="icon-button"
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={20} />
          </button>
        </div>

        <div className="endpoint-picker-body">
          <div className="endpoint-picker-search">
            <label className="search-field">
              <MagnifyingGlass size={16} />
              <span className="sr-only">搜索接口</span>
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索方法、路径或摘要..."
              />
            </label>
          </div>

          <div className="endpoint-picker-hint">
            <PlugsConnected size={16} />
            <span>从接口目录中选择一个端点，步骤将自动填充请求方法、路径和默认断言。</span>
          </div>

          <div className="endpoint-picker-list">
            {/* Custom blank step option */}
            <button
              type="button"
              className="endpoint-picker-item endpoint-picker-item--blank"
              onClick={() =>
                onSelect({
                  id: '',
                  method: 'GET',
                  path: '',
                  summary: '自定义空白步骤',
                  coverage: 0,
                  cases: 0,
                  tags: [],
                  deprecated: false,
                })
              }
            >
              <Plus size={20} />
              <span className="picker-endpoint-info">
                <code>自定义空白步骤</code>
                <span>手动填写请求方法和路径</span>
              </span>
            </button>

            {filtered.length === 0 ? (
              <div className="endpoint-picker-empty">
                <MagnifyingGlass size={28} />
                <p>没有匹配的接口</p>
              </div>
            ) : (
              filtered.map((ep) => (
                <button
                  key={ep.id}
                  type="button"
                  className="endpoint-picker-item"
                  onClick={() => onSelect(ep)}
                >
                  <em className={`method method--${ep.method.toLowerCase()}`}>{ep.method}</em>
                  <span className="picker-endpoint-info">
                    <code>{ep.path}</code>
                    <span>{ep.summary}</span>
                  </span>
                  <span>
                    {ep.coverage !== null && ep.coverage > 0 ? (
                      <span className="picker-coverage">
                        <span className="progress">
                          <i style={{ width: `${ep.coverage}%` }} />
                        </span>
                        {ep.coverage}%
                      </span>
                    ) : null}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="modal-actions">
          <button className="button button--ghost" type="button" onClick={onClose}>
            取消
          </button>
        </div>
      </section>
    </div>
  );
}

function WorkflowCanvas({
  steps,
  selectedId,
  logs,
  workflowName,
  versionLabel,
  runState,
  onSelect,
  onAdd,
  onBack,
  onRun,
  onSave,
  onPublish,
  saving,
  publishing,
}: {
  steps: WorkflowStep[];
  selectedId: string;
  logs: ExecutionLog[];
  workflowName: string;
  versionLabel: string;
  runState: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onBack: () => void;
  onRun: () => void;
  onSave: () => void;
  onPublish: () => void;
  saving: boolean;
  publishing: boolean;
}) {
  const statusMap = useMemo(() => new Map(logs.map((log) => [log.stepId, log.status])), [logs]);
  return (
    <section className="workflow-canvas" aria-label="流程编排画布">
      <button className="back-button" type="button" onClick={onBack}>
        <ArrowRight size={16} style={{ transform: 'rotate(180deg)' }} /> 返回流程列表
      </button>
      <div className="paper-title">
        <strong>业务流程：{workflowName}</strong>
        <small>选择步骤查看和编辑请求</small>
      </div>
      <div className="blueprint-stamp" aria-label="流程版本信息">
        <strong>BLUEPRINT LAB</strong>
        <span>PROJECT: {workflowName.replace(/\s/g, '_').toUpperCase()}</span>
        <span>VERSION: {versionLabel}</span>
        <span>DRAWN BY: QA_TEAM</span>
      </div>
      <div className="flow-note">
        <strong>流程说明</strong>
        <span>自动提取关键变量，完成业务闭环验证。</span>
      </div>
      <div className="workflow-line" role="list">
        {steps.map((step, index) => (
          <div className="workflow-stage" role="listitem" key={step.id}>
            <WorkflowCard
              step={step}
              index={index}
              selected={selectedId === step.id}
              executionStatus={statusMap.get(step.id) ?? 'queued'}
              onSelect={() => onSelect(step.id)}
            />
            <div className={`detail-card tone-${step.tone}`}>
              <span>提取变量</span>
              <strong>{step.variableName}</strong>
              <code>{step.variablePath}</code>
            </div>
            <div className={`detail-card assertion-card tone-${step.tone}`}>
              <span>断言</span>
              <strong>
                <Check size={14} /> 状态码 = {step.expectedStatus}
              </strong>
              <code>{step.assertion}</code>
            </div>
            {index < steps.length - 1 ? (
              <div className="flow-arrow" aria-hidden>
                <span>
                  使用
                  <br />
                  {step.variableName}
                </span>
                <ArrowRight size={36} weight="light" />
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div className="canvas-footer">
        <div className="legend" aria-label="图例">
          <strong>图例</strong>
          <span>
            <ArrowRight size={20} /> 执行流
          </span>
          <span>
            <CheckCircle size={16} weight="fill" /> 断言通过
          </span>
          <span>
            <XCircle size={16} weight="fill" /> 断言失败
          </span>
        </div>
        <button
          className={`button button--primary${runState === 'running' ? ' button--loading' : ''}`}
          type="button"
          onClick={onRun}
          disabled={runState === 'running'}
          style={{ marginRight: 8 }}
        >
          <Lightning size={20} />
          {runState === 'running' ? '执行中...' : '运行'}
        </button>
        <button
          className="button button--outline"
          type="button"
          onClick={onSave}
          disabled={saving || publishing}
        >
          {saving ? '保存中...' : '保存草稿'}
        </button>
        <button
          className="button button--outline"
          type="button"
          onClick={onPublish}
          disabled={saving || publishing}
        >
          {publishing ? '发布中...' : '保存并发布'}
        </button>
        <button className="add-step-button" type="button" onClick={onAdd}>
          <Plus size={20} /> 添加步骤
        </button>
      </div>
    </section>
  );
}

function Inspector({
  step,
  stepIndex,
  onChange,
  onDelete,
}: {
  step: WorkflowStep;
  stepIndex: number;
  onChange: (patch: Partial<WorkflowStep>) => void;
  onDelete: () => void;
}) {
  const [tab, setTab] = useState<'basic' | 'request' | 'pre' | 'post'>('basic');
  return (
    <aside className="inspector" aria-label="步骤配置">
      <div className="panel-heading">
        <strong>步骤配置</strong>
        <button type="button" aria-label="收起步骤配置">
          <SlidersHorizontal size={18} />
        </button>
      </div>
      <div className="selected-step-row">
        <span className={`step-chip tone-${step.tone}`}>{stepIndex + 1}</span>
        <strong>{step.name}</strong>
        <span className="rest-pill">REST</span>
      </div>
      <div className="tab-list" role="tablist" aria-label="步骤配置分类">
        {(
          [
            ['basic', '基础配置'],
            ['request', '请求参数'],
            ['pre', '预处理'],
            ['post', '后处理'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'basic' ? (
        <div className="inspector-form">
          <label>
            步骤名称
            <input value={step.name} onChange={(event) => onChange({ name: event.target.value })} />
          </label>
          <label>
            请求方法
            <select
              value={step.method}
              disabled={!!step.requestReference}
              onChange={(event) =>
                onChange({ method: event.target.value as WorkflowStep['method'] })
              }
            >
              <option>GET</option>
              <option>POST</option>
              <option>PUT</option>
              <option>DELETE</option>
            </select>
          </label>
          <label>
            请求地址或 URL 模板
            <input
              value={step.path}
              disabled={!!step.requestReference}
              onChange={(event) => onChange({ path: event.target.value })}
              placeholder="https://api.example.com/orders 或 ${env.baseUrl}/orders"
            />
          </label>
          {step.requestReference && (
            <p>请求来自用例版本 {step.requestReference}，请在用例中编辑并发布新版本。</p>
          )}
          <fieldset>
            <legend>请求头（Headers）</legend>
            {(step.headers ?? []).map((header, index) => (
              <div className="kv-row" key={`${step.id}-header-${index}`}>
                <input
                  aria-label={`请求头 ${index + 1} 名称`}
                  value={header.name}
                  disabled={!!step.requestReference}
                  onChange={(event) =>
                    onChange({
                      headers: step.headers?.map((item, i) =>
                        i === index ? { ...item, name: event.target.value } : item,
                      ),
                    })
                  }
                />
                <input
                  aria-label={`请求头 ${index + 1} 值`}
                  value={header.value}
                  disabled={!!step.requestReference}
                  onChange={(event) =>
                    onChange({
                      headers: step.headers?.map((item, i) =>
                        i === index ? { ...item, value: event.target.value } : item,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  aria-label={`删除请求头 ${index + 1}`}
                  disabled={!!step.requestReference}
                  onClick={() => onChange({ headers: step.headers?.filter((_, i) => i !== index) })}
                >
                  删除
                </button>
              </div>
            ))}
            <button
              className="text-button"
              type="button"
              disabled={!!step.requestReference}
              onClick={() =>
                onChange({ headers: [...(step.headers ?? []), { name: '', value: '' }] })
              }
            >
              <Plus size={15} /> 添加参数
            </button>
          </fieldset>
          <fieldset>
            <legend>提取变量</legend>
            <label>
              变量名
              <input
                value={step.variableName}
                onChange={(event) => onChange({ variableName: event.target.value })}
              />
            </label>
            <label>
              JSONPath
              <input
                value={step.variablePath}
                onChange={(event) => onChange({ variablePath: event.target.value })}
              />
            </label>
          </fieldset>
          <fieldset>
            <legend>断言</legend>
            <label>
              期望状态码
              <input
                type="number"
                value={step.expectedStatus}
                onChange={(event) => onChange({ expectedStatus: Number(event.target.value) })}
              />
            </label>
            <label>
              表达式
              <input
                value={step.assertion}
                onChange={(event) => onChange({ assertion: event.target.value })}
              />
            </label>
            <button className="text-button" type="button">
              <Plus size={15} /> 添加断言
            </button>
          </fieldset>
        </div>
      ) : (
        <div className="empty-inspector">
          {tab === 'request' ? (
            <Code size={28} />
          ) : tab === 'pre' ? (
            <Lightning size={28} />
          ) : (
            <BracketsAngle size={28} />
          )}
          <strong>{tab === 'request' ? '请求参数' : tab === 'pre' ? '预处理' : '后处理'}</strong>
          <p>该区域将在运行前完成校验，并保留可追溯版本。</p>
          <button className="button button--outline" type="button">
            <Plus size={16} /> 新增配置
          </button>
        </div>
      )}
      <button className="delete-button" type="button" onClick={onDelete}>
        <TrashSimple size={17} /> 删除当前步骤
      </button>
    </aside>
  );
}

function BottomConsole({
  logs,
  collapsed,
  activeStepId,
  onToggle,
  onSelectLog,
}: {
  logs: ExecutionLog[];
  collapsed: boolean;
  activeStepId: string;
  onToggle: () => void;
  onSelectLog: (id: string) => void;
}) {
  const [tab, setTab] = useState<'response' | 'assertion' | 'variables'>('response');
  const activeLog = logs.find((log) => log.stepId === activeStepId) ?? logs[0];
  const events = activeLog?.events ?? [];
  const responseEvent = events.filter((event) => event.eventType === 'response.received').at(-1);
  const assertions = events.filter((event) => event.eventType === 'assertion.evaluated');
  const variables = events.filter((event) => event.eventType === 'variable.extracted');
  const eventJson = JSON.stringify(responseEvent?.payload ?? events, null, 2);
  return (
    <section
      className={`bottom-console ${collapsed ? 'bottom-console--collapsed' : ''}`}
      aria-label="执行控制台"
    >
      <div className="console-toolbar">
        <strong>执行日志</strong>
        <label>
          <span className="sr-only">筛选步骤</span>
          <select>
            <option>全部步骤</option>
            <option>仅失败</option>
            <option>仅通过</option>
          </select>
        </label>
        <span className="toolbar-spacer" />
        <button type="button">
          <TrashSimple size={16} /> 清空
        </button>
        <button type="button">
          <DownloadSimple size={16} /> 导出日志
        </button>
        <button type="button" onClick={onToggle}>
          {collapsed ? '展开' : '收起'}{' '}
          <CaretDown className={collapsed ? '' : 'rotate-180'} size={15} />
        </button>
      </div>
      {!collapsed ? (
        <div className="console-body">
          <div className="log-table" role="table" aria-label="执行日志列表">
            {logs.map((log, index) => (
              <button
                className={`log-row ${activeStepId === log.stepId ? 'log-row--active' : ''} log-row--${log.status}`}
                type="button"
                role="row"
                key={log.id}
                onClick={() => onSelectLog(log.stepId)}
              >
                <span>
                  {log.status === 'passed' ? (
                    <CheckCircle size={17} weight="fill" />
                  ) : log.status === 'failed' ? (
                    <XCircle size={17} weight="fill" />
                  ) : log.status === 'running' ? (
                    <Lightning size={17} className="spin" />
                  ) : (
                    <Clock size={17} />
                  )}
                </span>
                <time>{log.timestamp ?? '--:--:--'}</time>
                <span>步骤 {index + 1}</span>
                <strong>{log.name}</strong>
                <code>
                  {log.method} {log.path}
                </code>
                <span>{log.code ?? '—'}</span>
                <span>{log.duration ? `${log.duration} ms` : '—'}</span>
                <span className="log-message">{log.message ?? ''}</span>
              </button>
            ))}
          </div>
          <div className="response-panel">
            <div className="response-tabs" role="tablist">
              {(['response', 'assertion', 'variables'] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  className={tab === id ? 'active' : ''}
                  onClick={() => setTab(id)}
                >
                  {id === 'response' ? '响应' : id === 'assertion' ? '断言' : '提取变量'}
                </button>
              ))}
              <span className="response-meta">
                {activeLog?.code ? `${activeLog.code} ` : ''}
                {activeLog?.duration
                  ? `${activeLog.duration} ms`
                  : events.length
                    ? `${events.length} 个真实事件`
                    : '尚未执行'}
              </span>
              <button
                className="copy-button"
                type="button"
                onClick={() => navigator.clipboard?.writeText(eventJson)}
                aria-label="复制响应"
              >
                <Copy size={15} />
              </button>
            </div>
            {tab === 'response' ? (
              <pre>
                {events.length
                  ? eventJson
                  : '运行已发布版本后，这里会显示 Runner 记录的真实响应事件。'}
              </pre>
            ) : tab === 'assertion' ? (
              <div className="assertion-result">
                {assertions.length ? <CheckCircle size={24} weight="fill" /> : <Clock size={24} />}
                <span>
                  <strong>
                    {assertions.length ? `${assertions.length} 条真实断言事件` : '尚无断言事件'}
                  </strong>
                  <small>
                    {assertions.length
                      ? JSON.stringify(assertions.map((event) => event.payload))
                      : '发布并运行后显示 Runner 的断言结果。'}
                  </small>
                </span>
              </div>
            ) : (
              <div className="variable-list">
                {variables.length ? (
                  variables.map((event, index) => (
                    <span key={`${event.timestamp}-${index}`}>
                      <code>{event.eventType}</code>
                      <strong>{JSON.stringify(event.payload)}</strong>
                    </span>
                  ))
                ) : (
                  <span>尚无变量提取事件</span>
                )}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function WorkflowWorkspace() {
  const navigate = useNavigate();
  const steps = useWorkflowStore((s) => s.steps);
  const setSteps = useWorkflowStore((s) => s.setSteps);
  const selectedId = useWorkflowStore((s) => s.selectedId);
  const setSelectedId = useWorkflowStore((s) => s.setSelectedId);
  const logs = useWorkflowStore((s) => s.logs);
  const backToList = useWorkflowStore((s) => s.backToList);
  const runState = useWorkflowStore((s) => s.runState);
  const runWorkflow = useWorkflowStore((s) => s.runWorkflow);
  const activeWorkflow = useWorkflowStore((s) => s.activeWorkflow);
  const activeVersionId = useWorkflowStore((s) => s.activeVersionId);
  const versions = useWorkflowStore((s) => s.versions);
  const saving = useWorkflowStore((s) => s.saving);
  const publishing = useWorkflowStore((s) => s.publishing);
  const error = useWorkflowStore((s) => s.error);
  const saveDraft = useWorkflowStore((s) => s.saveDraft);
  const publishDraft = useWorkflowStore((s) => s.publishDraft);
  const [apiEndpoints, setApiEndpoints] = useState<ApiEndpoint[]>([]);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const { apiVersions } = await cpClient.listApiVersions();
        const versions = await Promise.all(
          apiVersions.map((version) => cpClient.getApiVersion(version.id)),
        );
        if (disposed) return;
        setApiEndpoints(
          versions.flatMap((version) =>
            Array.isArray(version.endpoints)
              ? (
                  version.endpoints as Array<{
                    id: string;
                    method: ApiEndpoint['method'];
                    path: string;
                    summary?: string;
                    description?: string;
                    deprecated?: boolean;
                    tags?: string[];
                  }>
                ).map((endpoint) => ({
                  id: endpoint.id,
                  method: endpoint.method,
                  path: endpoint.path,
                  summary: endpoint.summary ?? '',
                  description: endpoint.description,
                  coverage: 0,
                  cases: 0,
                  tags: endpoint.tags ?? [],
                  deprecated: endpoint.deprecated ?? false,
                }))
              : [],
          ),
        );
      } catch {
        if (!disposed) setApiEndpoints([]);
      }
    })();
    return () => {
      disposed = true;
    };
  }, []);

  const workflowName = activeWorkflow?.name ?? '正在读取流程...';
  const activeVersion = versions.find((version) => version.id === activeVersionId);

  const [collapsed, setCollapsed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const selectedStep = steps.find((step) => step.id === selectedId) ?? steps[0];
  const updateSelected = (patch: Partial<WorkflowStep>) => {
    if (!selectedStep) return;
    setSteps((current) =>
      current.map((step) => (step.id === selectedStep.id ? { ...step, ...patch } : step)),
    );
  };
  const handleEndpointSelect = (ep: ApiEndpoint) => {
    setPickerOpen(false);
    const id = `step-${Date.now()}`;
    // Blank step -- user chose the custom option
    if (!ep.id) {
      const newStep: WorkflowStep = {
        id,
        name: '新建步骤',
        method: 'GET',
        path: '',
        icon: 'verify',
        tone: 'brown',
        variableName: 'result',
        variablePath: '$.data',
        expectedStatus: 200,
        assertion: '$.code = 0',
      };
      setSteps((current) => [...current, newStep]);
      setSelectedId(id);
      return;
    }
    // Pre-fill from selected endpoint
    const newStep: WorkflowStep = {
      id,
      name: ep.summary,
      method: ep.method,
      path: ep.path,
      icon: methodIcon(ep.method),
      tone: methodTone(ep.method),
      variableName: methodDefaultStatus(ep.method) === 201 ? 'newId' : 'result',
      variablePath: '$.data',
      expectedStatus: methodDefaultStatus(ep.method),
      assertion: '$.code = 0',
      sourceEndpointId: ep.id,
    };
    setSteps((current) => [...current, newStep]);
    setSelectedId(id);
  };
  const deleteStep = () => {
    if (steps.length <= 1 || !selectedStep) return;
    const index = steps.findIndex((step) => step.id === selectedStep.id);
    const next = steps.filter((step) => step.id !== selectedStep.id);
    setSteps(next);
    setSelectedId(next[Math.max(0, index - 1)].id);
  };
  if (!activeWorkflow) {
    return (
      <main className="page-view">
        <section className="empty-module">
          <h3>{error ? '无法打开流程' : '正在读取流程...'}</h3>
          <p>{error ?? '正在从 Control Plane 加载流程与版本。'}</p>
          <button
            className="button button--outline"
            type="button"
            onClick={() => navigate('/workflows')}
          >
            返回流程列表
          </button>
        </section>
      </main>
    );
  }
  return (
    <div className="workflow-workspace">
      {error ? <ErrorCallout title="流程操作未完成" message={error} /> : null}
      <EndpointPickerDialog
        open={pickerOpen}
        endpoints={apiEndpoints}
        onSelect={handleEndpointSelect}
        onClose={() => setPickerOpen(false)}
      />
      <div className="workflow-upper">
        <WorkflowCanvas
          steps={steps}
          selectedId={selectedId}
          logs={logs}
          workflowName={workflowName}
          versionLabel={activeVersion ? `v${activeVersion.version}` : '未保存'}
          runState={runState}
          onSelect={setSelectedId}
          onAdd={() => setPickerOpen(true)}
          onBack={() => {
            backToList();
            navigate('/workflows');
          }}
          onRun={runWorkflow}
          onSave={() => void saveDraft()}
          onPublish={() => void publishDraft()}
          saving={saving}
          publishing={publishing}
        />
        {selectedStep ? (
          <Inspector
            step={selectedStep}
            stepIndex={steps.findIndex((step) => step.id === selectedStep.id)}
            onChange={updateSelected}
            onDelete={deleteStep}
          />
        ) : (
          <aside className="inspector">
            <div className="empty-inspector">
              <strong>尚无步骤</strong>
              <p>从接口目录添加一个步骤，或创建一个空白步骤。</p>
            </div>
          </aside>
        )}
      </div>
      <BottomConsole
        logs={logs}
        collapsed={collapsed}
        activeStepId={selectedId}
        onToggle={() => setCollapsed((value) => !value)}
        onSelectLog={setSelectedId}
      />
    </div>
  );
}
