import { ArrowRight } from '@phosphor-icons/react/ArrowRight';
import { ArrowsClockwise } from '@phosphor-icons/react/ArrowsClockwise';
import { Bell } from '@phosphor-icons/react/Bell';
import { BracketsAngle } from '@phosphor-icons/react/BracketsAngle';
import { BracketsCurly } from '@phosphor-icons/react/BracketsCurly';
import { Bug } from '@phosphor-icons/react/Bug';
import { CalendarCheck } from '@phosphor-icons/react/CalendarCheck';
import { CaretDown } from '@phosphor-icons/react/CaretDown';
import { CaretRight } from '@phosphor-icons/react/CaretRight';
import { ChartBar } from '@phosphor-icons/react/ChartBar';
import { Check } from '@phosphor-icons/react/Check';
import { CheckCircle } from '@phosphor-icons/react/CheckCircle';
import { Clipboard } from '@phosphor-icons/react/Clipboard';
import { ClipboardText } from '@phosphor-icons/react/ClipboardText';
import { Clock } from '@phosphor-icons/react/Clock';
import { Code } from '@phosphor-icons/react/Code';
import { Copy } from '@phosphor-icons/react/Copy';
import { CreditCard } from '@phosphor-icons/react/CreditCard';
import { Cube } from '@phosphor-icons/react/Cube';
import { Database } from '@phosphor-icons/react/Database';
import { DotsNine } from '@phosphor-icons/react/DotsNine';
import { DotsThree } from '@phosphor-icons/react/DotsThree';
import { DownloadSimple } from '@phosphor-icons/react/DownloadSimple';
import { Eye } from '@phosphor-icons/react/Eye';
import { EyeSlash } from '@phosphor-icons/react/EyeSlash';
import { FileArrowUp } from '@phosphor-icons/react/FileArrowUp';
import { FileCode } from '@phosphor-icons/react/FileCode';
import { FloppyDisk } from '@phosphor-icons/react/FloppyDisk';
import { FlowArrow } from '@phosphor-icons/react/FlowArrow';
import { Folders } from '@phosphor-icons/react/Folders';
import { GearSix } from '@phosphor-icons/react/GearSix';
import { GitBranch } from '@phosphor-icons/react/GitBranch';
import { GitCommit } from '@phosphor-icons/react/GitCommit';
import { House } from '@phosphor-icons/react/House';
import { Info } from '@phosphor-icons/react/Info';
import { Key } from '@phosphor-icons/react/Key';
import { Lightning } from '@phosphor-icons/react/Lightning';
import { LinkSimple } from '@phosphor-icons/react/LinkSimple';
import { Lock } from '@phosphor-icons/react/Lock';
import { MagnifyingGlass } from '@phosphor-icons/react/MagnifyingGlass';
import { PencilSimple } from '@phosphor-icons/react/PencilSimple';
import { Play } from '@phosphor-icons/react/Play';
import { PlugsConnected } from '@phosphor-icons/react/PlugsConnected';
import { Plus } from '@phosphor-icons/react/Plus';
import { Robot } from '@phosphor-icons/react/Robot';
import { ShieldCheck } from '@phosphor-icons/react/ShieldCheck';
import { ShoppingCart } from '@phosphor-icons/react/ShoppingCart';
import { SidebarSimple } from '@phosphor-icons/react/SidebarSimple';
import { SlidersHorizontal } from '@phosphor-icons/react/SlidersHorizontal';
import { Sparkle } from '@phosphor-icons/react/Sparkle';
import { Stack } from '@phosphor-icons/react/Stack';
import { Table } from '@phosphor-icons/react/Table';
import { Trash } from '@phosphor-icons/react/Trash';
import { TrashSimple } from '@phosphor-icons/react/TrashSimple';
import { UploadSimple } from '@phosphor-icons/react/UploadSimple';
import { User } from '@phosphor-icons/react/User';
import { UsersThree } from '@phosphor-icons/react/UsersThree';
import { Warning } from '@phosphor-icons/react/Warning';
import { X } from '@phosphor-icons/react/X';
import { XCircle } from '@phosphor-icons/react/XCircle';
import type { VariableScope } from '@sketch-test/contracts-common';
import {
  type ElementType,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  endpoints,
  initialCases,
  initialLogs,
  initialSteps,
  initialVariables,
  makeLogs,
  responseFixture,
  workflowStepsMap,
  workflows,
} from './data';
import type {
  ApiEndpoint,
  ExecutionLog,
  RunState,
  StepTone,
  TestCase,
  Variable,
  VariableType,
  ViewId,
  WorkflowMeta,
  WorkflowStep,
} from './types';

const viewLabels: Record<ViewId, string> = {
  overview: '工作台',
  projects: '项目管理',
  workflows: '业务流程',
  apis: '接口管理',
  cases: '用例管理',
  plans: '测试计划',
  environments: '环境管理',
  variables: '变量管理',
  reports: '报告中心',
  agent: 'AI Agent',
  team: '团队管理',
  trash: '回收站',
};

const navItems: Array<{ id: ViewId; label: string; icon: ElementType; accent?: boolean }> = [
  { id: 'overview', label: '工作台', icon: House },
  { id: 'projects', label: '项目管理', icon: Folders },
  { id: 'workflows', label: '业务流程', icon: FlowArrow, accent: true },
  { id: 'apis', label: '接口管理', icon: PlugsConnected },
  { id: 'cases', label: '用例管理', icon: ClipboardText },
  { id: 'plans', label: '测试计划', icon: CalendarCheck },
  { id: 'environments', label: '环境管理', icon: Stack },
  { id: 'variables', label: '变量管理', icon: BracketsCurly },
  { id: 'reports', label: '报告中心', icon: ChartBar },
  { id: 'agent', label: 'AI Agent', icon: Robot },
  { id: 'team', label: '团队管理', icon: UsersThree },
  { id: 'trash', label: '回收站', icon: Trash },
];

const sleep = (milliseconds: number) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function stepIcon(icon: WorkflowStep['icon'], size = 38) {
  const props = { size, weight: 'duotone' as const, 'aria-hidden': true };
  if (icon === 'user') return <User {...props} />;
  if (icon === 'lock') return <Lock {...props} />;
  if (icon === 'cart') return <ShoppingCart {...props} />;
  if (icon === 'card') return <CreditCard {...props} />;
  return <Clipboard {...props} />;
}

function Sidebar({
  activeView,
  open,
  onNavigate,
  onClose,
}: {
  activeView: ViewId;
  open: boolean;
  onNavigate: (view: ViewId) => void;
  onClose: () => void;
}) {
  return (
    <>
      <aside className={`sidebar ${open ? 'sidebar--open' : ''}`} aria-label="主导航">
        <div className="brand-lockup">
          <span className="brand-mark">
            <Cube size={28} weight="duotone" />
          </span>
          <span>
            <strong>SketchTest</strong>
            <small>API 自动化测试平台</small>
          </span>
          <button className="mobile-close" type="button" onClick={onClose} aria-label="关闭导航">
            <X size={20} />
          </button>
        </div>
        <nav className="nav-list">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={`nav-item ${activeView === item.id ? 'nav-item--active' : ''}`}
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                aria-current={activeView === item.id ? 'page' : undefined}
              >
                <Icon size={20} weight={activeView === item.id ? 'duotone' : 'regular'} />
                <span>{item.label}</span>
                {item.accent ? <span className="nav-pulse" aria-label="核心功能" /> : null}
                {item.id === 'agent' ? <span className="new-tag">Beta</span> : null}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <button className="profile-row" type="button">
            <span className="avatar">QA</span>
            <span>
              <strong>QA_team</strong>
              <small>QA 工程师</small>
            </span>
            <CaretRight size={16} />
          </button>
        </div>
      </aside>
      {open ? (
        <button
          className="sidebar-backdrop"
          type="button"
          aria-label="关闭导航"
          onClick={onClose}
        />
      ) : null}
    </>
  );
}

