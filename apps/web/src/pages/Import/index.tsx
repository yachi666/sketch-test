import {
  ArrowClockwise,
  ArrowRight,
  CheckCircle,
  FileCode,
  GitBranch,
  LinkSimple,
  MagnifyingGlass,
  ShieldCheck,
  SpinnerGap,
  WarningCircle,
} from '@phosphor-icons/react';
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorCallout } from '../../components/shared/ErrorCallout';
import { type ApiVersionSummary, cpClient, type ImportResult } from '../../lib/cp-client';
import { useAuthStore } from '../../stores/authStore';
import './import-center.css';

function versionName(version: ApiVersionSummary) {
  const source = version.label || version.sourceLocation;
  try {
    const url = new URL(source);
    if (version.sourceType === 'code-discovery' && url.hostname === 'github.com') {
      return url.pathname.split('/').filter(Boolean).slice(0, 2).join('/') || url.hostname;
    }
    return url.pathname.split('/').filter(Boolean).at(-1) || url.hostname;
  } catch {
    return source || version.id;
  }
}

function sourceLabel(type: string) {
  return (
    (
      {
        'code-discovery': '代码发现',
        url: 'URL 导入',
        openapi: 'OpenAPI',
        raml: 'RAML',
        postman: 'Postman',
        har: 'HAR',
      } as Record<string, string>
    )[type] ?? type
  );
}

function displayDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '时间未知'
    : new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date);
}

export function ImportPage() {
  const workspaceId = useAuthStore((state) => state.user?.workspaceId);
  return <ImportCenter key={workspaceId ?? 'unconnected'} />;
}

