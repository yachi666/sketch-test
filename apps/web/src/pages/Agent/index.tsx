import { ArrowRight, ArrowsClockwise, GithubLogo, Robot, ShieldCheck } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorCallout } from '../../components/shared/ErrorCallout';
import { type ApiVersionSummary, cpClient, type GenerationJob } from '../../lib/cp-client';
import { useAuthStore } from '../../stores/authStore';
import './agent.css';

type GenerationEndpoint = {
  id: string;
  method: string;
  path: string;
  responses?: unknown[];
  sourceLocations?: Array<{ sourceLabel: string; location?: string }>;
};
const githubEvidenceUrl = (value?: string) =>
  value?.startsWith('https://github.com/') ? value : undefined;

const statuses: Record<GenerationJob['status'], string> = {
  pending: '等待领取',
  running: '正在生成',
  completed: '生成完成',
  failed: '生成失败',
  cancelled: '已取消',
};
export function AgentPage() {
  const workspaceId = useAuthStore((s) => s.user?.workspaceId);
  const [capability, setCapability] = useState<Awaited<
    ReturnType<typeof cpClient.aiCapabilities>
  > | null>(null);
  const [versions, setVersions] = useState<ApiVersionSummary[]>([]);
  const [versionId, setVersionId] = useState('');
  const [sourceMode, setSourceMode] = useState<'api' | 'repository'>('api');
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [repositoryRef, setRepositoryRef] = useState('');
  const [repositoryDirectory, setRepositoryDirectory] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [repository, setRepository] = useState<{
    repositoryUrl?: string;
    commit?: string;
    files?: unknown[];
  } | null>(null);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);
  const [sourceType, setSourceType] = useState('');
  const [repositoryVersionId, setRepositoryVersionId] = useState('');
  const [endpoints, setEndpoints] = useState<GenerationEndpoint[]>([]);
  const [endpointIds, setEndpointIds] = useState<string[]>([]);
  const [endpointQuery, setEndpointQuery] = useState('');
  const [endpointVersionId, setEndpointVersionId] = useState('');
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [objective, setObjective] = useState(
    '为关键接口生成正常响应与边界场景的回归草稿，列出契约中缺失的业务预期。',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(
    async (clearError = false) => {
      if (!workspaceId) return;
      try {
        const [available, assets, tasks] = await Promise.all([
          cpClient.aiCapabilities(),
          cpClient.listApiVersions(),
          cpClient.listGenerationJobs(workspaceId),
        ]);
        setCapability(available);
        setVersions(assets.apiVersions);
        setJobs(tasks.jobs.filter((j) => j.strategy === 'pi'));
        setVersionId((current) =>
          assets.apiVersions.some((v) => v.id === current)
            ? current
            : (assets.apiVersions[0]?.id ?? ''),
        );
        if (clearError) setError(null);
      } catch (e) {
        setCapability(null);
        setError(e instanceof Error ? e.message : '无法读取生成服务');
      }
    },
    [workspaceId],
  );
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    let active = true;
    setEndpointVersionId('');
    setEndpoints([]);
    setEndpointIds([]);
    setRepository(null);
    setSourceWarnings([]);
    setSourceType('');
    if (versionId)
      void cpClient
        .getApiVersion(versionId)
        .then((value) => {
          if (!active) return;
          const items = value.endpoints as GenerationEndpoint[];
          setSourceType(value.sourceType);
          setRepository(value.metadata?.extra ?? null);
          setSourceWarnings(
            (value.diagnostics as Array<{ message?: string }>)
              .map((d) => d.message ?? '')
              .filter(Boolean),
          );
          setEndpoints(items);
          setEndpointIds(
            items
              .filter((e) => value.sourceType !== 'code-discovery' || e.responses?.length)
              .slice(0, 5)
              .map((e) => e.id),
          );
          setEndpointVersionId(versionId);
        })
        .catch((e) => {
          if (active) setError(e instanceof Error ? e.message : '无法读取接口版本');
        });
    return () => {
      active = false;
    };
  }, [versionId]);
  const analyze = async () => {
    if (!repositoryUrl.trim() || analyzing) return;
    setAnalyzing(true);
    setRepositoryVersionId('');
    setError(null);
    try {
      const result = await cpClient.analyzeRepository({
        repositoryUrl: repositoryUrl.trim(),
        ref: repositoryRef.trim() || undefined,
        directory: repositoryDirectory.trim() || undefined,
      });
      await refresh();
      setVersionId(result.apiVersionId);
      setRepositoryVersionId(result.apiVersionId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '仓库分析失败');
    } finally {
      setAnalyzing(false);
    }
  };
  const start = async () => {
    if (
      !workspaceId ||
      (sourceMode === 'repository' &&
        (!repositoryVersionId || repositoryVersionId !== versionId)) ||
      !versionId ||
      !endpointIds.length ||
      endpointVersionId !== versionId ||
      !objective.trim()
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await cpClient.startGeneration(workspaceId, versionId, 'pi', endpointIds, objective.trim());
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建任务失败');
    } finally {
      setBusy(false);
    }
  };
  const change = async (id: string, action: 'cancel' | 'retry') => {
    setBusy(true);
    try {
      await cpClient.changeGeneration(id, action);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新任务失败');
    } finally {
      setBusy(false);
    }
  };
  const model = capability?.workers[0];
  return (
    <main className="page-view agent-workbench">
      <header className="agent-heading">
        <div>
          <span className="eyebrow">从测试意图到可审阅草稿</span>
          <h2>
            <Robot size={28} weight="duotone" /> 智能生成
          </h2>
          <p>连接 GitHub 仓库或选择 API 契约，生成带来源的测试草稿。</p>
        </div>
        <button className="button button--outline" type="button" onClick={() => void refresh(true)}>
          <ArrowsClockwise size={17} /> 刷新
        </button>
      </header>
      {error ? (
        <ErrorCallout title="生成操作未完成" message={error} onRetry={() => void refresh(true)} />
      ) : null}
      <div className="agent-columns">
        <section className="paper-panel agent-composer" aria-label="创建生成任务">
          <span className="agent-step">01 · 选择测试来源</span>
          <div className="agent-source-tabs" role="group" aria-label="测试来源">
            <button
              type="button"
              aria-pressed={sourceMode === 'api'}
              onClick={() => setSourceMode('api')}
              disabled={analyzing}
            >
              API 契约
            </button>
            <button
              type="button"
              aria-pressed={sourceMode === 'repository'}
              onClick={() => setSourceMode('repository')}
              disabled={analyzing}
            >
              <GithubLogo size={18} /> GitHub 仓库
            </button>
          </div>
          {sourceMode === 'repository' ? (
            <section className="agent-repository" aria-label="GitHub 仓库分析">
              <label>
                GitHub 仓库 URL
                <input
                  type="url"
                  aria-label="GitHub 仓库 URL"
                  value={repositoryUrl}
                  placeholder="https://github.com/owner/repository"
                  disabled={analyzing}
                  onChange={(e) => {
                    setRepositoryUrl(e.target.value);
                    setRepositoryVersionId('');
                  }}
                />
              </label>
              <div className="agent-repository-options">
                <label>
                  分支 / Commit
                  <input
                    aria-label="分支或 Commit"
                    placeholder="默认分支"
                    value={repositoryRef}
                    disabled={analyzing}
                    onChange={(e) => {
                      setRepositoryRef(e.target.value);
                      setRepositoryVersionId('');
                    }}
                  />
                </label>
                <label>
                  扫描目录（可选）
                  <input
                    aria-label="扫描目录"
                    placeholder="例如 src/main/java"
                    value={repositoryDirectory}
                    disabled={analyzing}
                    onChange={(e) => {
                      setRepositoryDirectory(e.target.value);
                      setRepositoryVersionId('');
                    }}
                  />
                </label>
              </div>
              <p className="agent-note">
                公开 GitHub · Java / Spring REST Controller。固定提交后读取路由、参数与 DTO
                校验；不会运行仓库代码。最多 160 个文件 / 4 MiB。
              </p>
              <button
                type="button"
                className="button button--outline"
                disabled={analyzing || !repositoryUrl.trim()}
                onClick={() => void analyze()}
              >
                {analyzing ? '正在读取提交与分析代码…' : '分析仓库接口'}
              </button>
              {analyzing ? (
                <p role="status">
                  正在从 GitHub 读取真实文件，通常需要几十秒。完成后可选择接口生成草稿。
                </p>
              ) : null}
              {versions.some((version) => version.sourceType === 'code-discovery') ? (
                <label>
                  已分析的仓库版本
                  <select
                    aria-label="已分析的仓库版本"
                    value={repositoryVersionId}
                    disabled={analyzing}
                    onChange={(event) => {
                      const id = event.target.value;
                      const version = versions.find((item) => item.id === id);
                      setRepositoryVersionId(id);
                      setVersionId(id);
                      setRepositoryUrl(version?.sourceLocation.split('/tree/')[0] ?? '');
                      setRepositoryRef(version?.sourceLocation.split('/tree/')[1] ?? '');
                      setRepositoryDirectory('');
                    }}
                  >
                    <option value="" disabled>
                      选择已保存的提交，无需重复分析
                    </option>
                    {versions
                      .filter((version) => version.sourceType === 'code-discovery')
                      .map((version) => (
                        <option key={version.id} value={version.id}>
                          {version.sourceLocation} · {version.endpointCount} 个接口
                        </option>
                      ))}
                  </select>
                </label>
              ) : null}
            </section>
          ) : null}
          {sourceMode === 'api' ? (
            <label>
              固定 API 版本
              <select
                aria-label="固定 API 版本"
                value={versionId}
                onChange={(e) => setVersionId(e.target.value)}
                disabled={!versions.length}
              >
                <option value="" disabled>
                  选择已导入的 API
                </option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label || v.sourceLocation || v.id} · {v.endpointCount} 个接口 · {v.id}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {sourceMode === 'api' && !versions.length ? (
            <p>
              先<Link to="/apis">导入 API 契约</Link>，再生成有来源的测试。
            </p>
          ) : null}
          {(sourceMode === 'api' || repositoryVersionId === versionId) && repository?.commit ? (
            <section className="agent-source-evidence" aria-label="仓库来源证据">
              <strong>已固定提交 {repository.commit.slice(0, 12)}</strong>
              <p>
                {repository.repositoryUrl} · {repository.files?.length ?? 0} 个文件 ·{' '}
                {endpoints.length} 个接口
              </p>
              <p className="agent-note">这是静态代码发现，鉴权、异常和业务规则仍需核验。</p>
              <details>
                <summary>查看分析边界与提示（{sourceWarnings.length}）</summary>
                <ul>
                  {sourceWarnings.map((warning, index) => (
                    <li key={`${index}-${warning}`}>{warning}</li>
                  ))}
                </ul>
              </details>
            </section>
          ) : null}
          {(sourceMode === 'api' || repositoryVersionId === versionId) && endpoints.length ? (
            <fieldset className="agent-endpoints">
              <legend>本次接口 · 已选 {endpointIds.length} / 5</legend>
              <input
                aria-label="筛选生成接口"
                value={endpointQuery}
                onChange={(e) => setEndpointQuery(e.target.value)}
                placeholder="搜索方法或路径"
              />
              <div>
                {endpoints
                  .filter((e) =>
                    `${e.method} ${e.path}`.toLowerCase().includes(endpointQuery.toLowerCase()),
                  )
                  .slice(0, 100)
                  .map((endpoint) => (
                    <label key={endpoint.id}>
                      <input
                        type="checkbox"
                        checked={endpointIds.includes(endpoint.id)}
                        disabled={
                          (sourceType === 'code-discovery' && !endpoint.responses?.length) ||
                          (!endpointIds.includes(endpoint.id) && endpointIds.length >= 5)
                        }
                        onChange={(e) =>
                          setEndpointIds((ids) =>
                            e.target.checked
                              ? [...ids, endpoint.id]
                              : ids.filter((id) => id !== endpoint.id),
                          )
                        }
                      />
                      <code>
                        {endpoint.method} {endpoint.path}
                      </code>
                      {sourceType === 'code-discovery' && !endpoint.responses?.length ? (
                        <small>缺少显式响应状态</small>
                      ) : null}
                      {sourceType === 'code-discovery' && endpoint.sourceLocations?.[0] ? (
                        <a
                          href={githubEvidenceUrl(endpoint.sourceLocations[0].location)}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`查看 ${endpoint.method} ${endpoint.path} 的源码`}
                        >
                          源码 ↗
                        </a>
                      ) : null}
                    </label>
                  ))}
              </div>
            </fieldset>
          ) : null}
          <label>
            测试目标
            <textarea
              aria-label="测试目标"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              rows={5}
              maxLength={4096}
            />
          </label>
          <p className="agent-note">
            测试目标及所选接口的路由、参数与结构证据会发送给所选模型；仓库原文不发送。请勿填写密钥或真实用户数据。单次最多生成
            5 条草稿，预算 6 轮 / 120 秒。
          </p>
          <button
            className="button button--primary"
            type="button"
            disabled={
              busy ||
              analyzing ||
              (sourceMode === 'repository' &&
                (!repositoryVersionId || repositoryVersionId !== versionId)) ||
              !capability?.available ||
              !versionId ||
              !endpointIds.length ||
              endpointVersionId !== versionId ||
              !objective.trim()
            }
            onClick={() => void start()}
          >
            生成待审草稿 <ArrowRight size={17} />
          </button>
        </section>
        <aside className="paper-panel agent-runtime" aria-label="生成服务状态">
          <span className="agent-step">02 · 独立生成，明确边界</span>
          <h3>
            {capability?.available
              ? '生成服务在线'
              : capability?.configured
                ? '等待 Worker 上线'
                : '生成服务未连接'}
          </h3>
          {model ? (
            <dl>
              <div>
                <dt>底层框架</dt>
                <dd>Pi Agent Core {model.harnessVersion}</dd>
              </div>
              <div>
                <dt>模型</dt>
                <dd>
                  {model.provider} / {model.model}
                </dd>
              </div>
              <div>
                <dt>交付</dt>
                <dd>可编辑草稿 + 契约来源 + 生成依据</dd>
              </div>
            </dl>
          ) : (
            <p>
              需要为当前工作区配置独立 AI
              Worker。服务上线后这里会自动更新；规则生成仍可在接口管理使用。
            </p>
          )}
          <div className="safety-row">
            <ShieldCheck size={20} />
            <span>生成 → 审阅 → 发布 → 执行 → 证据。生成服务只能提交草稿。</span>
          </div>
        </aside>
      </div>
      <section className="paper-panel agent-jobs" aria-label="生成任务">
        <div className="agent-jobs-heading">
          <h3>生成任务</h3>
          <span>保留最近 50 条工作区任务中的 Pi 记录</span>
        </div>
        {!jobs.length ? (
          <div className="agent-empty">
            <strong>还没有生成任务</strong>
            <p>从一个关键接口开始，先确认预期，再积累可信的回归资产。</p>
          </div>
        ) : (
          jobs.map((job) => (
            <article className="agent-job" key={job.id}>
              <div>
                <strong>{job.config?.objective || '契约回归草稿'}</strong>
                <small>
                  {job.id} · {new Date(job.createdAt).toLocaleString('zh-CN')} · 已领取{' '}
                  {job.attempt ?? 0} 次
                </small>
                {job.errorCode ? (
                  <p role="status">
                    {job.errorCode === 'MODEL_FAILED'
                      ? '模型未完成生成，请检查服务端模型配置后重试。'
                      : job.errorCode === 'TIMEOUT'
                        ? '生成超时，可缩小任务后重试。'
                        : `任务失败：${job.errorCode}`}
                  </p>
                ) : null}
                {job.status === 'completed' && job.draftCount !== undefined ? (
                  <small>
                    产出 {job.draftCount} 条草稿 · 覆盖 {job.coveredEndpointCount ?? 0} /{' '}
                    {job.config?.endpointIds?.length ?? '—'} 个所选接口
                  </small>
                ) : null}
              </div>
              <span className={`agent-state agent-state--${job.status}`}>
                {statuses[job.status]}
              </span>
              <div className="agent-job-actions">
                {job.status === 'completed' ? (
                  <Link
                    className="button button--primary button--sm"
                    to={`/cases?generationJobId=${job.id}`}
                  >
                    审阅草稿 <ArrowRight size={14} />
                  </Link>
                ) : null}
                {['pending', 'running'].includes(job.status) ? (
                  <button
                    className="button button--outline button--sm"
                    disabled={busy}
                    type="button"
                    onClick={() => void change(job.id, 'cancel')}
                  >
                    取消
                  </button>
                ) : null}
                {['failed', 'cancelled'].includes(job.status) ? (
                  <button
                    className="button button--outline button--sm"
                    disabled={busy || !capability?.available}
                    type="button"
                    onClick={() => void change(job.id, 'retry')}
                  >
                    重试
                  </button>
                ) : null}
              </div>
            </article>
          ))
        )}
      </section>
    </main>
  );
}
