import { Check, PencilSimple, Plus, Stack, TrashSimple } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { ErrorCallout } from '../../components/shared/ErrorCallout';
import { useAuthStore } from '../../stores/authStore';
import { useEnvironmentStore } from '../../stores/environmentStore';
import { useUIStore } from '../../stores/uiStore';
import type { Environment } from '../../types';
import { DeleteEnvironmentDialog } from './DeleteEnvironmentDialog';
import { EnvironmentDialog } from './EnvironmentDialog';

function toneForEnv(env: Environment): 'brown' | 'amber' | 'green' {
  if (env.tags?.includes('生产')) return 'brown';
  if (env.tags?.includes('预发')) return 'amber';
  return 'green';
}

export default function EnvironmentView() {
  const { environments, activeEnvironmentId, setActiveEnvironmentId } = useEnvironmentStore();
  const versions = useEnvironmentStore((s) => s.versions);
  const notify = useUIStore((s) => s.notify);
  const workspaceId = useAuthStore((s) => s.user?.workspaceId);
  const fetchFromServer = useEnvironmentStore((s) => s.fetchFromServer);
  const loading = useEnvironmentStore((s) => s.loading);
  const error = useEnvironmentStore((s) => s.error);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create');
  const [editingEnv, setEditingEnv] = useState<Environment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Environment | null>(null);

  const envVarCount = (envId: string) => Object.keys(versions[envId]?.[0]?.variables ?? {}).length;
  const _activeEnv = environments.find((e) => e.id === activeEnvironmentId);
  useEffect(() => {
    if (workspaceId) void fetchFromServer(workspaceId);
  }, [fetchFromServer, workspaceId]);

  return (
    <main className="page-view">
      <div className="page-actions-row">
        <button
          className="button button--primary"
          type="button"
          onClick={() => {
            setDialogMode('create');
            setEditingEnv(null);
            setDialogOpen(true);
          }}
        >
          <Plus size={18} />
          新建环境
        </button>
      </div>

      {error ? (
        <ErrorCallout
          title="环境数据暂不可用"
          message={error}
          onRetry={() => (workspaceId ? fetchFromServer(workspaceId) : undefined)}
        />
      ) : null}

      {loading && environments.length === 0 ? (
        <p className="page-loading-note">正在同步环境…</p>
      ) : null}

      {!loading && !error && environments.length === 0 ? (
        <section className="paper-panel empty-module">
          <Stack size={40} weight="duotone" />
          <h3>还没有执行环境</h3>
          <p>添加测试服务的基础地址和运行参数。每次执行会固定环境版本，便于复现。</p>
          <button
            className="button button--primary"
            type="button"
            onClick={() => {
              setDialogMode('create');
              setEditingEnv(null);
              setDialogOpen(true);
            }}
          >
            创建第一个环境
          </button>
        </section>
      ) : null}
      <section className="env-grid">
        {environments.map((env) => {
          const tone = toneForEnv(env);
          const isActive = env.id === activeEnvironmentId;
          return (
            <div
              className={`env-card env-card--${tone} ${isActive ? 'env-card--active' : ''}`}
              key={env.id}
            >
              <div className="env-card-header">
                <span>
                  <Stack size={24} weight="duotone" />
                </span>
                <div>
                  <strong>{env.name}</strong>
                  {env.description ? <small>{env.description}</small> : null}
                </div>
              </div>
              <div className="env-card-body">
                <span>{envVarCount(env.id)} 个运行变量</span>
                {(env.tags || []).map((tag) => (
                  <span className="env-tag" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
              <div className="env-card-actions">
                {isActive ? (
                  <span className="status-badge status-badge--passed">
                    <Check size={14} /> 当前
                  </span>
                ) : (
                  <button
                    className="button button--outline button--sm"
                    type="button"
                    onClick={() => {
                      setActiveEnvironmentId(env.id);
                      notify(`切换到 ${env.name}`);
                    }}
                  >
                    激活
                  </button>
                )}
                <button
                  className="icon-button"
                  type="button"
                  aria-label="编辑"
                  onClick={() => {
                    setEditingEnv(env);
                    setDialogMode('edit');
                    setDialogOpen(true);
                  }}
                >
                  <PencilSimple size={16} />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="删除"
                  onClick={() => setDeleteTarget(env)}
                >
                  <TrashSimple size={16} />
                </button>
              </div>
            </div>
          );
        })}
      </section>

      <EnvironmentDialog
        open={dialogOpen}
        mode={dialogMode}
        environment={editingEnv}
        onClose={() => setDialogOpen(false)}
      />
      <DeleteEnvironmentDialog
        open={deleteTarget !== null}
        environment={deleteTarget}
        onClose={() => setDeleteTarget(null)}
      />
    </main>
  );
}
