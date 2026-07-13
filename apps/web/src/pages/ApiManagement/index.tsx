import { ArrowClockwise, Database, PlugsConnected, Warning } from '@phosphor-icons/react';
import { CpImportPanel } from '../../components/api/CpImportPanel';
import { useApiVersions } from '../../hooks/useApi';

export function ApiManagementPage() {
  const { data: apiVersions, loading, error, refetch } = useApiVersions();

  return (
    <main className="page-view">
      <div className="page-intro">
        <div>
          <span className="eyebrow">CANONICAL API CATALOG</span>
          <h2>接口资产</h2>
          <p>以下内容直接来自 Control Plane，不使用浏览器内置样例数据。</p>
        </div>
        <button className="button button--outline" type="button" onClick={() => void refetch()}>
          <ArrowClockwise size={18} />
          刷新
        </button>
      </div>

      <CpImportPanel onImport={() => void refetch()} />

      {error ? (
        <section className="paper-panel" role="alert">
          <div className="section-heading">
            <Warning size={22} weight="duotone" />
            <div>
              <h3>无法连接 Control Plane</h3>
              <p>{error}</p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="table-panel" aria-busy={loading}>
        <div className="section-heading">
          <div>
            <span className="eyebrow">IMMUTABLE VERSIONS</span>
            <h3>API Versions</h3>
          </div>
          <span className="status-badge">{apiVersions?.length ?? 0} 个版本</span>
        </div>

        {loading ? <p>正在从 Control Plane 加载…</p> : null}
        {!loading && !error && apiVersions?.length === 0 ? (
          <div className="empty-state">
            <Database size={42} weight="duotone" />
            <h3>尚未导入 API</h3>
            <p>使用上方导入表单创建第一个不可变 ApiVersion。</p>
          </div>
        ) : null}

        {apiVersions && apiVersions.length > 0 ? (
          <div className="data-table">
            <div className="data-row data-row--head">
              <span>来源</span>
              <span>格式</span>
              <span>端点</span>
              <span>内容哈希</span>
              <span>创建时间</span>
            </div>
            {apiVersions.map((version) => (
              <div className="data-row" key={version.id}>
                <span>
                  <PlugsConnected size={17} />
                  <strong>{version.sourceLocation}</strong>
                  <code>{version.id}</code>
                </span>
                <span>{version.sourceType}</span>
                <span>{version.endpointCount ?? '—'}</span>
                <span>
                  <code title={version.contentHash}>{version.contentHash.slice(0, 12)}…</code>
                </span>
                <span>{new Date(version.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}
