import {
  ArrowsClockwise,
  CheckCircle,
  ClipboardText,
  Database,
  Funnel,
  Key,
  LinkSimple,
  MagnifyingGlass,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  TrashSimple,
  X,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErrorCallout } from '../../components/shared/ErrorCallout';
import { cpClient, type Secret } from '../../lib/cp-client';
import { useAuthStore } from '../../stores/authStore';

type VariableTab = 'all' | 'runtime' | 'secret' | 'dataset' | 'source';
type VariableKind = Exclude<VariableTab, 'all'>;

interface VariableRow {
  id: string;
  name: string;
  kind: VariableKind;
  scope: string;
  value: string;
  source: string;
  updatedAt: string;
  note: string;
}

const tabs: Array<{ value: VariableTab; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'runtime', label: '运行变量' },
  { value: 'secret', label: 'Secrets' },
  { value: 'dataset', label: '数据集' },
  { value: 'source', label: '接口取值' },
];

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function kindLabel(kind: VariableKind) {
  return {
    runtime: '运行变量',
    secret: 'Secret',
    dataset: '数据集',
    source: '接口取值',
  }[kind];
}

export default function VariablesView() {
  const workspaceId = useAuthStore((state) => state.user?.workspaceId);
  const [references, setReferences] = useState<VariableRow[]>([]);
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [tab, setTab] = useState<VariableTab>('all');
  const [query, setQuery] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [selectedVariable, setSelectedVariable] = useState<VariableRow | null>(null);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setError(null);
    try {
      const [secretData, environments, datasets, workflows] = await Promise.all([
        cpClient.listSecrets(workspaceId),
        cpClient.listEnvironments(workspaceId),
        cpClient.listDatasets(workspaceId),
        cpClient.listWorkflows(workspaceId),
      ]);
      const environmentRows = await Promise.all(
        environments.environments.map(async (env) => {
          const versions = (await cpClient.listEnvironmentVersions(env.id)).versions;
          const latest = versions.reduce<(typeof versions)[number] | undefined>(
            (a, b) => (!a || b.version > a.version ? b : a),
            undefined,
          );
          if (!latest) return [];
          return Object.entries({ baseUrl: latest.baseUrl, ...latest.variables }).map(
            ([name, value]) => ({
              id: `${latest.id}:${name}`,
              name,
              kind: 'runtime' as const,
              scope: `${env.name} · v${latest.version}`,
              value,
              source: latest.id,
              updatedAt: formatDate(latest.createdAt),
              note: '此环境的最新版本。执行使用创建运行时固定的版本。',
            }),
          );
        }),
      );
      const datasetRows = await Promise.all(
        datasets.datasets.map(async (dataset) => {
          const versions = (await cpClient.listDatasetVersions(dataset.id)).versions;
          const latest = versions.reduce<(typeof versions)[number] | undefined>(
            (a, b) => (!a || b.version > a.version ? b : a),
            undefined,
          );
          return latest
            ? [
                {
                  id: latest.id,
                  name: dataset.name,
                  kind: 'dataset' as const,
                  scope: `v${latest.version}`,
                  value: `${latest.rows.length} 行`,
                  source: latest.id,
                  updatedAt: formatDate(latest.createdAt),
                  note: '固定版本的数据集引用；此页不展开数据值。',
                },
              ]
            : [];
        }),
      );
      const sourceRows: VariableRow[] = workflows.workflows.flatMap((workflow) => {
        const version = workflow.latestVersion;
        const steps = version?.definition['steps'];
        if (!version || !Array.isArray(steps)) return [];
        return steps.flatMap((step) =>
          Array.isArray(step.extract)
            ? step.extract.map(
                (item: { name: string; expression: string; source: string }, index: number) => ({
                  id: `${version.id}:${step.id}:${index}`,
                  name: item.name,
                  kind: 'source' as const,
                  scope: `${workflow.name} · v${version.version}`,
                  value: item.expression,
                  source: `${step.name} · ${item.source}`,
                  updatedAt: formatDate(version.publishedAt),
                  note: `取值定义来自流程版本 ${version.id}；运行时由该步骤响应产生。`,
                }),
              )
            : [],
        );
      });
      setSecrets(secretData.secrets);
      setReferences([...environmentRows.flat(), ...datasetRows.flat(), ...sourceRows]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法读取 Secret。');
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rows = useMemo(() => {
    const secretRows: VariableRow[] = secrets.map((secret) => ({
      id: secret.id,
      name: secret.name,
      kind: 'secret',
      scope: '当前工作区',
      value: '••••••••••••',
      source: secret.description || 'Control Plane',
      updatedAt: formatDate(secret.updatedAt),
      note: '值已加密保存，Control Plane 不会将明文返回浏览器。',
    }));
    const result = [...references, ...secretRows];
    const normalized = query.trim().toLowerCase();
    return result.filter((row) => {
      const matchesTab = tab === 'all' || row.kind === tab;
      const matchesQuery =
        !normalized ||
        [row.name, row.scope, row.source, row.value].some((field) =>
          field.toLowerCase().includes(normalized),
        );
      return matchesTab && matchesQuery;
    });
  }, [query, secrets, tab, references]);

  const createSecret = async () => {
    if (!workspaceId || !name.trim() || !value) return;
    setBusy(true);
    setError(null);
    try {
      await cpClient.createSecret(workspaceId, name.trim(), value, description.trim() || undefined);
      setName('');
      setValue('');
      setDescription('');
      setComposerOpen(false);
      setTab('secret');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建 Secret 失败。');
    } finally {
      setBusy(false);
    }
  };

  const removeSecret = async (secret: Secret) => {
    setBusy(true);
    setError(null);
    try {
      await cpClient.deleteSecret(secret.id);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除 Secret 失败。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page-view variables-workbench">
      <div className="page-actions-row">
        <button className="button button--outline" type="button" onClick={() => void refresh()}>
          <ArrowsClockwise size={17} /> 刷新
        </button>
        <button
          className="button button--primary"
          type="button"
          onClick={() => setComposerOpen(true)}
        >
          <Plus size={17} /> 新增 Secret
        </button>
      </div>

      <section className="variable-ledger" aria-label="变量说明">
        <div className="variable-ledger__mark">
          <SlidersHorizontal size={21} weight="duotone" />
        </div>
        <div>
          <strong>运行时引用由版本决定</strong>
          <p>
            环境、数据集和流程取值在发布后按版本执行；下方读取当前工作区的环境、数据集和流程版本。
          </p>
        </div>
        <span className="variable-ledger__seal">
          <ShieldCheck size={15} weight="fill" /> 工作区实时连接
        </span>
      </section>

      {error ? <ErrorCallout title="变量暂未同步" message={error} onRetry={refresh} /> : null}

      <section className="variables-panel">
        <div className="variable-filter-bar">
          <div className="filter-tabs" role="tablist" aria-label="变量类型">
            {tabs.map((item) => (
              <button
                aria-selected={tab === item.value}
                className={tab === item.value ? 'is-active' : ''}
                key={item.value}
                onClick={() => setTab(item.value)}
                role="tab"
                type="button"
              >
                {item.label}
                {item.value === 'secret' && secrets.length ? <small>{secrets.length}</small> : null}
              </button>
            ))}
          </div>
          <label className="search-field">
            <MagnifyingGlass size={17} aria-hidden="true" />
            <input
              aria-label="搜索变量"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索名称、来源或作用域"
              value={query}
            />
          </label>
          <button className="filter-button" type="button" aria-label="筛选已固定为当前工作区">
            <Funnel size={16} /> 当前工作区
          </button>
        </div>

        <div className="variables-table" role="table" aria-label="变量列表">
          <div className="data-row data-row--head" role="row" tabIndex={0}>
            <span>名称</span>
            <span>类型</span>
            <span>状态</span>
            <span>作用域</span>
            <span>来源</span>
            <span>当前引用</span>
            <span>更新</span>
            <span>说明</span>
            <span>操作</span>
          </div>
          {rows.map((row) => {
            const remoteSecret = secrets.find((secret) => secret.id === row.id);
            const hasSource = !remoteSecret;
            return (
              <div className="data-row variable-row" key={row.id} role="row" tabIndex={0}>
                <span className="variable-name">
                  {row.kind === 'secret' ? <Key size={16} /> : <ClipboardText size={16} />}
                  <code>{row.name}</code>
                </span>
                <span>
                  <span className={`variable-kind variable-kind--${row.kind}`}>
                    {kindLabel(row.kind)}
                  </span>
                </span>
                <span>
                  <CheckCircle className="variable-ready" size={16} weight="fill" />
                </span>
                <span>{row.scope}</span>
                <span className="variable-source-cell">
                  <button
                    className="variable-source-link"
                    onClick={() => hasSource && setSelectedVariable(row)}
                    type="button"
                    disabled={!hasSource}
                  >
                    {row.kind === 'dataset' ? <Database size={14} /> : <LinkSimple size={14} />}
                    {row.source}
                  </button>
                </span>
                <span>
                  <code className={row.kind === 'secret' ? 'secret-value' : ''}>{row.value}</code>
                </span>
                <span>{row.updatedAt}</span>
                <span>
                  <span className="live-tag">实时</span>
                </span>
                <span>
                  {remoteSecret ? (
                    <button
                      aria-label={`删除 ${remoteSecret.name}`}
                      className="icon-button"
                      disabled={busy}
                      onClick={() => void removeSecret(remoteSecret)}
                      type="button"
                    >
                      <TrashSimple size={16} />
                    </button>
                  ) : (
                    <button
                      aria-label={`查看 ${row.name} 的来源说明`}
                      className="icon-button"
                      onClick={() => setSelectedVariable(row)}
                      type="button"
                    >
                      <LinkSimple size={16} />
                    </button>
                  )}
                </span>
              </div>
            );
          })}
          {!rows.length ? (
            <div className="empty-module variable-empty">
              <Key size={38} weight="duotone" />
              <h3>{tab === 'secret' ? '还没有 Secret' : '没有匹配的变量'}</h3>
              <p>
                {tab === 'secret'
                  ? '创建后会由 Control Plane 加密保存。'
                  : '先在环境或流程中添加变量定义；已有数据时可以调整筛选条件。'}
              </p>
            </div>
          ) : null}
        </div>
      </section>

      <section className="variable-footnotes" aria-label="变量使用说明">
        <article>
          <span>01</span>
          <div>
            <strong>Secret</strong>
            <p>创建、读取列表和删除均连接 Control Plane，明文永不回显。</p>
          </div>
        </article>
        <article>
          <span>02</span>
          <div>
            <strong>运行变量</strong>
            <p>读取环境的最新版本；实际运行使用已固定的版本。</p>
          </div>
        </article>
        <article>
          <span>03</span>
          <div>
            <strong>数据与取值</strong>
            <p>读取数据集版本和流程提取定义，保留来源与版本。</p>
          </div>
        </article>
      </section>

      {composerOpen ? (
        <div
          className="variable-overlay"
          role="presentation"
          onMouseDown={() => setComposerOpen(false)}
        >
          <section
            aria-labelledby="new-secret-title"
            className="variable-composer"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <header>
              <div>
                <span className="eyebrow">CONTROL PLANE SECRET</span>
                <h3 id="new-secret-title">新增 Secret</h3>
                <p>保存后仅显示名称与描述，值不会返回浏览器。</p>
              </div>
              <button
                className="icon-button"
                onClick={() => setComposerOpen(false)}
                type="button"
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            </header>
            <div className="variable-composer__body">
              <label>
                名称
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例如 PAYMENT_API_KEY"
                />
              </label>
              <label>
                值
                <input
                  type="password"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder="仅在创建时输入"
                />
              </label>
              <label>
                说明
                <input
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="例如：支付沙箱访问令牌"
                />
              </label>
            </div>
            <footer>
              <button
                className="button button--outline"
                onClick={() => setComposerOpen(false)}
                type="button"
              >
                取消
              </button>
              <button
                className="button button--primary"
                disabled={busy || !name.trim() || !value}
                onClick={() => void createSecret()}
                type="button"
              >
                <Key size={16} /> {busy ? '保存中…' : '创建 Secret'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {selectedVariable ? (
        <aside className="variable-source-drawer" aria-label={`${selectedVariable.name} 的来源`}>
          <header className="variable-source-drawer__header">
            <div>
              <span className="eyebrow">版本来源</span>
              <h2>{selectedVariable.name}</h2>
              <p>这条引用来自当前工作区保存的版本。</p>
            </div>
            <button
              className="icon-button"
              onClick={() => setSelectedVariable(null)}
              type="button"
              aria-label="关闭详情"
            >
              <X size={18} />
            </button>
          </header>
          <div className="variable-source-drawer__body">
            <section className="source-step">
              <h3>
                <span>1</span>引用位置
              </h3>
              <label>
                作用域
                <input readOnly value={selectedVariable.scope} />
              </label>
              <label>
                来源
                <input readOnly value={selectedVariable.source} />
              </label>
            </section>
            <section className="source-step">
              <h3>
                <span>2</span>解析结果
              </h3>
              <label>
                当前引用
                <textarea readOnly value={selectedVariable.value} />
              </label>
              <p className="source-policy-note">
                此处展示版本定义；实际值由执行时的环境、数据集或步骤响应决定。
              </p>
            </section>
            <section className="source-step">
              <h3>
                <span>3</span>说明
              </h3>
              <p>{selectedVariable.note}</p>
            </section>
          </div>
          <footer className="variable-source-drawer__footer">
            <div className="source-footer-actions">
              <button
                className="button button--primary"
                onClick={() => setSelectedVariable(null)}
                type="button"
              >
                完成
              </button>
            </div>
          </footer>
        </aside>
      ) : null}
    </main>
  );
}
