import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { cpClient, type TestCaseVersion } from '../../lib/cp-client';
import { useAuthStore } from '../../stores/authStore';

export function RunPublishedTest({ version }: { version: TestCaseVersion }) {
  const workspaceId = useAuthStore((s) => s.user?.workspaceId);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [environmentId, setEnvironmentId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setOpen(false);
    setConfirmed(false);
    setError(null);
  }, [version.id]);
  const show = async () => {
    if (!workspaceId) return;
    setOpen(true);
    setBusy(true);
    setError(null);
    try {
      const { environments } = await cpClient.listEnvironments(workspaceId);
      const all = (
        await Promise.all(
          environments.map(async (env) =>
            (
              await cpClient.listEnvironmentVersions(env.id)
            ).versions
              .filter((v) => v.baseUrl)
              .map((v) => ({
                id: v.id,
                label: `${env.name} · v${v.version} · ${v.baseUrl}`,
              })),
          ),
        )
      ).flat();
      setOptions(all);
      setEnvironmentId(all[0]?.id ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法加载执行环境');
    } finally {
      setBusy(false);
    }
  };
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await cpClient.runPublishedTest(version.id, environmentId, confirmed);
      navigate(`/reports/${result.runId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建运行失败');
    } finally {
      setBusy(false);
    }
  };
  if (!open)
    return (
      <button className="button button--primary" type="button" onClick={() => void show()}>
        运行此版本
      </button>
    );
  return (
    <section className="draft-review" aria-label="执行已发布用例">
      <h3>固定执行环境</h3>
      <p>执行 {version.id}，运行中保留环境版本和请求证据。</p>
      {error ? <p role="alert">{error}</p> : null}
      <label>
        环境版本
        <select
          aria-label="执行环境版本"
          value={environmentId}
          onChange={(e) => setEnvironmentId(e.target.value)}
        >
          {!options.length ? (
            <option value="">尚无环境版本</option>
          ) : (
            options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))
          )}
        </select>
      </label>
      {!busy && !options.length ? (
        <p>
          <Link to="/environments">创建执行环境</Link>，然后返回此用例。
        </p>
      ) : null}
      {version.sideEffect !== 'read-only' ? (
        <label>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />{' '}
          此测试会修改目标服务数据，我已确认测试环境与清理安排。
        </label>
      ) : null}
      <div className="draft-review-actions">
        <button
          className="button button--primary"
          type="button"
          disabled={busy || !environmentId || (version.sideEffect !== 'read-only' && !confirmed)}
          onClick={() => void run()}
        >
          开始执行
        </button>
        <button className="button button--outline" type="button" onClick={() => setOpen(false)}>
          取消
        </button>
      </div>
    </section>
  );
}