function ImportCenter() {
  const [sourceUrl, setSourceUrl] = useState('');
  const [versions, setVersions] = useState<ApiVersionSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [success, setSuccess] = useState<ImportResult | null>(null);
  const [query, setQuery] = useState('');
  const mounted = useRef(true);
  const requestId = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setListError(null);
    try {
      const result = await cpClient.listApiVersions();
      if (mounted.current && id === requestId.current) setVersions(result.apiVersions);
    } catch (reason) {
      if (mounted.current && id === requestId.current)
        setListError(reason instanceof Error ? reason.message : '无法读取导入记录。');
    } finally {
      if (mounted.current && id === requestId.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      requestId.current++;
    };
  }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setImportError(null);
    setSuccess(null);
    const location = sourceUrl.trim();
    try {
      const url = new URL(location);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
        throw new Error('invalid');
    } catch {
      setImportError('请输入完整的 HTTP 或 HTTPS 地址，地址中不要包含账号或密码。');
      input.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const result = await cpClient.importSpec('url', location);
      if (!mounted.current) return;
      setSuccess(result);
      setSourceUrl('');
      setQuery('');
      await load();
    } catch (reason) {
      if (mounted.current)
        setImportError(
          reason instanceof Error ? reason.message : '导入失败，请检查来源地址后重试。',
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const ordered = useMemo(
    () => [...versions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [versions],
  );
  const visible = ordered.filter((version) =>
    `${versionName(version)} ${version.sourceLocation} ${version.id} ${sourceLabel(version.sourceType)}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  return (
    <main className="page-view intake-page">
      <header className="intake-intro">
        <div>
          <span className="eyebrow">接入来源 · 留下最初的依据</span>
          <h1>让接口有来处，让测试有起点。</h1>
          <p>从一份接口定义开始，把请求与响应的约定，整理为可追溯的测试来源。</p>
        </div>
        <Link to="/apis" className="button button--ghost">
          浏览接口目录 <ArrowRight size={17} />
        </Link>
      </header>
      <div className="intake-start">
        <section className="intake-source" aria-labelledby="intake-source-title">
          <div className="intake-source-heading">
            <span className="intake-icon">
              <LinkSimple size={24} />
            </span>
            <div>
              <h2 id="intake-source-title">从 URL 导入 OpenAPI</h2>
              <p>提供可访问的 JSON 或 YAML 文档地址。</p>
            </div>
            <span className="intake-tag">URL 导入</span>
          </div>
          <form onSubmit={(event) => void submit(event)} noValidate>
            <label htmlFor="import-url">OpenAPI 文档地址</label>
            <div className="intake-input-row">
              <input
                ref={input}
                id="import-url"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={sourceUrl}
                disabled={busy}
                aria-invalid={Boolean(importError)}
                aria-describedby={
                  importError ? 'intake-url-hint intake-url-error' : 'intake-url-hint'
                }
                onChange={(event) => {
                  setSourceUrl(event.target.value);
                  setImportError(null);
                }}
                placeholder="https://example.com/openapi.json"
              />
              <button
                className="button button--primary"
                type="submit"
                disabled={busy || !sourceUrl.trim()}
              >
                {busy ? (
                  <SpinnerGap className="intake-spinner" size={17} />
                ) : (
                  <ArrowRight size={17} />
                )}
                {busy ? '正在导入…' : '导入接口'}
              </button>
            </div>
            <p id="intake-url-hint" className="intake-hint">
              请使用文档的直接地址；系统会校验内容、解析接口并保存版本。
            </p>
            {busy && (
              <p className="intake-progress" role="status">
                正在读取与解析来源，请稍候…
              </p>
            )}
            {importError && (
              <div id="intake-url-error">
                <ErrorCallout title="导入未完成" message={importError} />
              </div>
            )}
          </form>
          <div className="intake-source-footer">
            <ShieldCheck size={17} />
            <span>保存后的接口版本保持不变，后续测试可追溯到同一份来源。</span>
          </div>
        </section>
        <aside className="intake-guide" aria-label="导入指引">
          <h2>从来源，到可用的接口</h2>
          <ol>
            <li>
              <b>01</b>
              <div>
                <strong>读取来源</strong>
                <span>提供 OpenAPI 文档地址。</span>
              </div>
            </li>
            <li>
              <b>02</b>
              <div>
                <strong>解析与保存</strong>
                <span>整理接口，留下版本与诊断信息。</span>
              </div>
            </li>
            <li>
              <b>03</b>
              <div>
                <strong>继续测试旅程</strong>
                <span>前往接口目录，查看接口或生成草稿。</span>
              </div>
            </li>
          </ol>
          <Link to="/agent">
            <GitBranch size={17} />
            <span>
              来源是 GitHub 仓库？<small>前往智能生成，分析代码接口</small>
            </span>
            <ArrowRight size={16} />
          </Link>
        </aside>
      </div>
      {success && (
        <section className="intake-success" role="status" aria-label="导入成功">
          <CheckCircle size={23} weight="fill" />
          <div>
            <strong>导入完成，已解析 {success.endpointCount} 个接口</strong>
            <p>
              版本 <code>{success.apiVersionId}</code> 已保存，可前往接口目录继续。
            </p>
            {success.diagnostics.length > 0 && (
              <details>
                <summary>查看 {success.diagnostics.length} 条导入诊断</summary>
                <ul>
                  {success.diagnostics.map((diagnostic, index) => (
                    <li key={`${diagnostic.level}-${index}`}>{diagnostic.message}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          <Link to="/apis">
            查看接口 <ArrowRight size={16} />
          </Link>
        </section>
      )}
      <section className="intake-history" aria-labelledby="intake-history-title">
        <header className="intake-history-heading">
          <div>
            <h2 id="intake-history-title">
              已导入版本{' '}
              <span>
                {loading && !versions.length
                  ? '—'
                  : listError && !versions.length
                    ? '未知'
                    : versions.length}
              </span>
            </h2>
            <p>每份来源，留一份记录。包括 URL 导入与仓库分析保存的接口版本。</p>
          </div>
          <button
            className="button button--ghost button--sm"
            type="button"
            disabled={loading || busy}
            onClick={() => void load()}
          >
            <ArrowClockwise size={16} className={loading ? 'intake-spinner' : undefined} />
            刷新记录
          </button>
        </header>
        <div className="intake-history-toolbar">
          <label>
            <MagnifyingGlass size={17} />
            <input
              type="search"
              aria-label="搜索已导入版本"
              placeholder="搜索名称、来源地址或版本 ID"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <span>最近导入在前</span>
        </div>
        {listError && (
          <ErrorCallout
            title="导入记录读取失败"
            message={`${listError}${versions.length ? ' 当前保留上次读取的记录。' : ''}`}
            onRetry={load}
            retryLabel="重新读取"
          />
        )}
        {loading && (
          <p className="intake-loading" role="status">
            <SpinnerGap className="intake-spinner" size={18} />
            正在读取导入记录…
          </p>
        )}
        <div className="intake-records" aria-busy={loading}>
          {visible.map((version) => (
            <article className="intake-record" key={version.id} aria-label={versionName(version)}>
              <div className="intake-record-main">
                <span
                  className={`intake-record-icon ${version.sourceType === 'code-discovery' ? 'intake-record-icon--code' : ''}`}
                >
                  {version.sourceType === 'code-discovery' ? (
                    <GitBranch size={22} />
                  ) : (
                    <FileCode size={22} />
                  )}
                </span>
                <div className="intake-record-identity">
                  <h3 title={versionName(version)}>{versionName(version)}</h3>
                  <p title={version.sourceLocation}>{version.sourceLocation}</p>
                  <span className="intake-source-type">{sourceLabel(version.sourceType)}</span>
                </div>
                <div className="intake-record-metric">
                  <strong>{version.endpointCount}</strong>
                  <span>接口</span>
                </div>
                <div className="intake-record-time">
                  <time dateTime={version.createdAt}>{displayDate(version.createdAt)}</time>
                  <span>导入时间</span>
                </div>
                <span className="intake-imported">
                  <CheckCircle size={15} weight="fill" />
                  已导入
                </span>
              </div>
              <div className="intake-record-footer">
                <code title={version.id}>{version.id}</code>
                <details>
                  <summary>
                    版本详情
                    {version.diagnosticCount > 0 && (
                      <span className="intake-diagnostic-count">
                        <WarningCircle size={13} />
                        {version.diagnosticCount} 条诊断
                      </span>
                    )}
                  </summary>
                  <dl>
                    <div>
                      <dt>完整来源</dt>
                      <dd>{version.sourceLocation}</dd>
                    </div>
                    <div>
                      <dt>版本 ID</dt>
                      <dd>{version.id}</dd>
                    </div>
                    <div>
                      <dt>内容指纹</dt>
                      <dd>{version.contentHash}</dd>
                    </div>
                    <div>
                      <dt>导入诊断</dt>
                      <dd>{version.diagnosticCount} 条；已导入表示版本已保存，不代表测试通过。</dd>
                    </div>
                  </dl>
                </details>
              </div>
            </article>
          ))}
          {!loading && !listError && !versions.length && (
            <div className="intake-empty">
              <FileCode size={30} />
              <h3>第一份接口来源，等待从这里开始。</h3>
              <p>导入一份 OpenAPI 文档，保存的版本就会出现在这里。</p>
              <button className="text-button" type="button" onClick={() => input.current?.focus()}>
                填写来源地址 <ArrowRight size={15} />
              </button>
            </div>
          )}
          {!loading && versions.length > 0 && !visible.length && (
            <div className="intake-empty">
              <MagnifyingGlass size={27} />
              <h3>没有找到匹配的版本</h3>
              <p>换个关键词，或查看全部导入记录。</p>
              <button className="text-button" type="button" onClick={() => setQuery('')}>
                清除搜索
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
