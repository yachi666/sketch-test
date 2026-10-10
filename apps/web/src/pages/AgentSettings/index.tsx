import { CaretRight, MagnifyingGlass, Plus } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import {
  type AgentConfig,
  type AgentSnapshot,
  type ConnectionConfig,
  cpClient,
  type ProviderConnection,
} from '../../lib/cp-client';
import './settings.css';
export function AgentAvatar({
  agent,
  size = 48,
}: {
  agent?: Pick<AgentSnapshot, 'avatar'> | null;
  size?: number;
}) {
  return (
    <img
      className="agent-pixel"
      src={`/avatars/${agent?.avatar ?? 'contract'}.png`}
      width={size}
      height={size}
      alt=""
    />
  );
}
const blank: AgentConfig = {
  name: '',
  avatar: 'contract',
  capability: 'test',
  enabled: true,
  connectionId: '',
  model: '',
  instructions: '根据接口证据生成正常、边界和异常用例。所有结果进入待审核草稿。',
  timeoutMs: 120000,
  retries: 2,
  maxOutputTokens: 4096,
};
const labels: Record<string, string> = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  anthropic: 'Anthropic',
  zai: '智谱 GLM（国际）',
  'zai-coding-cn': '智谱 GLM（中国）',
};
function configOf(a: AgentSnapshot): AgentConfig {
  const {
    name,
    avatar,
    capability,
    enabled,
    connectionId,
    model,
    instructions,
    timeoutMs,
    retries,
    maxOutputTokens,
  } = a;
  return {
    name,
    avatar,
    capability,
    enabled,
    connectionId,
    model,
    instructions,
    timeoutMs,
    retries,
    maxOutputTokens,
  };
}
export function AgentSettingsPage() {
  const [agents, setAgents] = useState<AgentSnapshot[]>([]),
    [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [workers, setWorkers] = useState<
    Awaited<ReturnType<typeof cpClient.aiCapabilities>>['workers']
  >([]);
  const [id, setId] = useState<string | null>(null),
    [creating, setCreating] = useState(false),
    [query, setQuery] = useState(''),
    [tab, setTab] = useState('agents');
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState<AgentConfig>(blank),
    [advanced, setAdvanced] = useState(false),
    [history, setHistory] = useState<Array<{ config: AgentSnapshot; createdAt: string }> | null>(
      null,
    );
  const [connection, setConnection] = useState<ConnectionConfig>({
    name: '',
    provider: 'deepseek',
    connectionRef: 'default',
  });
  const selected = agents.find((a) => a.id === id);
  const refresh = useCallback(async () => {
    const [a, c, w] = await Promise.all([
      cpClient.listAgents(),
      cpClient.listConnections(),
      cpClient.aiCapabilities(),
    ]);
    setAgents(a.agents);
    setConnections(c.connections);
    setWorkers(w.workers);
    setLoaded(true);
    return a.agents;
  }, []);
  useEffect(() => {
    void refresh()
      .then((a) => {
        if (a[0]) {
          setId(a[0].id);
          setForm(configOf(a[0]));
        }
      })
      .catch((e) => setError(e.message));
  }, [refresh]);
  const choose = (a: AgentSnapshot) => {
    setId(a.id);
    setForm(configOf(a));
    setCreating(false);
    setHistory(null);
    setError('');
  };
  const update = <K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const perform = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };
  const c = connections.find((c) => c.id === form.connectionId);
  const models = workers
    .filter(
      (w) =>
        w.agentConfigVersion === 1 &&
        w.provider === c?.provider &&
        (w.connectionRef ?? 'default') === c?.connectionRef,
    )
    .map((w) => w.model);
  return (
    <main className="page-view agm">
      {error && (
        <p role="alert" className="agm-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="agm-notice">
          {notice}
        </p>
      )}
      <section className="paper-panel agm-panel">
        <div className="agm-tabs">
          <button type="button" aria-pressed={tab === 'agents'} onClick={() => setTab('agents')}>
            Agent 配置
          </button>
          <button
            type="button"
            aria-pressed={tab === 'connections'}
            onClick={() => setTab('connections')}
          >
            厂商连接
          </button>
        </div>
        {tab === 'connections' ? (
          <div className="agm-connections">
            <h2>厂商连接</h2>
            <p>
              密钥由独立 Worker 保管。连接引用匹配 Worker 的 AI_CONNECTION_REF，不填写 API Key。
            </p>
            {connections.map((c) => (
              <div className="agm-connection" key={c.id}>
                <strong>{c.name}</strong>
                <span>
                  {labels[c.provider]} · {c.connectionRef}
                </span>
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      const r = await cpClient.checkConnection(c.id);
                      setNotice(
                        `${c.name}：${r.message}${r.models.length ? ' · ' + r.models.join(', ') : ''}`,
                      );
                    })
                  }
                >
                  检测 Worker
                </button>
              </div>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void perform(async () => {
                  await cpClient.addConnection(connection);
                  await refresh();
                  setNotice('连接已保存');
                  setConnection({ ...connection, name: '' });
                });
              }}
            >
              <h3>添加连接</h3>
              <div className="agm-fields">
                <label>
                  连接名称
                  <input
                    required
                    value={connection.name}
                    onChange={(e) => setConnection({ ...connection, name: e.target.value })}
                  />
                </label>
                <label>
                  厂商
                  <select
                    value={connection.provider}
                    onChange={(e) =>
                      setConnection({
                        ...connection,
                        provider: e.target.value as ConnectionConfig['provider'],
                      })
                    }
                  >
                    {Object.entries(labels).map(([v, l]) => (
                      <option value={v} key={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Worker 连接引用
                  <input
                    required
                    pattern="[a-zA-Z0-9_.-]{1,80}"
                    value={connection.connectionRef}
                    onChange={(e) =>
                      setConnection({ ...connection, connectionRef: e.target.value })
                    }
                  />
                </label>
              </div>
              <button className="button button--primary" disabled={busy} type="submit">
                保存连接
              </button>
            </form>
            <h3>已发现的在线模型</h3>
            {workers.length ? (
              workers.map((w) => (
                <p key={w.workerId}>
                  {labels[w.provider] ?? w.provider} / {w.model} · 引用{' '}
                  {w.connectionRef ?? 'default'} ·{' '}
                  {w.agentConfigVersion === 1 ? '支持 Agent 配置' : 'Worker 需要升级'}
                </p>
              ))
            ) : (
              <p>暂无在线 Worker</p>
            )}
          </div>
        ) : (
          <div className="agm-columns">
            <aside className="agm-roster">
              <div className="agm-row-heading">
                <h3>团队 Agent ({agents.length})</h3>
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() => {
                    setCreating(true);
                    setId(null);
                    setHistory(null);
                    setForm({ ...blank, connectionId: connections[0]?.id ?? '' });
                  }}
                >
                  <Plus />
                  新建 Agent
                </button>
              </div>
              <label className="agm-search">
                <MagnifyingGlass />
                <input
                  aria-label="搜索 Agent"
                  placeholder="搜索 Agent 名称"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              {agents
                .filter((a) => a.name.toLowerCase().includes(query.toLowerCase()))
                .map((a) => (
                  <button
                    type="button"
                    key={a.id}
                    className={`agm-agent ${id === a.id ? 'selected' : ''}`}
                    onClick={() => choose(a)}
                  >
                    <AgentAvatar agent={a} />
                    <span>
                      <strong>
                        {a.name}{' '}
                        <small className="agm-status">{a.enabled ? '已启用' : '已停用'}</small>
                      </strong>
                      <span>
                        {labels[a.provider] ?? a.provider} · {a.model}
                      </span>
                      <small>{a.capability === 'test' ? '用于用例生成' : '用于测试计划'}</small>
                    </span>
                    <small>v{a.version}</small>
                    <CaretRight />
                  </button>
                ))}
              {!agents.length && (
                <p>{loaded ? '先添加厂商连接，再创建第一个 Agent。' : '正在读取 Agent…'}</p>
              )}
              <p className="agm-footnote">Agent 配置供各业务功能选择使用</p>
            </aside>
            {selected || creating ? (
              <form
                className="agm-editor"
                onSubmit={(e) => {
                  e.preventDefault();
                  void perform(async () => {
                    const { agent } = await cpClient.saveAgent(
                      form,
                      selected?.id,
                      selected?.version,
                    );
                    await refresh();
                    choose(agent);
                    setNotice(`已保存为 v${agent.version}，历史执行保持原配置`);
                  });
                }}
              >
                <div className="agm-path">/ agents / {selected?.id ?? 'new'}</div>
                <header className="agm-identity">
                  <AgentAvatar agent={form} size={88} />
                  <div>
                    <h2>{selected?.name ?? '新的 Agent'}</h2>
                    <label className="agm-enabled">
                      <input
                        type="checkbox"
                        checked={form.enabled}
                        onChange={(e) => update('enabled', e.target.checked)}
                      />
                      {form.enabled ? '已启用' : '已停用'}
                    </label>
                  </div>
                  {selected && (
                    <div className="agm-version">
                      <span className="agm-status">当前 v{selected.version}</span>
                      <button
                        type="button"
                        onClick={() =>
                          void perform(async () =>
                            setHistory((await cpClient.agentVersions(selected.id)).versions),
                          )
                        }
                      >
                        历史版本
                      </button>
                    </div>
                  )}
                </header>
                {history && (
                  <section className="agm-history">
                    <div className="agm-row-heading">
                      <h3>历史版本 · 只读</h3>
                      <button type="button" onClick={() => setHistory(null)}>
                        收起
                      </button>
                    </div>
                    {history.map((v) => (
                      <details key={v.config.version}>
                        <summary>
                          v{v.config.version} · {v.config.model} ·{' '}
                          {new Date(v.createdAt).toLocaleString()}
                        </summary>
                        <pre>{JSON.stringify(v.config, null, 2)}</pre>
                      </details>
                    ))}
                  </section>
                )}
                <section>
                  <h3>基本信息</h3>
                  <div className="agm-fields">
                    <label>
                      Agent 名称
                      <input
                        required
                        maxLength={80}
                        value={form.name}
                        onChange={(e) => update('name', e.target.value)}
                      />
                    </label>
                    <label>
                      适用功能
                      <select
                        value={form.capability}
                        onChange={(e) =>
                          update('capability', e.target.value as AgentConfig['capability'])
                        }
                      >
                        <option value="test">用例生成</option>
                        <option value="plan">测试计划</option>
                      </select>
                    </label>
                  </div>
                </section>
                <section>
                  <h3>模型连接</h3>
                  <div className="agm-fields">
                    <label>
                      厂商连接
                      <select
                        required
                        value={form.connectionId}
                        onChange={(e) => {
                          update('connectionId', e.target.value);
                          update('model', '');
                        }}
                      >
                        <option value="">选择厂商连接</option>
                        {connections.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} · {labels[c.provider]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      模型 ID
                      <input
                        required
                        list="agent-models"
                        value={form.model}
                        maxLength={256}
                        placeholder="填写准确的模型 ID"
                        onChange={(e) => update('model', e.target.value)}
                      />
                      <datalist id="agent-models">
                        {models.map((m) => (
                          <option key={m} value={m} />
                        ))}
                      </datalist>
                    </label>
                  </div>
                  <p>
                    {models.includes(form.model)
                      ? '所选模型的 Worker 在线'
                      : '所选连接/模型尚无在线 Worker；保存配置后需上线匹配 Worker 才能生成。'}
                  </p>
                  {!connections.length && (
                    <button type="button" className="button" onClick={() => setTab('connections')}>
                      添加厂商连接
                    </button>
                  )}
                </section>
                <section>
                  <h3>行为配置</h3>
                  <label>
                    职责说明
                    <textarea
                      required
                      rows={3}
                      maxLength={2000}
                      value={form.instructions}
                      onChange={(e) => update('instructions', e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="agm-advanced"
                    aria-expanded={advanced}
                    onClick={() => setAdvanced(!advanced)}
                  >
                    高级参数 · 超时、重试、输出限制
                  </button>
                  {advanced && (
                    <div className="agm-fields">
                      <label>
                        超时（秒）
                        <input
                          type="number"
                          min={10}
                          max={180}
                          value={form.timeoutMs / 1000}
                          onChange={(e) => update('timeoutMs', Number(e.target.value) * 1000)}
                        />
                      </label>
                      <label>
                        租约失效重试次数
                        <input
                          type="number"
                          min={0}
                          max={3}
                          value={form.retries}
                          onChange={(e) => update('retries', Number(e.target.value))}
                        />
                      </label>
                      <label>
                        最大输出 Tokens
                        <input
                          type="number"
                          min={128}
                          max={8192}
                          value={form.maxOutputTokens}
                          onChange={(e) => update('maxOutputTokens', Number(e.target.value))}
                        />
                      </label>
                      <label>
                        机器人形象
                        <select
                          value={form.avatar}
                          onChange={(e) =>
                            update('avatar', e.target.value as AgentConfig['avatar'])
                          }
                        >
                          <option value="contract">橙色</option>
                          <option value="language">绿色</option>
                          <option value="plan">蓝色</option>
                        </select>
                      </label>
                    </div>
                  )}
                </section>
                <footer>
                  <small>保存生成新版本，历史执行保留当时配置。</small>
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() => {
                      if (selected) choose(selected);
                      else setCreating(false);
                    }}
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="button button--primary"
                    disabled={
                      busy ||
                      (!!selected && JSON.stringify(form) === JSON.stringify(configOf(selected)))
                    }
                  >
                    {busy ? '保存中…' : selected ? `保存为 v${selected.version + 1}` : '创建 Agent'}
                  </button>
                </footer>
              </form>
            ) : (
              <div className="agm-empty">
                <AgentAvatar size={88} />
                <h2>组建你的 Agent 团队</h2>
                <p>为不同任务配置角色、模型和连接，执行时保留完整版本来源。</p>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