function Topbar({
  title,
  runState,
  onMenu,
  onSave,
  onRun,
  onImport,
  environment,
  onEnvironment,
}: {
  title: string;
  runState: RunState;
  onMenu: () => void;
  onSave: () => void;
  onRun: () => void;
  onImport: () => void;
  environment: string;
  onEnvironment: (value: string) => void;
}) {
  return (
    <header className="topbar">
      <div className="topbar-title">
        <button className="mobile-menu" type="button" onClick={onMenu} aria-label="打开导航">
          <SidebarSimple size={22} />
        </button>
        <div>
          <div className="crumb">
            SketchTest 演示项目 <span>/</span>
          </div>
          <h1>
            {title} <PencilSimple size={16} aria-hidden />
          </h1>
          <p>更新于 2026-06-21 10:30 · 创建人 QA_team</p>
        </div>
      </div>
      <div className="topbar-actions">
        <button className="button button--outline" type="button" onClick={onSave}>
          <FloppyDisk size={18} />
          保存草稿
        </button>
        <button
          className="button button--success"
          type="button"
          onClick={onRun}
          disabled={runState === 'running'}
        >
          {runState === 'running' ? (
            <Lightning className="spin" size={18} />
          ) : (
            <Play size={18} weight="fill" />
          )}
          {runState === 'running' ? '执行中' : '调试运行'}
        </button>
        <button className="button button--ghost hide-small" type="button">
          <Bug size={18} />
          调试
        </button>
        <label className="select-wrap hide-small">
          <span className="sr-only">测试环境</span>
          <select value={environment} onChange={(event) => onEnvironment(event.target.value)}>
            <option value="测试环境">环境：测试环境</option>
            <option value="预发布环境">环境：预发布环境</option>
            <option value="生产只读">环境：生产只读</option>
          </select>
          <CaretDown size={15} aria-hidden />
        </label>
        <button
          className="icon-button hide-medium"
          type="button"
          onClick={onImport}
          aria-label="导入 OpenAPI"
          title="导入 OpenAPI"
        >
          <UploadSimple size={20} />
        </button>
        <button
          className="icon-button hide-medium"
          type="button"
          aria-label="导出流程"
          title="导出流程"
        >
          <DownloadSimple size={20} />
        </button>
        <button className="icon-button hide-medium" type="button" aria-label="通知" title="通知">
          <Bell size={20} />
        </button>
        <button className="icon-button" type="button" aria-label="设置" title="设置">
          <GearSix size={20} />
        </button>
      </div>
    </header>
  );
}

function sideEffectLabel(effect: WorkflowMeta['sideEffect']) {
  if (effect === 'readonly') return '只读';
  if (effect === 'cleanable-write') return '可清理写入';
  return '不可逆';
}

function sideEffectIcon(effect: WorkflowMeta['sideEffect']) {
  if (effect === 'readonly') return <Eye size={15} />;
  if (effect === 'cleanable-write') return <PencilSimple size={15} />;
  return <Lock size={15} />;
}

function WorkflowListView({ onSelect }: { onSelect: (workflowId: string) => void }) {
  const [filter, setFilter] = useState<'all' | 'normal' | 'error-path'>('all');
  const [query, setQuery] = useState('');
  const filtered = workflows.filter(
    (wf) =>
      (filter === 'all' || wf.category === filter) &&
      (wf.name.includes(query) ||
        wf.bpId.includes(query.toUpperCase()) ||
        wf.description.includes(query) ||
        wf.tags.some((t) => t.includes(query))),
  );

  return (
    <main className="page-view workflow-list-view">
      <div className="page-intro">
        <div>
          <span className="eyebrow">BUSINESS PROCESSES</span>
          <h2>业务流程</h2>
          <p>
            每个业务流程是一个多接口 API
            序列，覆盖正常路径和异常路径，支持变量传递、条件、重试和清理。
          </p>
        </div>
        <button className="button button--primary" type="button">
          <Plus size={18} />
          新建流程
        </button>
      </div>

      <div className="workflow-filter-bar">
        <div className="filter-tabs">
          {(
            [
              ['all', '全部'],
              ['normal', '正常流程'],
              ['error-path', '异常路径'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`filter-tab ${filter === key ? 'filter-tab--active' : ''}`}
              onClick={() => setFilter(key)}
            >
              {label}
              {key === 'all'
                ? ` (${workflows.length})`
                : ` (${workflows.filter((w) => w.category === key).length})`}
            </button>
          ))}
        </div>
        <span className="toolbar-spacer" />
        <label className="search-field" style={{ minWidth: 200 }}>
          <MagnifyingGlass size={16} />
          <span className="sr-only">搜索业务流程</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索名称、标签或 BP 编号"
          />
        </label>
      </div>

      <section className="workflow-grid" aria-label="业务流程列表">
        {filtered.map((wf) => (
          <button
            key={wf.id}
            type="button"
            className={`workflow-item-card workflow-item--${wf.status}`}
            onClick={() => onSelect(wf.id)}
          >
            <div className="workflow-item-header">
              <span className={`bp-badge bp-badge--${wf.category}`}>{wf.bpId}</span>
              <span className={`bp-status bp-status--${wf.status}`}>
                {wf.status === 'healthy' ? '健康' : wf.status === 'warning' ? '需关注' : '草稿'}
              </span>
            </div>

            <h3>{wf.name}</h3>
            <p>{wf.description}</p>

            <div className="workflow-item-meta">
              <span title="步骤数">
                <FlowArrow size={15} />
                {wf.stepCount} 步骤
              </span>
              <span title={`副作用等级：${sideEffectLabel(wf.sideEffect)}`}>
                {sideEffectIcon(wf.sideEffect)}
                {sideEffectLabel(wf.sideEffect)}
              </span>
            </div>

            <div className="workflow-item-vars">
              {wf.variableChain.length > 0 ? (
                <>
                  <span className="var-label">变量链路</span>
                  {wf.variableChain.map((v, i) => (
                    <span key={v}>
                      {i > 0 ? <ArrowRight size={12} /> : null}
                      <code>{v}</code>
                    </span>
                  ))}
                </>
              ) : (
                <span className="var-label">无变量传递</span>
              )}
            </div>

            <div className="workflow-item-footer">
              <span className="workflow-tags">
                {wf.tags.map((tag) => (
                  <span key={tag} className="bp-tag">
                    {tag}
                  </span>
                ))}
              </span>
              {wf.lastRun ? <time>最近执行 {wf.lastRun}</time> : null}
            </div>
          </button>
        ))}
      </section>

      {filtered.length === 0 ? (
        <section className="empty-module">
          <FlowArrow size={58} weight="duotone" />
          <h3>暂无匹配的业务流程</h3>
          <p>切换筛选条件或新建一个流程。</p>
        </section>
      ) : null}
    </main>
  );
}

