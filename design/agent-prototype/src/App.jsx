import {
  ArrowRight,
  BracketsCurly,
  CalendarCheck,
  CaretDown,
  CaretRight,
  ChartBar,
  Check,
  CheckCircle,
  ClipboardText,
  Copy,
  Cube,
  FileArrowUp,
  FileText,
  FlowArrow,
  GearSix,
  House,
  Info,
  LinkSimple,
  List,
  Lock,
  MagnifyingGlass,
  MapTrifold,
  PencilSimple,
  Play,
  PlugsConnected,
  Plus,
  Robot,
  SpinnerGap,
  Stack,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';
import { baseDefinition, catalog, names, useStore } from './store';

const nav = [
  ['工作台', House],
  ['能力地图', MapTrifold],
  ['业务流程', FlowArrow],
  ['接口管理', PlugsConnected],
  ['导入中心', FileArrowUp],
  ['用例管理', ClipboardText, 'cases'],
  ['测试计划', CalendarCheck],
  ['环境管理', Stack],
  ['变量管理', BracketsCurly],
  ['报告中心', ChartBar],
  ['智能生成', Robot, 'generation'],
];
const pageInfo = {
  agents: ['工作区设置', 'Agent 管理', '管理团队的 AI 角色、模型和连接'],
  generation: ['AI 辅助创作', '智能生成', '从接口依据生成可审核的用例草稿'],
  cases: ['回归测试', '用例管理', '查看用例定义、版本与来源'],
};
function Button({ children, primary, className = '', ...props }) {
  return (
    <button className={`button ${primary ? 'primary' : ''} ${className}`} {...props}>
      {children}
    </button>
  );
}
function Badge({ children, tone = 'green' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function AgentAvatar({ agent, size = 40 }) {
  const avatar = ['contract', 'language', 'plan'].includes(agent?.avatar)
    ? agent.avatar
    : 'contract';
  return (
    <img
      className="agent-avatar"
      src={`/avatars/${avatar}.png`}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
    />
  );
}
function CopyButton({ value }) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={`复制 ${value}`}
      onClick={() => {
        navigator.clipboard
          .writeText(value)
          .then(() => useStore.getState().notify('已复制'))
          .catch(() => useStore.getState().notify(`请复制：${value}`));
      }}
    >
      <Copy size={15} />
    </button>
  );
}
function Modal({ title, children, onClose, wide, drawer }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      previous?.focus?.({ preventScroll: true });
    };
  }, []);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Native dialog handles Escape through onCancel and provides a keyboard-accessible close button.
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`dialog ${wide ? 'wide' : ''} ${drawer ? 'drawer' : ''}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-inner">
        <header className="dialog-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" onClick={onClose} className="icon-button" aria-label="关闭弹窗">
            <X size={23} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
export function App() {
  const s = useStore();
  const [mobileNav, setMobileNav] = useState(false);
  const [trace, setTrace] = useState(null);
  const [source, setSource] = useState(false);
  const title = pageInfo[s.page];
  const navigate = (page) => {
    s.navigate(page);
    setMobileNav(false);
  };
  return (
    <div className="app-shell">
      {mobileNav && (
        <button
          type="button"
          className="nav-shade"
          aria-label="关闭导航"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">
            <Cube size={28} />
          </span>
          <div>
            <strong>SketchTest</strong>
            <small>API 自动化测试平台</small>
          </div>
        </div>
        <nav aria-label="主导航">
          {nav.map(([label, Icon, page]) => (
            <button
              type="button"
              key={label}
              disabled={!page}
              title={!page ? '此原型聚焦 Agent 与用例流程' : undefined}
              className={`nav-item ${s.page === page ? 'active' : ''}`}
              onClick={() => navigate(page)}
            >
              <Icon size={20} />
              <span>{label}</span>
              {page === 'cases' && s.drafts.some((d) => d.status === 'pending') && (
                <span className="nav-count">
                  {s.drafts.filter((d) => d.status === 'pending').length}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="settings-nav">
          <small>设置</small>
          <button
            type="button"
            className={`nav-item ${s.page === 'agents' ? 'active' : ''}`}
            onClick={() => navigate('agents')}
          >
            <GearSix size={20} />
            Agent 管理
          </button>
        </div>
      </aside>
      <div className="app-content">
        <header className="topbar">
          <button
            type="button"
            className="icon-button mobile-toggle"
            aria-label="打开导航"
            onClick={() => setMobileNav(true)}
          >
            <List size={24} />
          </button>
          <div className="topbar-title">
            <small>{title[0]}</small>
            <div>
              <h1>{title[1]}</h1>
              <span>{title[2]}</span>
            </div>
          </div>
          <div className="demo-label">
            <span className="demo-dot" />
            交互原型 · 示例数据
          </div>
          <div className="avatar" title="演示用户">
            林
          </div>
        </header>
        <main>
          {s.page === 'agents' ? (
            <Agents />
          ) : s.page === 'generation' ? (
            <Generation onTrace={setTrace} onSource={() => setSource(true)} />
          ) : (
            <Cases onTrace={setTrace} onSource={() => setSource(true)} />
          )}
        </main>
      </div>
      {s.toast && (
        <div className="toast" role="status">
          <CheckCircle size={20} />
          {s.toast}
        </div>
      )}
      {trace && (
        <TraceDrawer
          id={trace.id || trace}
          caseName={trace.caseName}
          onClose={() => setTrace(null)}
        />
      )}
      {source && (
        <Modal title="接口依据" onClose={() => setSource(false)}>
          <Badge tone="blue">ApiVersion v12</Badge>
          <h3 className="source-title">
            <span className="method">POST</span> /orders
          </h3>
          <p>订单 API 的已发布接口契约。当前原型使用固定的示例来源。</p>
          <dl className="facts">
            <dt>必填字段</dt>
            <dd>sku · quantity</dd>
            <dt>成功响应</dt>
            <dd>201 · id、status</dd>
            <dt>异常响应</dt>
            <dd>400 / 409</dd>
            <dt>版本标识</dt>
            <dd>av_orders_12</dd>
          </dl>
          <div className="note">
            <Lock size={17} />
            执行记录绑定此版本，后续接口更新不会改写历史依据。
          </div>
        </Modal>
      )}
    </div>
  );
}
function Agents() {
  const s = useStore();
  const [tab, setTab] = useState('agents');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [history, setHistory] = useState(false);
  const agent = s.agents.find((a) => a.id === s.selectedAgent) || s.agents[0];
  return (
    <section className="management paper">
      <div className="tabs">
        <button
          type="button"
          className={tab === 'agents' ? 'selected' : ''}
          onClick={() => setTab('agents')}
        >
          Agent 配置
        </button>
        <button
          type="button"
          className={tab === 'connections' ? 'selected' : ''}
          onClick={() => setTab('connections')}
        >
          厂商连接
        </button>
      </div>
      {tab === 'connections' ? (
        <Connections />
      ) : (
        <div className="management-columns">
          <aside className="agent-list">
            <div className="section-heading">
              <h3>
                团队 Agent <span className="muted">({s.agents.length})</span>
              </h3>
              <Button primary className="small" onClick={() => setCreating(true)}>
                <Plus size={16} />
                新建 Agent
              </Button>
            </div>
            <div className="search">
              <MagnifyingGlass size={18} />
              <input
                aria-label="搜索 Agent"
                placeholder="搜索 Agent 名称"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="agent-rows">
              {s.agents
                .filter((a) => a.name.toLowerCase().includes(query.toLowerCase()))
                .map((a) => (
                  <button
                    type="button"
                    key={a.id}
                    className={`agent-row ${a.id === agent.id ? 'selected' : ''}`}
                    onClick={() => s.selectAgent(a.id)}
                  >
                    <AgentAvatar agent={a} size={56} />
                    <div className="agent-row-copy">
                      <div className="agent-row-name">
                        <strong>{a.name}</strong>
                        <Badge tone={a.enabled ? 'green' : 'gray'}>
                          {a.enabled ? '已启用' : '已停用'}
                        </Badge>
                      </div>
                      <span>
                        {a.provider} · {a.model}
                      </span>
                      <small>
                        {a.default ? '默认用于' : '用于'}
                        {a.capability}
                      </small>
                    </div>
                    <span className="agent-row-version">v{a.version}</span>
                    <CaretRight className="row-arrow" size={18} />
                  </button>
                ))}
              {!s.agents.some((a) => a.name.toLowerCase().includes(query.toLowerCase())) && (
                <div className="empty">
                  没有找到 Agent
                  <br />
                  <button type="button" className="text-button" onClick={() => setQuery('')}>
                    清除搜索
                  </button>
                </div>
              )}
            </div>
            <div className="list-footnote">
              <Info size={15} />
              Agent 配置供各业务功能选择使用
            </div>
          </aside>
          <AgentEditor
            key={`${agent.id}:${agent.version}`}
            agent={agent}
            onHistory={() => setHistory(true)}
          />
        </div>
      )}
      {creating && (
        <Modal title="新建 Agent" wide onClose={() => setCreating(false)}>
          <AgentEditor key="new" agent={null} onDone={() => setCreating(false)} />
        </Modal>
      )}
      {history && (
        <Modal title={`${agent.name} · 配置版本`} onClose={() => setHistory(false)}>
          <p className="muted">仅展示原型中已保存的版本。历史执行引用对应的版本快照。</p>
          {[...(s.versions[agent.id] || [])].reverse().map((v) => (
            <div className="version-row" key={v.version}>
              <Badge tone="brown">v{v.version}</Badge>
              <div>
                <strong>
                  {v.provider} / {v.model}
                </strong>
                <p>{v.role}</p>
              </div>
              <Lock size={16} />
            </div>
          ))}
        </Modal>
      )}
    </section>
  );
}
function AgentEditor({ agent, onHistory, onDone }) {
  const s = useStore();
  const [form, setForm] = useState(
    agent
      ? { ...agent }
      : {
          name: '',
          avatar: ['contract', 'language', 'plan'][s.agents.length % 3],
          provider: 'OpenAI',
          model: 'gpt-5.6',
          connection: 'conn_openai',
          role: '',
          capability: '用例生成',
          enabled: true,
          timeout: 60,
          retries: 2,
        },
  );
  const [advanced, setAdvanced] = useState(false);
  const [testing, setTesting] = useState(false);
  const [verified, setVerified] = useState(false);
  const update = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setVerified(false);
  };
  const connections = s.connections.filter((c) => c.provider === form.provider);
  const changeProvider = (provider) =>
    setForm((f) => ({
      ...f,
      provider,
      model: catalog[provider][0],
      connection: s.connections.find((c) => c.provider === provider)?.id || '',
    }));
  const changed = !agent || JSON.stringify(form) !== JSON.stringify(agent);
  const submit = (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.role.trim() || !form.connection) return;
    s.saveAgent({
      ...form,
      name: form.name.trim(),
      role: form.role.trim(),
      id: agent?.id || `ag_custom_${Date.now()}`,
    });
    onDone?.();
  };
  return (
    <form className="agent-editor" onSubmit={submit}>
      <div className="agent-path mono">/ agents / {agent?.id || 'new'}</div>
      <div className="editor-heading">
        <AgentAvatar agent={form} size={88} />
        <div className="editor-identity">
          <div className="editor-title">
            <h2>{agent?.name || '定义一个新的 Agent'}</h2>
            <button
              type="button"
              className={`switch ${form.enabled ? 'on' : ''}`}
              role="switch"
              aria-checked={form.enabled}
              aria-label="启用 Agent"
              onClick={() => update('enabled', !form.enabled)}
            >
              <span />
            </button>
            <span className="muted">{form.enabled ? '已启用' : '已停用'}</span>
          </div>
          <p className="agent-handle mono">
            {agent?.id || 'new_agent'} <span>_</span>
          </p>
        </div>
        {agent && (
          <div className="version-actions">
            <Badge>当前 v{agent.version}</Badge>
            <button className="text-button" type="button" onClick={onHistory}>
              历史版本
            </button>
          </div>
        )}
      </div>
      <section className="form-section">
        <h3>基本信息</h3>
        <div className="form-grid">
          <label>
            Agent 名称 <em>*</em>
            <input
              required
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder="例如：契约用例 Agent"
              maxLength={50}
            />
          </label>
          <label>
            适用功能
            <select value={form.capability} onChange={(e) => update('capability', e.target.value)}>
              <option>用例生成</option>
              <option>测试计划</option>
            </select>
          </label>
        </div>
      </section>
      <section className="form-section">
        <h3>模型连接</h3>
        <div className="form-grid">
          <label>
            厂商 <em>*</em>
            <select value={form.provider} onChange={(e) => changeProvider(e.target.value)}>
              {Object.keys(catalog).map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            模型 <em>*</em>
            <select value={form.model} onChange={(e) => update('model', e.target.value)}>
              {catalog[form.provider].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="connection-label">
          连接 <em>*</em>
          <div className="connection-control">
            <select
              required
              value={form.connection}
              onChange={(e) => update('connection', e.target.value)}
            >
              <option value="" disabled>
                请选择厂商连接
              </option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.status}
                </option>
              ))}
            </select>
            <Button
              type="button"
              disabled={!form.connection || testing}
              onClick={() => {
                setTesting(true);
                setTimeout(() => {
                  setTesting(false);
                  setVerified(true);
                }, 650);
              }}
            >
              {testing ? <SpinnerGap className="spin" /> : verified ? <Check size={16} /> : null}
              {testing ? '验证中' : verified ? '验证通过' : '测试连接'}
            </Button>
          </div>
        </label>
        <small className="muted">
          {connections.length
            ? verified
              ? '演示连接验证成功；未向真实厂商发送请求。'
              : '连接凭据由工作区安全保存。原型模型与连接均为示例。'
            : '请先在「厂商连接」中添加此厂商的连接。'}
        </small>
      </section>
      <section className="form-section behavior">
        <h3>行为配置</h3>
        <label>
          职责说明 <em>*</em>
          <textarea
            required
            value={form.role}
            onChange={(e) => update('role', e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="描述该 Agent 的任务范围与输出要求"
          />
        </label>
        <div className="char-count">{form.role.length}/500</div>
        <button
          type="button"
          className="advanced-toggle"
          aria-expanded={advanced}
          onClick={() => setAdvanced(!advanced)}
        >
          {advanced ? <CaretDown /> : <CaretRight />}高级参数 · 超时、重试、输出限制
        </button>
        {advanced && (
          <div className="advanced">
            <div className="form-grid">
              <label>
                超时（秒）
                <input
                  type="number"
                  required
                  min={10}
                  max={300}
                  value={form.timeout}
                  onChange={(e) => update('timeout', Number(e.target.value))}
                />
              </label>
              <label>
                最大重试次数
                <input
                  type="number"
                  required
                  min={0}
                  max={5}
                  value={form.retries}
                  onChange={(e) => update('retries', Number(e.target.value))}
                />
              </label>
            </div>
            <div className="note">
              <Info size={17} />
              失败时不自动切换模型；生成结果进入待审核草稿。
            </div>
          </div>
        )}
      </section>
      <footer className="editor-footer">
        <small>保存后生成新版本，历史执行继续保留原配置。</small>
        <div>
          <Button
            type="button"
            onClick={() => (agent ? (setForm({ ...agent }), setVerified(false)) : onDone?.())}
          >
            取消
          </Button>
          <Button primary type="submit" disabled={!changed || !form.connection}>
            保存为 v{agent ? agent.version + 1 : 1}
          </Button>
        </div>
      </footer>
    </form>
  );
}
function Connections() {
  const s = useStore();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [provider, setProvider] = useState('OpenAI');
  const [reference, setReference] = useState('');
  return (
    <div className="connections">
      <div className="section-heading">
        <div>
          <h2>厂商连接</h2>
          <p className="muted">一个连接可供多个 Agent 复用，模型与职责分别配置。</p>
        </div>
        <Button primary onClick={() => setAdding(true)}>
          <Plus />
          添加连接
        </Button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>连接名称</th>
              <th>厂商</th>
              <th>凭据</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {s.connections.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.name}</strong>
                </td>
                <td>{c.provider}</td>
                <td>
                  <Lock size={15} /> 安全引用
                </td>
                <td>
                  <Badge>{c.status}</Badge>
                </td>
                <td>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => s.notify('演示验证成功，未调用真实厂商')}
                  >
                    测试连接
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="note">
        <Info size={18} />
        交互原型不采集 API Key。仅使用示例连接和凭据引用。
      </div>
      {adding && (
        <Modal title="添加厂商连接" onClose={() => setAdding(false)}>
          <form
            className="modal-form"
            onSubmit={(e) => {
              e.preventDefault();
              s.addConnection({
                id: `conn_${Date.now()}`,
                name,
                provider,
                status: '已验证',
                reference,
              });
              setAdding(false);
              setName('');
              setReference('');
              s.notify('示例连接已添加，可在 Agent 配置中使用');
            }}
          >
            <label>
              连接名称
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：团队智谱"
              />
            </label>
            <label>
              厂商
              <select value={provider} onChange={(e) => setProvider(e.target.value)}>
                {Object.keys(catalog).map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <label>
              凭据引用（演示）
              <input
                required
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="例如：workspace/ai/team-key"
              />
            </label>
            <p className="muted">请输入引用名称，请勿输入真实密钥。</p>
            <Button primary type="submit">
              保存示例连接
            </Button>
          </form>
        </Modal>
      )}
    </div>
  );
}
function Generation({ onTrace, onSource }) {
  const s = useStore();
  const available = s.agents.filter((a) => a.enabled && a.capability === '用例生成');
  const [agentId, setAgentId] = useState(available[0]?.id || '');
  const [objective, setObjective] = useState(
    '基于订单 API 生成正常、边界与异常用例，覆盖必填字段缺失、库存不足和订单状态非法。',
  );
  const job = s.activeGeneration;
  const agent = available.find((a) => a.id === agentId);
  const busy = job?.running;
  const stages = ['读取接口依据', '生成候选草稿', '结构校验与保存'];
  return (
    <section className="generation-page">
      <div className="breadcrumb">
        智能生成 <CaretRight size={13} /> 订单 API
      </div>
      <div className="page-heading">
        <div>
          <h2>让用例从证据开始</h2>
          <p>选择一个 Agent，将接口契约转化为可审核的测试草稿。</p>
        </div>
        <Badge tone="brown">演示模式 · 不调用真实模型</Badge>
      </div>
      <div className="generation-grid">
        <section className="paper composer">
          <div className="eyebrow">01 / 配置本次生成</div>
          <h3>订单 API · 用例生成</h3>
          <div className="source-row">
            <FileText size={23} />
            <div>
              <strong>订单 API</strong>
              <small>ApiVersion v12 · POST /orders</small>
            </div>
            <button type="button" className="text-button" onClick={onSource}>
              查看依据
            </button>
          </div>
          <label>
            执行 Agent
            <select disabled={busy} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="" disabled>
                选择 Agent
              </option>
              {available.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · v{a.version} / {a.provider} · {a.model}
                </option>
              ))}
            </select>
          </label>
          {agent ? (
            <div className="agent-summary">
              <AgentAvatar agent={agent} size={40} />
              <div>
                <strong>
                  {agent.name} <span className="muted">v{agent.version}</span>
                </strong>
                <small>
                  {agent.provider} / {agent.model}
                </small>
              </div>
              <Badge>可用</Badge>
            </div>
          ) : (
            <div className="note">
              <WarningCircle />
              没有可用的用例生成 Agent
              <button type="button" className="text-button" onClick={() => s.navigate('agents')}>
                去配置
              </button>
            </div>
          )}
          <label>
            生成目标
            <textarea
              disabled={busy}
              value={objective}
              maxLength={1000}
              onChange={(e) => setObjective(e.target.value)}
              rows={5}
            />
          </label>
          <div className="note">
            <Lock size={18} />
            开始后固定本次 Agent 配置与模型。生成结果需人工审核。
          </div>
          <div className="composer-footer">
            <button type="button" className="text-button" onClick={() => s.navigate('agents')}>
              管理 Agent <ArrowRight />
            </button>
            <Button
              primary
              disabled={!agent || !objective.trim() || busy}
              onClick={() => s.startGeneration(agentId, objective)}
            >
              {busy ? <SpinnerGap className="spin" /> : <Play weight="fill" />}
              {busy ? '正在生成' : '生成用例草稿'}
            </Button>
          </div>
        </section>
        <section className="paper runtime">
          <div className="eyebrow">02 / 观察生成过程</div>
          <h3>{!job ? '等待开始' : busy ? '正在生成草稿' : '生成完成，等待审核'}</h3>
          {!job ? (
            <div className="runtime-empty">
              <AgentAvatar agent={agent} size={72} />
              <h3>每一步都有迹可循</h3>
              <p>
                开始后在这里查看执行阶段、
                <br />
                Agent 身份与草稿产出。
              </p>
            </div>
          ) : (
            <>
              <div className="runtime-identity">
                <AgentAvatar agent={job.agent} size={40} />
                <div>
                  <strong>
                    {job.agent.name} · v{job.agent.version}
                  </strong>
                  <small>
                    {job.agent.provider} / {job.agent.model} · {job.id}
                  </small>
                </div>
                <Badge tone={busy ? 'amber' : 'green'}>{busy ? '进行中' : '已完成'}</Badge>
              </div>
              <ol className="timeline">
                {stages.map((stage, i) => (
                  <li
                    key={stage}
                    className={job.stage > i ? 'complete' : job.stage === i ? 'current' : 'waiting'}
                  >
                    <span className="timeline-marker">
                      {job.stage > i ? (
                        <Check size={16} />
                      ) : job.stage === i ? (
                        <SpinnerGap className="spin" size={16} />
                      ) : (
                        i + 1
                      )}
                    </span>
                    <div>
                      <strong>{stage}</strong>
                      <p>
                        {
                          [
                            '读取已发布的接口定义和字段约束',
                            '根据任务目标生成候选请求与断言',
                            '校验结构与来源，保存待审核草稿',
                          ][i]
                        }
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
              {busy ? (
                <div className="runtime-footer">
                  <span className="muted">正在演示生成过程…</span>
                  <button type="button" className="text-button" onClick={s.cancelGeneration}>
                    取消演示
                  </button>
                </div>
              ) : (
                <>
                  <div className="success-strip">
                    <CheckCircle size={21} />
                    <strong>6 份草稿已生成</strong>
                    <span>模拟耗时 18.4s</span>
                  </div>
                  <div className="runtime-footer">
                    <button type="button" className="text-button" onClick={() => onTrace(job.id)}>
                      查看执行详情
                    </button>
                    <Button primary onClick={() => s.navigate('cases')}>
                      审核草稿 <ArrowRight />
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>
      <section className="generation-history">
        <h3>最近的生成任务</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>任务</th>
                <th>执行 Agent</th>
                <th>实际模型</th>
                <th>产出</th>
                <th>状态</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {s.traces.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>订单 API · 用例生成</strong>
                    <small>
                      {t.id} · {t.date}
                    </small>
                  </td>
                  <td>
                    <span className="agent-inline">
                      <AgentAvatar agent={t.agent} size={26} />
                      {t.agent.name} · v{t.agent.version}
                    </span>
                  </td>
                  <td>
                    {t.agent.provider} / {t.agent.model}
                  </td>
                  <td>{t.count} 份草稿</td>
                  <td>
                    <Badge>已完成</Badge>
                  </td>
                  <td>
                    <button type="button" className="text-button" onClick={() => onTrace(t.id)}>
                      查看详情 <ArrowRight />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
function Cases({ onTrace, onSource }) {
  const s = useStore();
  const [tab, setTab] = useState('definition');
  const [editing, setEditing] = useState(false);
  const [requestText, setRequestText] = useState('');
  const [expected, setExpected] = useState('201');
  const [error, setError] = useState('');
  const [runInfo, setRunInfo] = useState(false);
  const item = s.cases.find((c) => c.id === s.selectedCase) || s.cases[0];
  const trace = s.traces.find((t) => t.id === item.traceId);
  const pending = s.drafts.filter((d) => d.status === 'pending');
  const [review, setReview] = useState(null);
  const published = item.status === 'published';
  function beginEdit() {
    setRequestText(item.definition);
    setExpected(item.expected);
    setError('');
    setEditing(true);
  }
  function saveEdit() {
    try {
      const parsed = JSON.parse(requestText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      if (!/^\d{3}$/.test(expected)) throw new Error();
      s.saveCase(item.id, JSON.stringify(parsed, null, 2), expected);
      setEditing(false);
      s.notify('用例草稿已保存；原始 AI 产出保持不变');
    } catch {
      setError('请输入有效的 JSON 对象和三位 HTTP 状态码。');
    }
  }
  return (
    <section className="cases-page">
      <div className="breadcrumb">
        <button type="button" onClick={() => s.notify('当前展示原型中的用例集合')}>
          用例管理
        </button>
        <CaretRight size={13} />
        订单 API
        <CaretRight size={13} />
        {item.name}
      </div>
      {pending.length > 0 && (
        <div className="pending-banner">
          <FileText size={21} />
          <strong>{pending.length} 份 AI 草稿等待审核</strong>
          <span>审核后接受为用例草稿，发布是独立操作。</span>
          <Button className="small" onClick={() => setReview(pending[0])}>
            开始审核 <ArrowRight />
          </Button>
        </div>
      )}
      <div className="page-heading case-heading">
        <div>
          <h2>
            {item.name}
            <Badge tone={published ? 'green' : 'amber'}>{published ? '已发布' : '用例草稿'}</Badge>
          </h2>
          <p className="mono">
            {item.id} · {published ? `TestCaseVersion v${item.version}` : '尚未发布'}
          </p>
        </div>
        <div className="heading-actions">
          {published ? (
            <>
              <Button
                onClick={() => {
                  s.editPublished(item.id);
                  setTab('definition');
                }}
              >
                <FileText />
                编辑为新草稿
              </Button>
              <Button primary onClick={() => setRunInfo(true)}>
                <Play weight="fill" />
                运行用例
              </Button>
            </>
          ) : (
            <>
              <Button onClick={beginEdit}>
                <PencilSimple />
                编辑草稿
              </Button>
              <Button primary onClick={() => s.publishCase(item.id)}>
                <Check />
                发布版本
              </Button>
            </>
          )}
        </div>
      </div>
      {s.cases.length > 1 && (
        <label className="case-picker">
          查看用例
          <select
            value={item.id}
            onChange={(e) => {
              s.selectCase(e.target.value);
              setTab('definition');
            }}
          >
            {s.cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.status === 'published' ? `已发布 v${c.version}` : '草稿'}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="tabs case-tabs">
        {[
          ['definition', '用例定义'],
          ['versions', '版本历史'],
          ['runs', '测试执行记录'],
        ].map(([id, label]) => (
          <button
            type="button"
            className={tab === id ? 'selected' : ''}
            key={id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="case-grid">
        <div className="paper case-definition">
          {tab === 'definition' ? (
            <>
              <section>
                <h3 className="accent-heading">请求</h3>
                <div className="endpoint">
                  <span className="method">POST</span>
                  <code>/orders</code>
                </div>
                <pre className="request-code">
                  <code>{item.definition}</code>
                  <CopyButton value={item.definition} />
                </pre>
              </section>
              <section>
                <h3 className="accent-heading">断言</h3>
                <table className="assertions">
                  <tbody>
                    <tr>
                      <td>1</td>
                      <td>HTTP 状态码</td>
                      <td>等于</td>
                      <td>
                        <Badge>{item.expected}</Badge>
                      </td>
                    </tr>
                    <tr>
                      <td>2</td>
                      <td>$.id</td>
                      <td>存在</td>
                      <td>
                        <Badge>存在</Badge>
                      </td>
                    </tr>
                    <tr>
                      <td>3</td>
                      <td>$.status</td>
                      <td>等于</td>
                      <td>
                        <Badge>created</Badge>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </section>
              <section>
                <h3 className="accent-heading">前置条件</h3>
                <div className="precondition">用户已登录，商品库存充足。</div>
              </section>
              <button type="button" className="source-link" onClick={onSource}>
                <LinkSimple size={19} />
                <span>
                  接口依据 · ApiVersion v12 · <b>POST /orders</b>
                </span>
              </button>
            </>
          ) : tab === 'versions' ? (
            <>
              <h3 className="accent-heading">版本历史</h3>
              <p className="muted">已发布版本不可修改。新编辑以独立草稿保留。</p>
              <Lineage item={item} trace={trace} onTrace={onTrace} />
            </>
          ) : (
            <>
              <h3 className="accent-heading">测试执行记录</h3>
              <div className="runtime-empty">
                <Play size={35} />
                <h3>还没有测试执行记录</h3>
                <p>
                  AI 生成记录位于右侧「生成来源」。
                  <br />
                  此原型不会向被测系统发送请求。
                </p>
                <Button onClick={() => setRunInfo(true)}>了解运行用例</Button>
              </div>
            </>
          )}
        </div>
        <aside className="case-context">
          <section className="paper provenance">
            <div className="section-heading">
              <h3 className="accent-heading">生成来源</h3>
              <Badge tone="amber">{item.edited ? 'AI 生成 · 人工修订' : 'AI 生成'}</Badge>
            </div>
            <dl className="facts">
              <dt>生成 Agent</dt>
              <dd className="agent-inline">
                <AgentAvatar agent={trace.agent} size={26} />
                {trace.agent.name} · v{trace.agent.version}
              </dd>
              <dt>模型厂商</dt>
              <dd>{trace.agent.provider}</dd>
              <dt>实际模型</dt>
              <dd className="mono">{trace.agent.model}</dd>
              <dt>生成时间</dt>
              <dd>{trace.date}</dd>
              <dt>生成任务</dt>
              <dd className="mono">
                {trace.id}
                <CopyButton value={trace.id} />
              </dd>
            </dl>
            <button
              type="button"
              className="provenance-action"
              onClick={() => onTrace({ id: trace.id, caseName: item.name })}
            >
              查看 Agent 执行详情 <ArrowRight size={18} />
            </button>
          </section>
          <section className="paper lineage-panel">
            <h3 className="accent-heading">版本沿革</h3>
            <Lineage item={item} trace={trace} onTrace={onTrace} />
            <div className="lineage-note">
              <Info size={17} />
              <span>
                {item.edited
                  ? '当前版本包含人工修改，生成记录保留原始产出。'
                  : '原始 AI 产出已保留，后续修改不会覆盖生成来源。'}
              </span>
            </div>
          </section>
        </aside>
      </div>
      {review && (
        <Modal title="审核 AI 生成草稿" wide onClose={() => setReview(null)}>
          <div className="section-heading">
            <h3>{review.name}</h3>
            <Badge tone="amber">待审核</Badge>
          </div>
          <p>POST /orders · 来源 ApiVersion v12</p>
          <pre className="review-code">{review.definition}</pre>
          <p>
            状态码断言：<strong>{review.expected}</strong>
          </p>
          <button
            type="button"
            className="text-button"
            onClick={() => onTrace({ id: review.traceId, caseName: review.name })}
          >
            查看 Agent 执行详情 <ArrowRight />
          </button>
          <div className="note">
            <Info />
            请核对真实业务语义。演示草稿不代表接口已通过测试。
          </div>
          <div className="modal-footer">
            <Button
              onClick={() => {
                s.reviewDraft(review.id, false);
                setReview(null);
              }}
            >
              拒绝草稿
            </Button>
            <Button
              primary
              onClick={() => {
                s.reviewDraft(review.id, true);
                setReview(null);
              }}
            >
              接受为用例草稿
            </Button>
          </div>
        </Modal>
      )}
      {editing && (
        <Modal title="编辑用例草稿" wide onClose={() => setEditing(false)}>
          <div className="modal-form">
            <label>
              请求 JSON
              <textarea
                className="mono"
                value={requestText}
                onChange={(e) => setRequestText(e.target.value)}
                rows={7}
              />
            </label>
            <label>
              预期 HTTP 状态码
              <input value={expected} onChange={(e) => setExpected(e.target.value)} />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <Button primary onClick={saveEdit}>
              保存草稿
            </Button>
          </div>
        </Modal>
      )}
      {runInfo && (
        <Modal title="运行用例" onClose={() => setRunInfo(false)}>
          <p>用例的 HTTP 执行由 Runner 完成，需要选择真实测试环境。</p>
          <div className="note">
            <Info />
            当前原型聚焦 Agent 配置与生成溯源，不连接 Runner，也不会产生真实测试结果。
          </div>
          <Button primary onClick={() => setRunInfo(false)}>
            返回用例详情
          </Button>
        </Modal>
      )}
    </section>
  );
}
function Lineage({ item, trace, onTrace }) {
  return (
    <ol className="lineage">
      <li>
        <small>{trace.date}</small>
        <button type="button" onClick={() => onTrace({ id: trace.id, caseName: item.name })}>
          <strong>AI 生成初稿 · {trace.id}</strong>
          <CaretRight size={17} />
        </button>
        <p>由 {trace.agent.name} 生成，基于 ApiVersion v12</p>
      </li>
      {item.edited && (
        <li>
          <small>{trace.id === 'gen_1042' ? '2026-10-10 11:05' : '2026-10-10 15:12'}</small>
          <strong>林安调整断言 · 草稿</strong>
          <p>人工核对并修订用例内容</p>
        </li>
      )}
      {item.status === 'published' && (
        <li>
          <small>{trace.id === 'gen_1042' ? '2026-10-10 11:20' : '2026-10-10 15:14'}</small>
          <strong>林安审核并发布 · v{item.version}</strong>
          <p>确认用例内容，发布为正式版本</p>
        </li>
      )}
    </ol>
  );
}
function TraceDrawer({ id, caseName = '正常创建订单', onClose }) {
  const s = useStore();
  const trace = s.traces.find((t) => t.id === id);
  const [tab, setTab] = useState('process');
  const [snapshot, setSnapshot] = useState(false);
  const [others, setOthers] = useState(false);
  const [expanded, setExpanded] = useState(true);
  if (!trace) return null;
  const current = s.agents.find((a) => a.id === trace.agent.id);
  return (
    <Modal title="Agent 执行详情" drawer onClose={onClose}>
      <div className="trace-subtitle">
        关联用例：<strong>{caseName}</strong> · 初始生成来源
      </div>
      <div className="trace-id">
        <span className="mono">
          {trace.id} · 第 {trace.attempt} 次尝试
        </span>
        <Badge>已完成</Badge>
      </div>
      <p className="muted trace-time">
        {trace.date} · {trace.duration}s <span>示例执行数据</span>
      </p>
      <section className="snapshot">
        <h4>
          <Lock size={18} />
          本次执行快照
        </h4>
        <div className="snapshot-grid">
          <dl className="facts">
            <dt>执行 Agent</dt>
            <dd className="agent-inline">
              <AgentAvatar agent={trace.agent} size={26} />
              {trace.agent.name} · v{trace.agent.version}
            </dd>
            <dt>厂商 / 实际模型</dt>
            <dd>
              {trace.agent.provider} / {trace.agent.model}
            </dd>
            <dt>模板版本</dt>
            <dd>{trace.template}</dd>
          </dl>
          <dl className="facts">
            <dt>模型快照</dt>
            <dd>厂商未返回</dd>
            <dt>执行标识</dt>
            <dd>{trace.id}</dd>
            <dt>来源版本</dt>
            <dd>{trace.source}</dd>
          </dl>
        </div>
      </section>
      <div className="tabs trace-tabs">
        {[
          ['process', '执行过程'],
          ['evidence', '输入与依据'],
          ['output', '原始产出'],
        ].map(([key, label]) => (
          <button
            type="button"
            key={key}
            className={tab === key ? 'selected' : ''}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'process' ? (
        <>
          <ol className="trace-timeline">
            <li>
              <span className="stage-num">1</span>
              <div>
                <div className="stage-title">
                  <span className="mono muted">{trace.date.slice(11)}:00</span>
                  <strong>读取接口依据 · 2.0s</strong>
                  <Badge>已完成</Badge>
                </div>
                <p>基于接口契约读取生成所需信息。</p>
                <button type="button" className="text-button" onClick={() => setTab('evidence')}>
                  ApiVersion v12 · POST /orders
                </button>
              </div>
            </li>
            <li>
              <span className="stage-num">2</span>
              <div>
                <button
                  type="button"
                  className="stage-title expandable"
                  onClick={() => setExpanded(!expanded)}
                  aria-expanded={expanded}
                >
                  <span className="mono muted">{trace.date.slice(11)}:02</span>
                  <strong>生成候选草稿 · 14.0s</strong>
                  <CaretDown size={15} />
                </button>
                <p>调用大模型生成测试用例草稿。</p>
                {expanded && (
                  <div className="call-details">
                    <div>
                      <span>调用模型</span>
                      <strong>
                        {trace.agent.provider} / {trace.agent.model}
                      </strong>
                    </div>
                    <div>
                      <span>输入</span>
                      {trace.inputTokens.toLocaleString()} tokens<span>输出</span>
                      {trace.outputTokens.toLocaleString()} tokens
                    </div>
                    <div className="tool-calls">
                      <span>工具调用</span>
                      <section>
                        <p>
                          <CheckCircle size={16} weight="fill" />
                          读取接口 <code>read_endpoint</code>
                        </p>
                        <p>
                          <CheckCircle size={16} weight="fill" />
                          提交草稿 <code>propose_test</code>
                        </p>
                      </section>
                    </div>
                  </div>
                )}
              </div>
            </li>
            <li>
              <span className="stage-num">3</span>
              <div>
                <div className="stage-title">
                  <span className="mono muted">{trace.date.slice(11)}:16</span>
                  <strong>结构校验与保存 · 2.4s</strong>
                  <Badge>已完成</Badge>
                </div>
                <p>
                  校验用例结构并保存至用例草稿。
                  <br />
                  已生成 6 份待审核草稿。
                </p>
              </div>
            </li>
          </ol>
          <section className="trace-output">
            <h3 className="accent-heading">当前用例的原始产出</h3>
            <button type="button" className="output-link" onClick={() => setTab('output')}>
              <FileText size={22} />
              <span>
                <strong>{caseName}</strong>
                <small>查看生成时的请求与断言，原始产出保持不变。</small>
              </span>
              <ArrowRight />
            </button>
            <button
              type="button"
              className="other-toggle"
              onClick={() => setOthers(!others)}
              aria-expanded={others}
            >
              <FileText />
              其他产出 · 5 份{others ? <CaretDown /> : <CaretRight />}
            </button>
            {others && (
              <div className="other-outputs">
                {names
                  .filter((n) => n !== caseName)
                  .slice(0, 5)
                  .map((n) => (
                    <div key={n}>
                      {n}
                      <span>原始草稿</span>
                    </div>
                  ))}
              </div>
            )}
          </section>
        </>
      ) : tab === 'evidence' ? (
        <div className="trace-evidence">
          <h3>本次生成目标</h3>
          <p className="precondition">{trace.objective}</p>
          <h3>来源依据</h3>
          <dl className="facts">
            <dt>来源版本</dt>
            <dd>{trace.source}</dd>
            <dt>接口</dt>
            <dd>POST /orders</dd>
            <dt>必填字段</dt>
            <dd>sku、quantity</dd>
            <dt>引用范围</dt>
            <dd>请求结构、响应状态、字段约束</dd>
            <dt>输入校验</dt>
            <dd>
              <code>sha256:8c9d…a71f</code>（示例）
            </dd>
          </dl>
          <div className="note">
            <Info />
            只展示脱敏输入摘要与来源引用，不保存模型内部推理。
          </div>
        </div>
      ) : (
        <div className="trace-evidence">
          <div className="section-heading">
            <h3>{caseName}</h3>
            <Badge tone="amber">生成时：待审核</Badge>
          </div>
          <p className="muted">以下为本次执行的原始产出，后续人工修改不会覆盖它。</p>
          <div className="endpoint">
            <span className="method">POST</span>
            <code>/orders</code>
          </div>
          <pre className="review-code">{JSON.stringify(baseDefinition, null, 2)}</pre>
          <div className="precondition">
            断言：HTTP 状态码 = {caseName === names[0] ? '201' : '400'}
          </div>
          <div className="note">
            <Lock />
            原始产出为只读。当前用例可能包含后续人工修改。
          </div>
        </div>
      )}
      <button type="button" className="snapshot-link" onClick={() => setSnapshot(true)}>
        <Lock size={21} />
        <span>查看当时的 Agent 配置</span>
        <Badge tone="brown">只读 v{trace.agent.version}</Badge>
        <ArrowRight size={18} />
      </button>
      {snapshot && (
        <Modal title="当时的 Agent 配置" onClose={() => setSnapshot(false)}>
          <Badge tone="brown">只读快照 · v{trace.agent.version}</Badge>
          <h3 className="snapshot-identity">
            <AgentAvatar agent={trace.agent} size={52} />
            {trace.agent.name}
          </h3>
          <dl className="facts">
            <dt>Agent ID</dt>
            <dd>{trace.agent.id}</dd>
            <dt>厂商</dt>
            <dd>{trace.agent.provider}</dd>
            <dt>实际模型</dt>
            <dd>{trace.agent.model}</dd>
            <dt>适用功能</dt>
            <dd>{trace.agent.capability}</dd>
            <dt>超时 / 重试</dt>
            <dd>
              {trace.agent.timeout} 秒 / {trace.agent.retries} 次
            </dd>
          </dl>
          <p className="precondition">{trace.agent.role}</p>
          <div className="note">
            <Lock />
            {current?.version !== trace.agent.version
              ? `当前配置已更新至 v${current?.version}，本次执行仍绑定 v${trace.agent.version}。`
              : '历史执行固定引用此快照，不受后续 Agent 配置变更影响。'}
          </div>
        </Modal>
      )}
    </Modal>
  );
}
