import { useState, useCallback } from 'react';
import { Play, CheckCircle, XCircle, Clock, ArrowsClockwise } from '@phosphor-icons/react';
import { cpClient, type RunReport } from '../../lib/cp-client';

const FIXTURE_URL = 'http://localhost:3800/openapi.json';

export function LiveRunPanel() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<RunReport | null>(null);
  const [status, setStatus] = useState<string>('');

  const runTest = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReport(null);

    try {
      setStatus('导入 OpenAPI spec...');
      const imported = await cpClient.importSpec('url', FIXTURE_URL);
      setStatus(`导入成功 (${imported.endpointCount} 端点)，创建执行计划...`);

      const { runId } = await cpClient.createRun(imported.apiVersionId);
      setStatus(`Run ${runId} 已创建，等待执行...`);

      // Poll for completion
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const detail = await cpClient.getRun(runId);
        if (detail.run.status === 'passed' || detail.run.status === 'failed') {
          const runReport = await cpClient.getReport(runId);
          setReport(runReport);
          setStatus('');
          setLoading(false);
          return;
        }
        setStatus(`Run ${runId} 执行中... (${detail.run.status})`);
      }

      setError('执行超时（30秒）');
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    }
    setLoading(false);
    setStatus('');
  }, []);

  return (
    <section
      style={{
        marginTop: 32,
        padding: 24,
        border: '1px solid var(--border-color)',
        borderRadius: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 18 }}>🔬 M0 垂直链路验证</h3>
        <button
          type="button"
          className="button button--primary"
          onClick={runTest}
          disabled={loading}
        >
          {loading ? (
            <ArrowsClockwise size={18} style={{ animation: 'spin 1s linear infinite' }} />
          ) : (
            <Play size={18} />
          )}
          {loading ? status : '导入并执行'}
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: 12,
            background: '#fff0f0',
            borderRadius: 8,
            color: '#c00',
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      {report && (
        <div>
          <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
            <span
              style={{
                padding: '4px 12px',
                borderRadius: 6,
                background: report.run.status === 'passed' ? '#e8f5e9' : '#ffebee',
                color: report.run.status === 'passed' ? '#2e7d32' : '#c62828',
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              {report.run.status === 'passed' ? (
                <CheckCircle size={14} weight="fill" style={{ marginRight: 4 }} />
              ) : (
                <XCircle size={14} weight="fill" style={{ marginRight: 4 }} />
              )}
              {report.run.status === 'passed' ? '全部通过' : '失败'}
            </span>
            <code style={{ fontSize: 13 }}>Run: {report.run.id}</code>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {report.steps.map((step) => (
              <div
                key={step.stepIndex}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '8px 12px',
                  borderRadius: 8,
                  background:
                    step.status === 'passed'
                      ? '#f8fdf8'
                      : step.status === 'failed'
                        ? '#fef8f8'
                        : '#f8f8f8',
                  border: '1px solid var(--border-color)',
                }}
              >
                <span
                  style={{
                    width: 24,
                    height: 24,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 12,
                    background: '#eee',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {step.stepIndex + 1}
                </span>
                <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>
                  {step.status === 'passed' ? (
                    <CheckCircle size={16} weight="fill" style={{ color: '#4caf50' }} />
                  ) : step.status === 'failed' ? (
                    <XCircle size={16} weight="fill" style={{ color: '#f44336' }} />
                  ) : (
                    <Clock size={16} weight="fill" style={{ color: '#999' }} />
                  )}{' '}
                  Step {step.stepIndex}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    padding: '2px 8px',
                    borderRadius: 4,
                    background:
                      step.status === 'passed'
                        ? '#e8f5e9'
                        : step.status === 'failed'
                          ? '#ffebee'
                          : '#f5f5f5',
                    color:
                      step.status === 'passed'
                        ? '#2e7d32'
                        : step.status === 'failed'
                          ? '#c62828'
                          : '#999',
                  }}
                >
                  {step.status}
                </span>
                <code style={{ fontSize: 12, color: '#666' }}>
                  {step.durationMs != null ? `${step.durationMs}ms` : '—'}
                </code>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
