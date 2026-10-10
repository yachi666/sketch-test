import { useEffect, useRef, useState } from 'react';
import { type AgentExecution, type AgentSnapshot, cpClient } from '../../lib/cp-client';
import { AgentAvatar } from './index';

const states: Record<string, string> = {
  pending: '等待领取',
  running: '正在生成',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};
const types: Record<string, string> = {
  queued: '任务已创建',
  claimed: 'Worker 已领取',
  'model.completed': '模型调用',
  'tool.completed': '工具调用',
  completed: '草稿已保存',
  failed: '执行失败',
  cancelled: '已取消',
  'retry.requested': '重试已请求',
};
export function ExecutionDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<AgentExecution | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      old?.focus();
    };
  }, []);
  useEffect(() => {
    let active = true;
    const load = () =>
      cpClient
        .execution(id)
        .then((d) => {
          if (active) {
            setData(d);
            setError('');
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id]);
  return (
    <dialog
      ref={ref}
      className="execution-dialog"
      aria-labelledby="execution-title"
      onCancel={onClose}
    >
      <header>
        <h2 id="execution-title">Agent 执行详情</h2>
        <button className="button" type="button" onClick={onClose}>
          关闭
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {!data ? (
        <p>读取执行记录…</p>
      ) : (
        <>
          <p>
            <code>{data.id}</code> · 第 {data.attempt ?? 0} 次领取{' '}
            <span className="execution-status">{states[data.status] ?? data.status}</span>
          </p>
          <div className="agent-source-card">
            <header>
              {data.agent && <AgentAvatar agent={data.agent} />}
              <strong>
                {data.agent
                  ? `${data.agent.name} · v${data.agent.version}`
                  : '历史记录未保存 Agent 身份'}
              </strong>
            </header>
            <dl>
              <dt>厂商 / 模型</dt>
              <dd>
                {data.config.provider} / {data.config.model}
              </dd>
              <dt>模型底层快照</dt>
              <dd>{data.modelSnapshot ?? '厂商未返回'}</dd>
              <dt>Worker</dt>
              <dd>{data.workerId ?? '尚未领取'}</dd>
              <dt>开始 / 完成</dt>
              <dd>
                {new Date(data.createdAt).toLocaleString()} /{' '}
                {data.completedAt ? new Date(data.completedAt).toLocaleString() : '尚未完成'}
              </dd>
              <dt>输入哈希</dt>
              <dd>{data.inputHash ?? '未记录'}</dd>
            </dl>
          </div>
          {data.errorCode && <p role="alert">失败原因：{data.errorCode}</p>}
          <section>
            <h3>执行过程</h3>
            <p>任务状态实时更新；模型与工具明细在本次执行完成后提交。不记录模型内部推理。</p>
            {!data.events.length ? (
              <p>此历史任务未采集事件。</p>
            ) : (
              <ol>
                {data.events.map((e) => (
                  <li key={e.id}>
                    <strong>
                      {types[e.type] ?? e.type}
                      {e.payload.tool ? ` · ${e.payload.tool}` : ''}
                    </strong>{' '}
                    · 尝试 {e.attempt}
                    {e.payload.success === false ? ' · 未成功' : ''}
                    <small>
                      {new Date(e.payload.at ?? e.createdAt).toLocaleString()}
                      {e.payload.durationMs !== undefined ? ` · ${e.payload.durationMs} ms` : ''}
                      {e.payload.inputTokens !== undefined
                        ? ` · 输入 ${e.payload.inputTokens} / 输出 ${e.payload.outputTokens} tokens`
                        : ''}
                      {e.payload.errorCode ? ` · ${e.payload.errorCode}` : ''}
                    </small>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section>
            <h3>原始生成产出</h3>
            {data.outputs.length ? (
              data.outputs.map((o) => (
                <details key={o.id}>
                  <summary>
                    {o.id} · {o.status}
                  </summary>
                  {o.originalDefinition ? (
                    <pre>{JSON.stringify(o.originalDefinition, null, 2)}</pre>
                  ) : (
                    <p>此历史产出未独立保存原文，无法保证当前内容等于生成时内容。</p>
                  )}
                </details>
              ))
            ) : (
              <p>尚无产出</p>
            )}
          </section>
          <details>
            <summary>查看当时的 Agent 配置（只读）</summary>
            {data.agent ? (
              <pre>{JSON.stringify(data.agent, null, 2)}</pre>
            ) : (
              <p>历史任务未记录配置快照。</p>
            )}
          </details>
        </>
      )}
    </dialog>
  );
}
export function CaseProvenance({ id }: { id: string }) {
  const [sources, setSources] = useState<
      Awaited<ReturnType<typeof cpClient.caseProvenance>>['sources']
    >([]),
    [error, setError] = useState(''),
    [trace, setTrace] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setSources([]);
    setError('');
    void cpClient
      .caseProvenance(id)
      .then((r) => {
        if (active) setSources(r.sources);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id]);
  return (
    <>
      {error && (
        <p className="agent-source-error" role="alert">
          生成来源读取失败：{error}
        </p>
      )}
      {sources.map((s) => {
        const a = s.sourceInfo['agent'] as AgentSnapshot | undefined;
        return (
          <section className="agent-source-card" key={s.draftId}>
            <header>
              {a && <AgentAvatar agent={a} />}
              <h3>生成来源</h3>
            </header>
            <p>{a ? `${a.name} · v${a.version}` : '历史记录未保存 Agent 身份'}</p>
            <p>
              {String(s.sourceInfo['provider'] ?? s.sourceInfo['strategy'] ?? '未记录')} /{' '}
              {String(s.sourceInfo['model'] ?? '未记录模型')}
            </p>
            <p>
              <code>{s.jobId}</code> · 人工审核
              {s.reviewedAt ? ` ${new Date(s.reviewedAt).toLocaleString()}` : ''}
            </p>
            <button
              type="button"
              className="button button--outline"
              onClick={() => setTrace(s.jobId)}
            >
              查看 Agent 执行详情
            </button>
          </section>
        );
      })}
      {trace && <ExecutionDrawer id={trace} onClose={() => setTrace(null)} />}
    </>
  );
}
