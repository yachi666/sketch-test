import { Play, Warning } from '@phosphor-icons/react';
import { type FormEvent, useState } from 'react';
import { cpClient } from '../../lib/cp-client';
import { useAuthStore } from '../../stores/authStore';

interface PublishedResult {
  workflowId: string;
  workflowVersionId: string;
  runId: string;
  planHash: string;
}

export function WorkflowsPage() {
  const workspaceId = useAuthStore((state) => state.user?.workspaceId ?? '');
  const [name, setName] = useState('');
  const [definition, setDefinition] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PublishedResult | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const parsed = JSON.parse(definition) as Record<string, unknown>;
      const created = await cpClient.createWorkflow(workspaceId.trim(), name.trim());
      const draft = await cpClient.saveWorkflowDraft(created.workflow.id, parsed);
      const published = await cpClient.publishWorkflowVersion(draft.version.id);
      if (!published.published) throw new Error('Control Plane 拒绝发布该流程');
      const run = await cpClient.createRunFromWorkflow(published.version.id);
      setResult({
        workflowId: created.workflow.id,
        workflowVersionId: published.version.id,
        runId: run.runId,
        planHash: published.plan.planHash,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '流程创建失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page-view">
      <div className="page-intro">
        <div>
          <span className="eyebrow">PUBLISH & EXECUTE</span>
          <h2>流程执行</h2>
          <p>定义会保存为不可变 WorkflowVersion，经编译发布后交给独立 Runner。</p>
        </div>
      </div>

      <form className="paper-panel form-stack" onSubmit={(event) => void submit(event)}>
        <label>
          流程名称
          <input
            className="text-input"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：订单主链路"
          />
        </label>
        <label>
          WorkflowDefinition JSON
          <textarea
            className="code-input"
            required
            value={definition}
            onChange={(event) => setDefinition(event.target.value)}
            placeholder={'{"schemaVersion":"1.0.0","name":"…","steps":[…],"teardown":[]}'}
            spellCheck={false}
          />
        </label>
        <button className="button button--primary" type="submit" disabled={submitting}>
          <Play size={18} weight="fill" />
          {submitting ? '正在发布并创建 Run…' : '发布并运行'}
        </button>
      </form>

      {error ? (
        <section className="paper-panel error-panel" role="alert">
          <Warning size={22} />
          <span>{error}</span>
        </section>
      ) : null}
      {result ? (
        <section className="paper-panel result-grid" aria-live="polite">
          <div>
            <span>Workflow</span>
            <code>{result.workflowId}</code>
          </div>
          <div>
            <span>Version</span>
            <code>{result.workflowVersionId}</code>
          </div>
          <div>
            <span>Run</span>
            <code>{result.runId}</code>
          </div>
          <div>
            <span>Plan SHA-256</span>
            <code>{result.planHash}</code>
          </div>
        </section>
      ) : null}
    </main>
  );
}
