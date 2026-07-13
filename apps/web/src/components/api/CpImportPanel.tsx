import { CheckCircle, CloudArrowDown, Database, Warning, X } from '@phosphor-icons/react';
import { useState } from 'react';
import { cpClient, getControlPlaneBaseUrl } from '../../lib/cp-client';

interface Props {
  onImport: () => void;
}

const CP_URL = getControlPlaneBaseUrl();

export function CpImportPanel({ onImport }: Props) {
  const [url, setUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    apiVersionId: string;
    endpointCount: number;
    diagnostics: Array<{ level: string; message: string }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleImport = async () => {
    setImporting(true);
    setError(null);
    setResult(null);

    try {
      const imported = await cpClient.importSpec('url', url);
      setResult(imported);
      onImport();
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败');
    }
    setImporting(false);
  };

  return (
    <section
      style={{
        marginTop: 24,
        padding: 24,
        border: '1px solid var(--border-color)',
        borderRadius: 12,
        background: '#fafbff',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Database size={20} style={{ color: '#555' }} />
        <h3 style={{ margin: 0, fontSize: 16 }}>从控制面导入</h3>
        <code
          style={{
            fontSize: 11,
            color: '#888',
            background: '#eee',
            padding: '2px 6px',
            borderRadius: 4,
          }}
        >
          {CP_URL}
        </code>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="OpenAPI spec URL"
          style={{
            flex: 1,
            padding: '8px 12px',
            border: '1px solid var(--border-color)',
            borderRadius: 8,
            fontSize: 14,
            fontFamily: 'monospace',
          }}
        />
        <button
          type="button"
          className="button button--primary"
          onClick={handleImport}
          disabled={importing || url.trim().length === 0}
          style={{ whiteSpace: 'nowrap' }}
        >
          <CloudArrowDown size={18} />
          {importing ? '导入中...' : '导入'}
        </button>
      </div>

      {error && (
        <div
          style={{
            marginTop: 12,
            padding: '8px 12px',
            background: '#fff0f0',
            borderRadius: 6,
            color: '#c00',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <X size={16} />
          {error}
        </div>
      )}

      {result && (
        <div
          style={{
            marginTop: 12,
            padding: '12px',
            background: '#f0fff0',
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <CheckCircle size={16} style={{ color: '#4caf50' }} weight="fill" />
            <strong>导入成功</strong>
            <code style={{ color: '#666', fontSize: 11 }}>{result.apiVersionId}</code>
          </div>
          <span>
            {result.endpointCount} 个端点
            {result.diagnostics.length > 0 && (
              <>，{result.diagnostics.filter((d) => d.level === 'warning').length} 个警告</>
            )}
          </span>
          {result.diagnostics
            .filter((d) => d.level === 'warning')
            .slice(0, 3)
            .map((d, i) => (
              <div key={i} style={{ marginTop: 4, color: '#996', fontSize: 12 }}>
                <Warning size={12} style={{ marginRight: 4 }} />
                {d.message}
              </div>
            ))}
        </div>
      )}
    </section>
  );
}