function WorkflowCard({
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

function WorkflowCanvas({
  steps,
  selectedId,
  logs,
  workflowName,
  onSelect,
  onAdd,
  onBack,
}: {
  steps: WorkflowStep[];
  selectedId: string;
  logs: ExecutionLog[];
  workflowName: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onBack: () => void;
}) {
  const statusMap = useMemo(() => new Map(logs.map((log) => [log.stepId, log.status])), [logs]);
  return (
    <section className="workflow-canvas" aria-label="流程编排画布">
      <button className="back-button" type="button" onClick={onBack}>
        <ArrowRight size={16} style={{ transform: 'rotate(180deg)' }} /> 返回流程列表
      </button>
      <div className="paper-title">
        <strong>业务流程：{workflowName}</strong>
        <small>拖动步骤可以重新编排</small>
      </div>
      <div className="blueprint-stamp" aria-label="流程版本信息">
        <strong>BLUEPRINT LAB</strong>
        <span>PROJECT: {workflowName.replace(/\s/g, '_').toUpperCase()}</span>
        <span>VERSION: v1.0.0</span>
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
        <button className="add-step-button" type="button" onClick={onAdd}>
          <Plus size={20} /> 添加步骤
        </button>
      </div>
    </section>
  );
}

function Inspector({
  step,
  onChange,
  onDelete,
}: {
  step: WorkflowStep;
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
        <span className={`step-chip tone-${step.tone}`}>
          {initialSteps.findIndex((item) => item.id === step.id) + 1 || '+'}
        </span>
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
            请求地址
            <input
              value={`{{baseUrl}}${step.path}`}
              onChange={(event) =>
                onChange({ path: event.target.value.replace('{{baseUrl}}', '') })
              }
            />
          </label>
          <fieldset>
            <legend>请求头（Headers）</legend>
            <div className="kv-row">
              <CheckCircle size={15} weight="fill" />
              <code>Content-Type</code>
              <span>application/json</span>
            </div>
            <div className="kv-row">
              <CheckCircle size={15} weight="fill" />
              <code>Authorization</code>
              <span>Bearer {'{{accessToken}}'}</span>
            </div>
            <button className="text-button" type="button">
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
              <span className="response-meta">200 OK　210 ms　512 B</span>
              <button
                className="copy-button"
                type="button"
                onClick={() => navigator.clipboard?.writeText(responseFixture)}
                aria-label="复制响应"
              >
                <Copy size={15} />
              </button>
            </div>
            {tab === 'response' ? (
              <pre>{responseFixture}</pre>
            ) : tab === 'assertion' ? (
              <div className="assertion-result">
                <XCircle size={24} weight="fill" />
                <span>
                  <strong>1 条断言失败</strong>
                  <small>$.data.status 期望值“已支付”，实际值“待支付”</small>
                </span>
              </div>
            ) : (
              <div className="variable-list">
                <span>
                  <code>orderId</code>
                  <strong>123456</strong>
                </span>
                <span>
                  <code>status</code>
                  <strong>待支付</strong>
                </span>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function WorkflowWorkspace({
  steps,
  setSteps,
  selectedId,
  setSelectedId,
  logs,
  workflowName,
  onBack,
}: {
  steps: WorkflowStep[];
  setSteps: React.Dispatch<React.SetStateAction<WorkflowStep[]>>;
  selectedId: string;
  setSelectedId: (id: string) => void;
  logs: ExecutionLog[];
  workflowName: string;
  onBack: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const selectedStep = steps.find((step) => step.id === selectedId) ?? steps[0];
  const updateSelected = (patch: Partial<WorkflowStep>) =>
    setSteps((current) =>
      current.map((step) => (step.id === selectedStep.id ? { ...step, ...patch } : step)),
    );
  const handleEndpointSelect = (ep: ApiEndpoint) => {
    setPickerOpen(false);
    const id = `step-${Date.now()}`;
    // Blank step — user chose the custom option
    if (!ep.id) {
      const newStep: WorkflowStep = {
        id,
        name: '新建步骤',
        method: 'GET',
        path: '/api/new-endpoint',
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
    if (steps.length <= 1) return;
    const index = steps.findIndex((step) => step.id === selectedStep.id);
    const next = steps.filter((step) => step.id !== selectedStep.id);
    setSteps(next);
    setSelectedId(next[Math.max(0, index - 1)].id);
  };
  return (
    <div className="workflow-workspace">
      <EndpointPickerDialog
        open={pickerOpen}
        endpoints={endpoints}
        onSelect={handleEndpointSelect}
        onClose={() => setPickerOpen(false)}
      />
      <div className="workflow-upper">
        <WorkflowCanvas
          steps={steps}
          selectedId={selectedId}
          logs={logs}
          workflowName={workflowName}
          onSelect={setSelectedId}
          onAdd={() => setPickerOpen(true)}
          onBack={onBack}
        />
        <Inspector step={selectedStep} onChange={updateSelected} onDelete={deleteStep} />
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

function MetricCard({
  icon: Icon,
  label,
  value,
  delta,
  tone,
}: {
  icon: ElementType;
  label: string;
  value: string;
  delta: string;
  tone: string;
}) {
  return (
    <button className={`metric-card tone-${tone}`} type="button">
      <span>
        <Icon size={23} weight="duotone" />
      </span>
      <small>{label}</small>
      <strong>{value}</strong>
      <em>{delta}</em>
    </button>
  );
}

function OverviewView({
  onNavigate,
  onImport,
  onOpenWorkflow,
}: {
  onNavigate: (view: ViewId) => void;
  onImport: () => void;
  onOpenWorkflow: (id: string) => void;
}) {
  const topFlows = workflows.slice(0, 4);
  return (
    <main className="page-view overview-view">
      <div className="page-intro">
        <div>
          <span className="eyebrow">SKETCHTEST / PROJECT</span>
          <h2>早上好，今天的 API 很诚实。</h2>
          <p>
            共 {workflows.length} 条业务流程，
            {workflows.filter((w) => w.status === 'healthy').length} 条健康，仍有 3
            个失败用例需要关注。
          </p>
        </div>
        <button className="button button--primary" type="button" onClick={onImport}>
          <FileArrowUp size={18} />
          导入 OpenAPI
        </button>
      </div>
      <section className="metrics-grid" aria-label="质量指标">
        <MetricCard
          icon={PlugsConnected}
          label="API 覆盖率"
          value="78%"
          delta="188 / 240"
          tone="brown"
        />
        <MetricCard
          icon={CheckCircle}
          label="通过率"
          value="96.4%"
          delta="较上周 +2.1%"
          tone="green"
        />
        <MetricCard
          icon={ClipboardText}
          label="总用例数"
          value="612"
          delta="本周新增 24"
          tone="amber"
        />
        <MetricCard
          icon={FlowArrow}
          label="关键流程"
          value={`${workflows.length}`}
          delta={`${workflows.filter((w) => w.status === 'healthy').length} 条健康`}
          tone="violet"
        />
        <MetricCard icon={XCircle} label="失败" value="3" delta="需要关注" tone="brick" />
      </section>
      <div className="overview-grid">
        <section className="paper-panel health-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">LAST 7 DAYS</span>
              <h3>运行健康度</h3>
            </div>
            <button type="button">
              <DotsThree size={20} />
            </button>
          </div>
          <div className="bar-chart" aria-label="最近七天运行健康度柱状图">
            {[64, 68, 72, 70, 82, 78, 91].map((value, index) => (
              <div key={index}>
                <span className="bar-success" style={{ height: `${value}%` }} />
                <span className="bar-failure" style={{ height: `${index === 5 ? 14 : 8}%` }} />
                <small>06-{15 + index}</small>
              </div>
            ))}
          </div>
          <div className="chart-legend">
            <span>
              <i className="dot dot--success" />
              通过 51
            </span>
            <span>
              <i className="dot dot--failure" />
              失败 3
            </span>
            <span>
              <i className="dot dot--muted" />
              跳过 1
            </span>
          </div>
        </section>
        <section className="paper-panel recent-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">RECENT RUNS</span>
              <h3>最近执行</h3>
            </div>
            <button className="text-button" type="button" onClick={() => onNavigate('reports')}>
              查看全部 <CaretRight size={15} />
            </button>
          </div>
          {['每日回归测试', '订单流程验证', '全量回归测试', '新增 API 验证'].map((name, index) => (
            <button
              className="recent-row"
              type="button"
              key={name}
              onClick={() => onNavigate('reports')}
            >
              <time>{index === 0 ? '10:24' : `${8 - index}:15`}</time>
              <strong>{name}</strong>
              <span className="env-tag">测试环境</span>
              <span>{55 - index * 9} 用例</span>
              <span
                className={
                  index === 1
                    ? 'status-badge status-badge--failed'
                    : 'status-badge status-badge--passed'
                }
              >
                {index === 1 ? '失败' : '通过'}
              </span>
              <CaretRight size={15} />
            </button>
          ))}
        </section>
        <section className="paper-panel attention-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">NEEDS ATTENTION</span>
              <h3>失败用例</h3>
            </div>
            <span className="stamp stamp--danger">失败 3</span>
          </div>
          {['POST /v1/orders/create', 'GET /v1/users/{id}', 'PUT /v1/inventory/{id}'].map(
            (path, index) => (
              <div className="failure-row" key={path}>
                <span className="failure-pin" />
                <code>{path}</code>
                <span>{['订单创建校验失败', '用户信息查询超时', '库存更新数据不一致'][index]}</span>
                <time>{['2 小时前', '5 小时前', '1 天前'][index]}</time>
              </div>
            ),
          )}
        </section>
        <section className="paper-panel flow-preview">
          <div className="section-heading">
            <div>
              <span className="eyebrow">BUSINESS FLOWS</span>
              <h3>业务流程速览</h3>
            </div>
            <button className="text-button" type="button" onClick={() => onNavigate('workflows')}>
              浏览全部 <CaretRight size={15} />
            </button>
          </div>
          <div className="quick-flows-grid">
            {topFlows.map((wf) => (
              <button
                key={wf.id}
                type="button"
                className={`quick-flow-card quick-flow--${wf.status}`}
                onClick={() => onOpenWorkflow(wf.id)}
              >
                <span className={`bp-badge bp-badge--${wf.category}`}>{wf.bpId}</span>
                <strong>{wf.name}</strong>
                <small>
                  {wf.stepCount} 步骤 · {sideEffectLabel(wf.sideEffect)}
                </small>
                <span className={`bp-status bp-status--${wf.status}`}>
                  {wf.status === 'healthy' ? '健康' : wf.status === 'warning' ? '需关注' : '草稿'}
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function ApiView({ onImport, imported }: { onImport: () => void; imported: boolean }) {
  const [query, setQuery] = useState('');
  const filtered = endpoints.filter((item) =>
    `${item.method} ${item.path} ${item.summary}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <main className="page-view">
      <div className="page-intro">
        <div>
          <span className="eyebrow">API CATALOG</span>
          <h2>接口资产</h2>
          <p>统一管理 OpenAPI 版本、覆盖率和变更影响。</p>
        </div>
        <button className="button button--primary" type="button" onClick={onImport}>
          <FileArrowUp size={18} />
          导入文档
        </button>
      </div>
      {imported ? (
        <div className="notice notice--success">
          <CheckCircle size={20} weight="fill" />
          <span>
            <strong>openapi.yaml 已导入</strong>已识别 6 个接口和 18 个 Schema。
          </span>
        </div>
      ) : null}
      <section className="table-panel">
        <div className="table-toolbar">
          <label className="search-field">
            <MagnifyingGlass size={18} />
            <span className="sr-only">搜索接口</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索路径或摘要"
            />
          </label>
          <span className="toolbar-spacer" />
          <button className="button button--outline" type="button">
            <SlidersHorizontal size={17} />
            筛选
          </button>
          <button className="button button--outline" type="button">
            <GitBranch size={17} />
            比较版本
          </button>
        </div>
        <div className="data-table">
          <div className="data-row data-row--head">
            <span>方法</span>
            <span>路径与摘要</span>
            <span>覆盖率</span>
            <span>用例</span>
            <span>操作</span>
          </div>
          {filtered.map((api) => (
            <div className="data-row" key={api.id}>
              <span>
                <em className={`method method--${api.method.toLowerCase()}`}>{api.method}</em>
              </span>
              <span>
                <code>{api.path}</code>
                <small>{api.summary}</small>
              </span>
              <span>
                <span className="progress">
                  <i style={{ width: `${api.coverage}%` }} />
                </span>
                <small>{api.coverage}%</small>
              </span>
              <strong>{api.cases}</strong>
              <button className="icon-button" type="button" aria-label={`查看 ${api.path}`}>
                <Eye size={18} />
              </button>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function CasesView({ cases, onGenerate }: { cases: TestCase[]; onGenerate: () => void }) {
  return (
    <main className="page-view">
      <div className="page-intro">
        <div>
          <span className="eyebrow">TEST CASES</span>
          <h2>测试用例</h2>
          <p>由契约、AI Agent 和人工共同维护的可信测试资产。</p>
        </div>
        <button className="button button--primary" type="button" onClick={onGenerate}>
          <Sparkle size={18} weight="fill" />从 OpenAPI 生成
        </button>
      </div>
      <section className="table-panel">
        <div className="case-summary">
          <span>
            <strong>{cases.length}</strong> 条用例
          </span>
          <span>
            <i className="dot dot--success" />{' '}
            {cases.filter((item) => item.status === '已发布').length} 已发布
          </span>
          <span>
            <i className="dot dot--warning" />{' '}
            {cases.filter((item) => item.status === '待审核').length} 待审核
          </span>
        </div>
        <div className="data-table cases-table">
          <div className="data-row data-row--head">
            <span>用例名称</span>
            <span>来源</span>
            <span>状态</span>
            <span>最近执行</span>
            <span>操作</span>
          </div>
          {cases.map((test) => (
            <div className="data-row" key={test.id}>
              <span>
                <strong>{test.name}</strong>
                <code>{test.endpoint}</code>
              </span>
              <span className="source-tag">
                {test.source === 'AI Agent' ? <Robot size={15} /> : <FileCode size={15} />}{' '}
                {test.source}
              </span>
              <span
                className={
                  test.status === '已发布'
                    ? 'status-badge status-badge--passed'
                    : 'status-badge status-badge--warning'
                }
              >
                {test.status}
              </span>
              <span>{test.lastRun}</span>
              <button className="icon-button" type="button" aria-label={`编辑 ${test.name}`}>
                <PencilSimple size={17} />
              </button>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function ReportsView({ onRerun }: { onRerun: () => void }) {
  return (
    <main className="page-view report-view">
      <div className="page-intro report-intro">
        <div>
          <span className="eyebrow">RUN #ST-20260621-042</span>
          <h2>执行详情</h2>
          <p>创建订单业务流程 · 测试环境 · 手动触发</p>
        </div>
        <div className="report-stats">
          <span>
            <CheckCircle size={22} weight="fill" />4<small>通过</small>
          </span>
          <span>
            <XCircle size={22} weight="fill" />1<small>失败</small>
          </span>
          <span>
            <Clock size={22} />
            18.4s<small>持续时间</small>
          </span>
          <button className="button button--danger" type="button" onClick={onRerun}>
            <ArrowsClockwise size={18} />
            重新运行
          </button>
        </div>
      </div>
      <div className="report-grid">
        <section className="paper-panel report-timeline">
          <h3>步骤 · 请求 / 响应 / 断言</h3>
          {initialSteps.map((step, index) => (
            <div
              className={`timeline-step ${index === 3 ? 'timeline-step--failed' : ''}`}
              key={step.id}
            >
              <span className="timeline-index">{index + 1}</span>
              <span className="timeline-status">
                {index === 3 ? (
                  <XCircle size={20} weight="fill" />
                ) : (
                  <CheckCircle size={20} weight="fill" />
                )}
              </span>
              <div>
                <strong>{step.name}</strong>
                <code>
                  {step.method} {step.path}
                </code>
                {index === 3 ? (
                  <div className="evidence-grid">
                    <span>
                      <small>请求证据</small>
                      <pre>{`POST /api/payments\nAuthorization: Bearer ******\n{ "amount": 199.00 }`}</pre>
                    </span>
                    <span>
                      <small>响应</small>
                      <pre>{`HTTP/1.1 400\n{ "code": "PAYMENT_FAILED" }`}</pre>
                    </span>
                    <span>
                      <small>断言失败</small>
                      <p>期望状态码 200，实际 400</p>
                    </span>
                  </div>
                ) : null}
              </div>
              <time>{[512, 320, 842, 1210, 560][index]}ms</time>
            </div>
          ))}
        </section>
        <aside className="trace-card">
          <span className="eyebrow">TRACEABILITY</span>
          <h3>可追溯信息</h3>
          {[
            [GitCommit, 'Git 提交', 'a7b3c9d · feat: 优化支付校验逻辑'],
            [FileCode, 'OpenAPI 版本', 'openapi.yaml · v2.3.1'],
            [Stack, '环境', 'staging · 华东-上海'],
            [Database, '执行机', 'runner-02 · v1.8.3'],
            [GitBranch, 'Trace ID', '4f2c1e8b9d7e4a17'],
          ].map(([Icon, label, value]) => (
            <div className="trace-row" key={String(label)}>
              <Icon size={19} />
              <span>
                <small>{String(label)}</small>
                <strong>{String(value)}</strong>
              </span>
            </div>
          ))}
        </aside>
      </div>
    </main>
  );
}

function AgentView() {
  const [repo, setRepo] = useState('github.com/sketchtest/order-service');
  const [analyzing, setAnalyzing] = useState(false);
  const [done, setDone] = useState(false);
  const analyze = async () => {
    setAnalyzing(true);
    setDone(false);
    await sleep(1300);
    setAnalyzing(false);
    setDone(true);
  };
  return (
    <main className="page-view">
      <div className="page-intro">
        <div>
          <span className="eyebrow">REPOSITORY AGENT / BETA</span>
          <h2>AI 仓库分析</h2>
          <p>从路由、DTO、鉴权和错误分支生成有证据的测试草稿。</p>
        </div>
      </div>
      <section className="agent-hero">
        <div className="agent-copy">
          <span className="agent-mark">
            <Robot size={38} weight="duotone" />
          </span>
          <h3>让代码自己交代测试线索</h3>
          <p>
            只读扫描指定分支。每条建议都关联文件位置、提交版本和置信度，未经审核不会进入正式测试集。
          </p>
          <label>
            Git 仓库地址
            <div className="repo-input">
              <GitBranch size={19} />
              <input value={repo} onChange={(event) => setRepo(event.target.value)} />
              <button
                className="button button--primary"
                type="button"
                onClick={analyze}
                disabled={analyzing}
              >
                {analyzing ? <Lightning className="spin" size={17} /> : <Sparkle size={17} />}{' '}
                {analyzing ? '正在分析' : '开始分析'}
              </button>
            </div>
          </label>
          <div className="safety-row">
            <ShieldCheck size={18} />
            <span>只读权限</span>
            <span>凭证不进入模型</span>
            <span>人工审核发布</span>
          </div>
        </div>
        <div className="agent-sketch">
          <Robot size={72} weight="duotone" />
          <span>route → dto → service → test</span>
        </div>
      </section>
      {done ? (
        <section className="paper-panel findings-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">ANALYSIS COMPLETE</span>
              <h3>发现 3 条测试机会</h3>
            </div>
            <span className="stamp stamp--success">已验证</span>
          </div>
          {[
            ['PaymentController.ts:84', '支付余额不足分支未覆盖', '94%'],
            ['OrderDto.ts:31', 'quantity 最大值边界缺少用例', '88%'],
            ['AuthGuard.ts:52', '过期 Token 场景缺少断言', '82%'],
          ].map(([file, title, confidence]) => (
            <div className="finding-row" key={file}>
              <FileCode size={20} />
              <span>
                <code>{file}</code>
                <strong>{title}</strong>
              </span>
              <em>置信度 {confidence}</em>
              <button className="button button--outline" type="button">
                生成草稿
              </button>
            </div>
          ))}
        </section>
      ) : null}
    </main>
  );
}

function EnvironmentView() {
  const [showSecret, setShowSecret] = useState(false);
  return (
    <main className="page-view">
      <div className="page-intro">
        <div>
          <span className="eyebrow">ENVIRONMENTS</span>
          <h2>环境管理</h2>
          <p>运行配置按版本冻结，Secret 只在 Runner 内解析。</p>
        </div>
        <button className="button button--primary" type="button">
          <Plus size={18} />
          新建环境
        </button>
      </div>
      <div className="environment-grid">
        {['测试环境', '预发布环境', '生产只读'].map((name, index) => (
          <section
            className={`paper-panel env-card tone-${['brown', 'amber', 'green'][index]}`}
            key={name}
          >
            <div className="section-heading">
              <h3>{name}</h3>
              <span
                className={
                  index < 2
                    ? 'status-badge status-badge--passed'
                    : 'status-badge status-badge--warning'
                }
              >
                {index < 2 ? '可用' : '受保护'}
              </span>
            </div>
            <label>
              Base URL
              <input
                value={
                  [
                    'https://test.api.sketch.dev',
                    'https://staging.api.sketch.dev',
                    'https://api.sketch.dev',
                  ][index]
                }
                readOnly
              />
            </label>
            <label>
              API Token
              <div className="secret-field">
                <input type={showSecret ? 'text' : 'password'} value="sk_test_A7s9Kx21" readOnly />
                <button
                  type="button"
                  aria-label="显示或隐藏 Secret"
                  onClick={() => setShowSecret((value) => !value)}
                >
                  <Eye size={18} />
                </button>
              </div>
            </label>
            <small>版本 v{index + 3}.2 · 2 天前更新</small>
          </section>
        ))}
      </div>
    </main>
  );
}

// ─── Variable Helpers ─────────────────────────────────────────────

const VARIABLE_TYPE_LABEL: Record<VariableType, string> = {
  plain: '普通变量',
  secret: 'Secret',
  dataset: '数据集',
};

const VARIABLE_TYPE_ICON: Record<VariableType, ElementType> = {
  plain: BracketsCurly,
  secret: Key,
  dataset: Table,
};

const SCOPE_LABEL: Record<VariableScope, string> = {
  environment: '环境',
  workflow: '工作流',
  step: '步骤',
  secret: 'Secret',
};

// ─── Variable Dialog (Create / Edit) ──────────────────────────────

function VariableDialog({
  open,
  mode,
  variable,
  onSave,
  onClose,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  variable: Variable | null;
  onSave: (v: Variable) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [type, setType] = useState<VariableType>('plain');
  const [scope, setScope] = useState<VariableScope>('environment');
  const [sensitive, setSensitive] = useState(false);
  const [description, setDescription] = useState('');
  const [showValue, setShowValue] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && mode === 'edit' && variable) {
      setName(variable.name);
      setValue(variable.value);
      setType(variable.type);
      setScope(variable.scope);
      setSensitive(variable.sensitive);
      setDescription(variable.description);
      setShowValue(false);
      setErrors({});
    } else if (open && mode === 'create') {
      setName('');
      setValue('');
      setType('plain');
      setScope('environment');
      setSensitive(false);
      setDescription('');
      setShowValue(false);
      setErrors({});
    }
  }, [open, mode, variable]);

  useEffect(() => {
    if (open) {
      const timer = window.setTimeout(() => nameRef.current?.focus(), 80);
      return () => window.clearTimeout(timer);
    }
  }, [open]);

  if (!open) return null;

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!name.trim()) next['name'] = '变量名不能为空';
    else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name.trim()))
      next['name'] = '变量名只能包含字母、数字和下划线，且必须以字母或下划线开头';
    if (!value && type !== 'dataset') next['value'] = '变量值不能为空';
    if (type === 'secret') {
      setSensitive(true);
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    const now = new Date().toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const saved: Variable = {
      id: variable?.id ?? `var-${Date.now()}`,
      name: name.trim(),
      value,
      type,
      scope,
      sensitive,
      description: description.trim(),
      updatedAt: now,
      updatedBy: 'QA_team',
      usedIn: variable?.usedIn ?? [],
    };
    onSave(saved);
    onClose();
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="variable-dialog-title"
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">{mode === 'create' ? 'NEW VARIABLE' : 'EDIT VARIABLE'}</span>
            <h2 id="variable-dialog-title">
              {mode === 'create' ? '新建变量' : `编辑 ${variable?.name ?? ''}`}
            </h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </div>

        <div className="variable-dialog-body">
          {/* Variable name */}
          <label className="variable-field">
            <span className="field-label">
              变量名 <span className="required">*</span>
            </span>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (errors['name']) setErrors((prev) => ({ ...prev, name: '' }));
              }}
              placeholder="例如：baseUrl, accessToken"
              className={errors['name'] ? 'input--error' : ''}
              spellCheck={false}
            />
            {errors['name'] ? <span className="field-error">{errors['name']}</span> : null}
          </label>

          {/* Variable value */}
          <label className="variable-field">
            <span className="field-label">变量值</span>
            <div className="value-input-group">
              <input
                type={sensitive && !showValue ? 'password' : 'text'}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  if (errors['value']) setErrors((prev) => ({ ...prev, value: '' }));
                }}
                placeholder={type === 'dataset' ? 'JSON 格式数据...' : '输入变量值...'}
                className={errors['value'] ? 'input--error' : ''}
                spellCheck={false}
              />
              {sensitive ? (
                <button
                  type="button"
                  className="toggle-visibility"
                  onClick={() => setShowValue((v) => !v)}
                  aria-label={showValue ? '隐藏值' : '显示值'}
                  title={showValue ? '隐藏值' : '显示值'}
                >
                  {showValue ? <EyeSlash size={17} /> : <Eye size={17} />}
                </button>
              ) : null}
            </div>
            {errors['value'] ? <span className="field-error">{errors['value']}</span> : null}
          </label>

          {/* Type & Scope row */}
          <div className="variable-field-row">
            <label className="variable-field">
              <span className="field-label">类型</span>
              <select value={type} onChange={(e) => setType(e.target.value as VariableType)}>
                <option value="plain">普通变量</option>
                <option value="secret">Secret</option>
                <option value="dataset">数据集</option>
              </select>
            </label>
            <label className="variable-field">
              <span className="field-label">作用域</span>
              <select value={scope} onChange={(e) => setScope(e.target.value as VariableScope)}>
                <option value="environment">环境</option>
                <option value="workflow">工作流</option>
                <option value="step">步骤</option>
                <option value="secret">Secret</option>
              </select>
            </label>
          </div>

          {/* Sensitive checkbox */}
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={sensitive}
              onChange={(e) => setSensitive(e.target.checked)}
              disabled={type === 'secret'}
            />
            <span>
              <strong>敏感变量</strong>
              <small>值将在日志和控制台中自动脱敏，运行时不落盘。</small>
            </span>
          </label>

          {/* Description */}
          <label className="variable-field">
            <span className="field-label">描述</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="变量的用途和注意事项..."
              rows={3}
            />
          </label>

          {/* Usage info (edit mode only) */}
          {mode === 'edit' && variable && variable.usedIn.length > 0 ? (
            <div className="variable-usage-info">
              <LinkSimple size={15} />
              <span>
                被 {variable.usedIn.length} 个流程引用：
                {variable.usedIn.map((bp) => (
                  <code key={bp}>{bp}</code>
                ))}
              </span>
            </div>
          ) : null}
        </div>

        <div className="modal-actions">
          <button className="button button--ghost" type="button" onClick={onClose}>
            取消
          </button>
          <button className="button button--primary" type="button" onClick={handleSave}>
            <Check size={17} />
            {mode === 'create' ? '创建变量' : '保存修改'}
          </button>
        </div>
      </section>
    </div>
  );
}

// ─── Delete Confirmation Dialog ─────────────────────────────────

function DeleteVariableDialog({
  open,
  variable,
  onConfirm,
  onClose,
}: {
  open: boolean;
  variable: Variable | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);
  if (!open || !variable) return null;

  const hasReferences = variable.usedIn.length > 0;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-variable-title"
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">CONFIRM DELETION</span>
            <h2 id="delete-variable-title">删除变量</h2>
          </div>
          <button
            className="icon-button"
            ref={cancelRef}
            type="button"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={20} />
          </button>
        </div>

        <div className="delete-confirm-body">
          <Warning size={36} weight="duotone" className="delete-warn-icon" />
          <p>
            确定要删除变量 <code>{variable.name}</code> 吗？此操作不可撤销。
          </p>
          {hasReferences ? (
            <div className="notice notice--warning">
              <Info size={18} />
              <span>
                <strong>该变量仍被 {variable.usedIn.length} 个流程引用</strong>
                <small>
                  {variable.usedIn.join('、')}
                  。删除后这些流程将无法解析该变量引用。
                </small>
              </span>
            </div>
          ) : null}
        </div>

        <div className="modal-actions">
          <button className="button button--ghost" type="button" onClick={onClose}>
            取消
          </button>
          <button className="button button--danger" type="button" onClick={onConfirm}>
            <TrashSimple size={17} />
            确认删除
          </button>
        </div>
      </section>
    </div>
  );
}

// ─── Variables View ──────────────────────────────────────────────

function VariablesView({
  variables,
  onCreate,
  onUpdate,
  onDelete,
}: {
  variables: Variable[];
  onCreate: (v: Variable) => void;
  onUpdate: (v: Variable) => void;
  onDelete: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | VariableType>('all');
  const [scopeFilter, setScopeFilter] = useState<'all' | VariableScope>('all');

  // Dialog states
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create');
  const [editingVariable, setEditingVariable] = useState<Variable | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Variable | null>(null);

  const openCreate = () => {
    setDialogMode('create');
    setEditingVariable(null);
    setDialogOpen(true);
  };

  const openEdit = (v: Variable) => {
    setDialogMode('edit');
    setEditingVariable(v);
    setDialogOpen(true);
  };

  const handleSave = (v: Variable) => {
    if (dialogMode === 'create') onCreate(v);
    else onUpdate(v);
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    onDelete(deleteTarget.id);
    setDeleteTarget(null);
  };

  const filtered = variables.filter((v) => {
    const matchesQuery =
      v.name.toLowerCase().includes(query.toLowerCase()) ||
      v.description.toLowerCase().includes(query.toLowerCase()) ||
      v.value.toLowerCase().includes(query.toLowerCase());
    const matchesType = typeFilter === 'all' || v.type === typeFilter;
    const matchesScope = scopeFilter === 'all' || v.scope === scopeFilter;
    return matchesQuery && matchesType && matchesScope;
  });

  const typeCounts = {
    all: variables.length,
    plain: variables.filter((v) => v.type === 'plain').length,
    secret: variables.filter((v) => v.type === 'secret').length,
    dataset: variables.filter((v) => v.type === 'dataset').length,
  };

  return (
    <main className="page-view">
      <VariableDialog
        open={dialogOpen}
        mode={dialogMode}
        variable={editingVariable}
        onSave={handleSave}
        onClose={() => setDialogOpen(false)}
      />
      <DeleteVariableDialog
        open={deleteTarget !== null}
        variable={deleteTarget}
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />

      <div className="page-intro">
        <div>
          <span className="eyebrow">VARIABLES</span>
          <h2>变量管理</h2>
          <p>
            管理普通变量、数据集与 Secret 引用，支持按环境和流程作用域隔离。 共 {variables.length}{' '}
            个变量。
          </p>
        </div>
        <button className="button button--primary" type="button" onClick={openCreate}>
          <Plus size={18} />
          新建变量
        </button>
      </div>

      {/* Filter bar */}
      <div className="variable-filter-bar">
        <div className="filter-tabs">
          {(
            [
              ['all', '全部'],
              ['plain', '普通变量'],
              ['secret', 'Secret'],
              ['dataset', '数据集'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`filter-tab ${typeFilter === key ? 'filter-tab--active' : ''}`}
              onClick={() => setTypeFilter(key)}
            >
              {label}
              <span className="filter-count">({typeCounts[key]})</span>
            </button>
          ))}
        </div>
        <span className="toolbar-spacer" />
        <label className="search-field" style={{ minWidth: 200 }}>
          <MagnifyingGlass size={16} />
          <span className="sr-only">搜索变量</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索变量名、值或描述"
          />
        </label>
        <label className="select-wrap">
          <span className="sr-only">作用域筛选</span>
          <select
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value as 'all' | VariableScope)}
          >
            <option value="all">全部作用域</option>
            <option value="environment">环境</option>
            <option value="workflow">工作流</option>
            <option value="step">步骤</option>
            <option value="secret">Secret</option>
          </select>
          <CaretDown size={15} aria-hidden />
        </label>
      </div>

      {/* Main table */}
      <section className="table-panel">
        <div className="data-table variables-table">
          <div className="data-row data-row--head">
            <span>变量名</span>
            <span>类型</span>
            <span>作用域</span>
            <span>值</span>
            <span>描述</span>
            <span>引用</span>
            <span>最近更新</span>
            <span>操作</span>
          </div>
          {filtered.length === 0 ? (
            <div className="empty-module" style={{ border: 'none', minHeight: 240 }}>
              <BracketsCurly size={42} weight="duotone" />
              <h3>
                {query || typeFilter !== 'all' || scopeFilter !== 'all'
                  ? '没有匹配的变量'
                  : '暂无变量'}
              </h3>
              <p>
                {query || typeFilter !== 'all' || scopeFilter !== 'all'
                  ? '试试调整搜索条件或筛选器。'
                  : '点击右上角"新建变量"创建第一个变量。'}
              </p>
            </div>
          ) : (
            filtered.map((v) => {
              const TypeIcon = VARIABLE_TYPE_ICON[v.type];
              return (
                <div className="data-row" key={v.id}>
                  <span>
                    <code className="variable-name-code">{v.name}</code>
                    {v.sensitive ? (
                      <span className="sensitive-dot" title="敏感变量，日志中自动脱敏">
                        <EyeSlash size={11} weight="fill" />
                      </span>
                    ) : null}
                  </span>
                  <span className="source-tag">
                    <TypeIcon size={14} /> {VARIABLE_TYPE_LABEL[v.type]}
                  </span>
                  <span>
                    <span className={`scope-badge scope-badge--${v.scope}`}>
                      {SCOPE_LABEL[v.scope]}
                    </span>
                  </span>
                  <span className="variable-value-cell">
                    <code className={v.sensitive ? 'value-masked' : ''}>
                      {v.sensitive ? '••••••••••••' : v.value}
                    </code>
                  </span>
                  <span className="variable-desc-cell" title={v.description}>
                    {v.description}
                  </span>
                  <span>
                    {v.usedIn.length > 0 ? (
                      <span className="usage-count" title={v.usedIn.join('、')}>
                        <LinkSimple size={12} /> {v.usedIn.length}
                      </span>
                    ) : (
                      <span className="usage-count usage-count--none">—</span>
                    )}
                  </span>
                  <span className="variable-time-cell">{v.updatedAt}</span>
                  <span className="variable-actions-cell">
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => openEdit(v)}
                      aria-label={`编辑 ${v.name}`}
                      title="编辑"
                    >
                      <PencilSimple size={16} />
                    </button>
                    <button
                      className="icon-button icon-button--danger"
                      type="button"
                      onClick={() => setDeleteTarget(v)}
                      aria-label={`删除 ${v.name}`}
                      title="删除"
                    >
                      <TrashSimple size={16} />
                    </button>
                  </span>
                </div>
              );
            })
          )}
        </div>
      </section>
    </main>
  );
}

function GenericView({ view }: { view: ViewId }) {
  const details: Partial<Record<ViewId, [string, string, ElementType]>> = {
    projects: ['项目管理', '集中管理服务、成员与质量目标。', Folders],
    plans: ['测试计划', '组合用例与流程，形成 CI 质量门禁。', CalendarCheck],
    team: ['团队管理', '配置成员、角色和最小权限。', UsersThree],
    trash: ['回收站', '保留已归档资产并支持审计恢复。', Trash],
  };
  const [title, description, Icon] = details[view] ?? [
    viewLabels[view],
    '该模块正在准备。',
    DotsNine,
  ];
  return (
    <main className="page-view">
      <div className="page-intro">
        <div>
          <span className="eyebrow">SKETCHTEST MODULE</span>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <button className="button button--primary" type="button">
          <Plus size={18} />
          新建
        </button>
      </div>
      <section className="empty-module">
        <Icon size={58} weight="duotone" />
        <h3>{title}已接入统一资产模型</h3>
        <p>此 MVP 已完成信息架构与主要操作入口，后续数据将通过控制面模块接入。</p>
        <button className="button button--outline" type="button">
          查看模块设计
        </button>
      </section>
    </main>
  );
}

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

  const filtered = catalog.filter((ep) =>
    `${ep.method} ${ep.path} ${ep.summary}`.toLowerCase().includes(query.toLowerCase()),
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
                    {ep.coverage > 0 ? (
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

function ImportDialog({
  open,
  onClose,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  onImport: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [source, setSource] = useState<'file' | 'url'>('file');
  const [url, setUrl] = useState('https://example.com/openapi.yaml');
  useEffect(() => {
    if (open) closeButtonRef.current?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div className="modal-heading">
          <div>
            <span className="eyebrow">API SOURCE</span>
            <h2 id="import-title">导入 OpenAPI</h2>
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
        <div className="segmented">
          <button
            type="button"
            className={source === 'file' ? 'active' : ''}
            onClick={() => setSource('file')}
          >
            <FileArrowUp size={17} />
            上传文件
          </button>
          <button
            type="button"
            className={source === 'url' ? 'active' : ''}
            onClick={() => setSource('url')}
          >
            <PlugsConnected size={17} />
            远程 URL
          </button>
        </div>
        {source === 'file' ? (
          <label className="drop-zone">
            <input type="file" accept=".yaml,.yml,.json" />
            <FileArrowUp size={36} weight="duotone" />
            <strong>拖入 YAML 或 JSON 文件</strong>
            <span>支持 OpenAPI 2.0 / 3.0 / 3.1，最大 10 MB</span>
          </label>
        ) : (
          <label className="modal-field">
            文档地址
            <input value={url} onChange={(event) => setUrl(event.target.value)} />
          </label>
        )}
        <div className="import-preview">
          <CheckCircle size={20} weight="fill" />
          <span>
            <strong>导入后自动生成</strong>接口目录、Schema、正向/负向/边界测试草稿
          </span>
        </div>
        <div className="modal-actions">
          <button className="button button--ghost" type="button" onClick={onClose}>
            取消
          </button>
          <button className="button button--primary" type="button" onClick={onImport}>
            <UploadSimple size={17} />
            校验并导入
          </button>
        </div>
      </section>
    </div>
  );
}

export function App() {
  const [view, setView] = useState<ViewId>('workflows');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [steps, setSteps] = useState<WorkflowStep[]>(initialSteps);
  const [selectedId, setSelectedId] = useState(initialSteps[2].id);
  const [logs, setLogs] = useState<ExecutionLog[]>(initialLogs);
  const [runState, setRunState] = useState<RunState>('idle');
  const [environment, setEnvironment] = useState('测试环境');
  const [importOpen, setImportOpen] = useState(false);
  const [imported, setImported] = useState(false);
  const [cases, setCases] = useState(initialCases);
  const [variables, setVariables] = useState<Variable[]>(initialVariables);
  const [toast, setToast] = useState('');
  const runningRef = useRef(false);

  const activeWorkflow = workflows.find((wf) => wf.id === activeWorkflowId) ?? null;
  const isCanvas = view === 'workflows' && activeWorkflowId !== null;

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2400);
  }, []);

  const openWorkflow = useCallback((workflowId: string) => {
    const wf = workflows.find((w) => w.id === workflowId);
    if (!wf) return;
    const wfSteps = workflowStepsMap[workflowId] ?? initialSteps;
    setActiveWorkflowId(workflowId);
    setSteps(wfSteps);
    setSelectedId(wfSteps[0].id);
    setLogs(makeLogs(wfSteps));
    setRunState('idle');
  }, []);

  const backToList = useCallback(() => {
    setActiveWorkflowId(null);
    setRunState('idle');
  }, []);

  const saveDraft = useCallback(() => {
    localStorage.setItem('sketchtest.workflow', JSON.stringify(steps));
    localStorage.setItem('sketchtest.activeWorkflow', activeWorkflowId ?? '');
    notify('草稿已保存 · 版本 v1.0.1');
  }, [steps, activeWorkflowId, notify]);

  const runWorkflow = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    if (!activeWorkflowId) {
      setView('workflows');
    }
    setRunState('running');
    const currentSteps = steps;
    setLogs((prev) => prev.map((log) => ({ ...log, status: 'queued' })));
    for (let index = 0; index < currentSteps.length; index += 1) {
      const step = currentSteps[index];
      setSelectedId(step.id);
      setLogs((current) =>
        current.map((log) =>
          log.stepId === step.id
            ? {
                ...log,
                status: 'running',
                timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
              }
            : log,
        ),
      );
      await sleep(520 + index * 90);
      const failed = index === currentSteps.length - 1;
      setLogs((current) =>
        current.map((log) =>
          log.stepId === step.id
            ? {
                ...log,
                status: failed ? 'failed' : 'passed',
                code: 200,
                duration: [320, 280, 310, 450, 210][index] ?? 280,
                message: failed ? '断言失败：订单状态仍为“待支付”' : '',
              }
            : log,
        ),
      );
    }
    setRunState('failed');
    runningRef.current = false;
    notify(`流程执行完成 · ${currentSteps.length - 1} 通过 / 1 失败`);
  }, [steps, activeWorkflowId, notify]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveDraft();
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void runWorkflow();
      }
      if (event.key === 'Escape') {
        if (isCanvas) {
          backToList();
        } else {
          setImportOpen(false);
          setSidebarOpen(false);
        }
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [saveDraft, runWorkflow, isCanvas, backToList]);

  const navigate = (next: ViewId) => {
    startTransition(() => {
      if (next === 'workflows' && view === 'workflows' && activeWorkflowId) {
        // Clicking the "业务流程" nav while on canvas → go back to list
        backToList();
      }
      setView(next);
      if (next !== 'workflows') setActiveWorkflowId(null);
    });
    setSidebarOpen(false);
  };
  const importApi = () => {
    setImported(true);
    setImportOpen(false);
    setView('apis');
    notify('OpenAPI 导入成功 · 已创建 6 个接口资产');
  };
  const generateCases = () => {
    const generated: TestCase[] = [
      {
        id: `g-${Date.now()}`,
        name: '支付订单 · 非法金额',
        endpoint: 'POST /api/payments',
        source: 'OpenAPI',
        status: '待审核',
        lastRun: '尚未运行',
      },
      {
        id: `g-${Date.now() + 1}`,
        name: '查询订单 · 不存在资源',
        endpoint: 'GET /api/orders/{id}',
        source: 'OpenAPI',
        status: '待审核',
        lastRun: '尚未运行',
      },
    ];
    setCases((current) => [...generated, ...current]);
    notify('已生成 2 条测试草稿 · 等待审核');
  };

  const topbarTitle = isCanvas ? `业务流程 · ${activeWorkflow?.name ?? '编排'}` : viewLabels[view];

  let content: React.ReactNode;
  if (view === 'workflows' && isCanvas) {
    content = (
      <WorkflowWorkspace
        steps={steps}
        setSteps={setSteps}
        selectedId={selectedId}
        setSelectedId={setSelectedId}
        logs={logs}
        workflowName={activeWorkflow?.name ?? '业务流程'}
        onBack={backToList}
      />
    );
  } else if (view === 'workflows') {
    content = <WorkflowListView onSelect={openWorkflow} />;
  } else if (view === 'overview')
    content = (
      <OverviewView
        onNavigate={navigate}
        onImport={() => setImportOpen(true)}
        onOpenWorkflow={openWorkflow}
      />
    );
  else if (view === 'apis')
    content = <ApiView onImport={() => setImportOpen(true)} imported={imported} />;
  else if (view === 'cases') content = <CasesView cases={cases} onGenerate={generateCases} />;
  else if (view === 'reports') content = <ReportsView onRerun={() => void runWorkflow()} />;
  else if (view === 'agent') content = <AgentView />;
  else if (view === 'environments') content = <EnvironmentView />;
  else if (view === 'variables')
    content = (
      <VariablesView
        variables={variables}
        onCreate={(v) =>
          setVariables((prev) => {
            const next = [v, ...prev];
            localStorage.setItem('sketchtest.variables', JSON.stringify(next));
            notify(`变量 "${v.name}" 已创建`);
            return next;
          })
        }
        onUpdate={(v) =>
          setVariables((prev) => {
            const next = prev.map((x) => (x.id === v.id ? v : x));
            localStorage.setItem('sketchtest.variables', JSON.stringify(next));
            notify(`变量 "${v.name}" 已更新`);
            return next;
          })
        }
        onDelete={(id) =>
          setVariables((prev) => {
            const target = prev.find((x) => x.id === id);
            const next = prev.filter((x) => x.id !== id);
            localStorage.setItem('sketchtest.variables', JSON.stringify(next));
            if (target) notify(`变量 "${target.name}" 已删除`);
            return next;
          })
        }
      />
    );
  else content = <GenericView view={view} />;

  return (
    <div className="app-shell">
      <Sidebar
        activeView={view}
        open={sidebarOpen}
        onNavigate={navigate}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="app-main">
        <Topbar
          title={topbarTitle}
          runState={runState}
          onMenu={() => setSidebarOpen(true)}
          onSave={saveDraft}
          onRun={() => void runWorkflow()}
          onImport={() => setImportOpen(true)}
          environment={environment}
          onEnvironment={setEnvironment}
        />
        {content}
      </div>
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImport={importApi} />
      <div className={`toast ${toast ? 'toast--visible' : ''}`} role="status" aria-live="polite">
        <CheckCircle size={18} weight="fill" />
        {toast}
      </div>
    </div>
  );
}
