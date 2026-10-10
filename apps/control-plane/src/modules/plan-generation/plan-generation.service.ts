import { createHash, randomUUID } from 'node:crypto';
import type { AgentSnapshot } from '@sketch-test/generation-protocol';
import {
  type PlanAsset,
  type PlanProposal,
  type PlanTask,
  PlanTaskSchema,
  validatePlanProposal,
  validatePlanResult,
  type WorkerIdentity,
} from '@sketch-test/generation-protocol';
import type pg from 'pg';
import { pool } from '../../db/db.js';
import { transaction } from '../../db/transaction.js';
import { selectedAgent } from '../agents/agents.service.js';
import { aiCapabilities } from '../generation/ai-generation.service.js';
import { GenerationError } from '../generation/generation.service.js';

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
interface Row {
  original_proposal?: unknown;
  execution_events?: unknown;
  id: string;
  workspace_id: string;
  task: PlanTask;
  input_hash: string;
  trigger: string;
  parent_id: string | null;
  status: string;
  proposal: PlanProposal | null;
  revision: number;
  saved_at: string | null;
  suite_id: string | null;
  worker_id: string | null;
  lease_token: string | null;
  leased_until: Date | null;
  attempt: number;
  result_hash: string | null;
  error_code: string | null;
  created_at: string;
}

/** Projection excludes request bodies, headers, examples, environment values and source credentials. */
export async function planInventory(
  workspaceId: string,
  client: Pick<pg.PoolClient, 'query'> = pool,
) {
  const tests = await client.query(
    `SELECT t.id,t.name,t.api_version_id,v.id version_id,v.version,v.definition->'request'->>'method' method,v.definition->'request'->>'url' route,v.side_effect
    FROM test_cases t JOIN LATERAL (SELECT * FROM test_case_versions WHERE test_case_id=t.id AND published_by IS NOT NULL ORDER BY version DESC LIMIT 1) v ON true
    WHERE t.workspace_id=$1 ORDER BY t.id LIMIT 75`,
    [workspaceId],
  );
  const flows = await client.query(
    `SELECT w.id,w.name,v.id version_id,v.version FROM workflows w JOIN LATERAL (SELECT * FROM workflow_versions WHERE workflow_id=w.id AND compiled_plan IS NOT NULL ORDER BY version DESC LIMIT 1) v ON true WHERE w.workspace_id=$1 ORDER BY w.id LIMIT 25`,
    [workspaceId],
  );
  const drafts = await client.query(
    `SELECT d.id,d.definition->>'name' name,d.source_info->>'method' method,d.source_info->>'path' route,d.definition->>'sideEffect' side_effect,j.api_version_id FROM generated_drafts d JOIN generation_jobs j ON j.id=d.job_id WHERE j.workspace_id=$1 AND d.status='pending' ORDER BY d.id LIMIT 50`,
    [workspaceId],
  );
  const route = (method: unknown, value: unknown) => {
    const text =
      String(value ?? '')
        .split('?')[0]
        ?.split('#')[0] ?? '';
    // Retain only a relative route or the standard env template, never arbitrary server credentials.
    const path = text.startsWith('${env.baseUrl}')
      ? text.slice(14)
      : text.startsWith('/')
        ? text
        : '';
    return `${String(method ?? '')} ${path}`.trim().slice(0, 2048);
  };
  const assets: PlanAsset[] = [
    ...tests.rows.map((r) => ({
      key: r.id,
      id: r.id,
      type: 'test' as const,
      name: String(r.name).slice(0, 255),
      versionId: r.version_id,
      version: r.version,
      route: route(r.method, r.route),
      sideEffect: r.side_effect,
      apiVersionId: r.api_version_id ?? undefined,
    })),
    ...flows.rows.map((r) => ({
      key: r.id,
      id: r.id,
      type: 'workflow' as const,
      name: String(r.name).slice(0, 255),
      versionId: r.version_id,
      version: r.version,
      route: '业务流程',
      sideEffect: 'unknown',
    })),
    ...drafts.rows.map((r) => ({
      key: r.id,
      id: r.id,
      type: 'draft' as const,
      name: String(r.name).slice(0, 255),
      route: route(r.method, r.route),
      sideEffect: r.side_effect ?? 'unknown',
      apiVersionId: r.api_version_id,
    })),
  ];
  return assets;
}
export async function planSettings(workspaceId: string) {
  const r = await pool.query(
    'SELECT enabled,agent_id FROM ai_plan_settings WHERE workspace_id=$1',
    [workspaceId],
  );
  return { enabled: r.rows[0]?.enabled ?? false, agentId: r.rows[0]?.agent_id ?? null };
}
export async function setPlanSettings(workspaceId: string, enabled: boolean, agentId?: string) {
  return transaction(async (client) => {
    if (enabled && agentId)
      await selectedAgent(
        client,
        workspaceId,
        agentId,
        'plan',
        (await aiCapabilities(workspaceId)).workers.filter((w) => w.capabilities?.includes('plan')),
      );
    if (
      enabled &&
      !agentId &&
      (await client.query('SELECT id FROM agents WHERE workspace_id=$1 LIMIT 1', [workspaceId]))
        .rows.length
    )
      throw new GenerationError('请选择自动建议使用的 Agent', 400);
    await client.query(
      `INSERT INTO ai_plan_settings(workspace_id,enabled,agent_id) VALUES($1,$2,$3) ON CONFLICT(workspace_id) DO UPDATE SET enabled=$2,agent_id=$3,last_checked=NULL`,
      [workspaceId, enabled, agentId ?? null],
    );
    return { enabled, agentId: agentId ?? null };
  });
}
export async function listPlanJobs(workspaceId: string) {
  const r = await pool.query(
    'SELECT * FROM ai_plan_jobs WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 30',
    [workspaceId],
  );
  return r.rows.map(publicJob);
}
function publicJob(r: Row) {
  return {
    id: r.id,
    status: r.status,
    trigger: r.trigger,
    parentId: r.parent_id,
    objective: r.task.objective,
    assets: r.task.assets,
    proposal: r.proposal,
    revision: r.revision,
    savedAt: r.saved_at,
    suiteId: r.suite_id,
    errorCode: r.error_code,
    createdAt: r.created_at,
    model: r.task.modelTarget,
    agent: r.task.agent ?? null,
    workerId: r.worker_id,
    attempt: r.attempt,
    inputHash: r.input_hash,
    originalProposal: r.original_proposal ?? null,
    events: r.execution_events ?? [],
    sourceHash: r.task.sourceHash,
  };
}
async function locked(client: pg.PoolClient, workspaceId: string, jobId: string) {
  const r = await client.query(
    'SELECT * FROM ai_plan_jobs WHERE id=$1 AND workspace_id=$2 FOR UPDATE',
    [jobId, workspaceId],
  );
  if (!r.rows[0]) throw new GenerationError('计划草稿不存在', 404);
  return r.rows[0] as Row;
}
async function insertJob(
  client: pg.PoolClient,
  workspaceId: string,
  worker: WorkerIdentity,
  assets: PlanAsset[],
  objective: string,
  trigger: string,
  parent?: Row,
  agent?: AgentSnapshot,
) {
  if (!assets.length)
    throw new GenerationError('请先导入接口并生成用例，或发布一个用例/流程。', 400);
  const busy = await client.query(
    `SELECT count(*) FROM ai_plan_jobs WHERE workspace_id=$1 AND status IN ('pending','running')`,
    [workspaceId],
  );
  if (Number(busy.rows[0].count) >= 3)
    throw new GenerationError('已有计划正在生成，请等待完成。', 429);
  const task = PlanTaskSchema.parse({
    schemaVersion: 'sketch-test.plan-generation/v1',
    jobId: id('ap'),
    workspaceId,
    sourceHash: hash(assets),
    objective,
    assets,
    previous: parent?.proposal ?? undefined,
    ...(agent ? { agent } : {}),
    modelTarget: {
      provider: agent?.provider ?? worker.provider,
      model: agent?.model ?? worker.model,
    },
    limits: {
      timeoutMs: agent?.timeoutMs ?? 120000,
      maxTurns: 4,
      maxOutputTokens: agent?.maxOutputTokens ?? 4096,
    },
  });
  const r = await client.query(
    `INSERT INTO ai_plan_jobs(id,workspace_id,task,input_hash,trigger,parent_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [task.jobId, workspaceId, JSON.stringify(task), hash(task), trigger, parent?.id ?? null],
  );
  return publicJob(r.rows[0]);
}
export async function enqueuePlan(
  workspaceId: string,
  objective: string,
  parentId?: string,
  revision?: number,
  agentId?: string,
) {
  const worker = (await aiCapabilities(workspaceId)).workers.find((w) =>
    w.capabilities?.includes('plan'),
  );
  if (!worker) throw new GenerationError('支持计划生成的 AI Worker 尚未在线。', 503);
  return transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`plan:${workspaceId}`]);
    const agent = agentId
      ? await selectedAgent(
          client,
          workspaceId,
          agentId,
          'plan',
          (await aiCapabilities(workspaceId)).workers.filter((w) =>
            w.capabilities?.includes('plan'),
          ),
        )
      : undefined;
    if (
      !agent &&
      (await client.query('SELECT id FROM agents WHERE workspace_id=$1 LIMIT 1', [workspaceId]))
        .rows.length
    )
      throw new GenerationError('请选择计划 Agent', 400);
    const parent = parentId ? await locked(client, workspaceId, parentId) : undefined;
    if (parent && (parent.revision !== revision || parent.status !== 'completed'))
      throw new GenerationError('草稿已变化，请刷新后再调整。', 409);
    return insertJob(
      client,
      workspaceId,
      worker,
      await planInventory(workspaceId, client),
      objective,
      parent ? '对话调整' : '手动生成',
      parent,
      agent,
    );
  });
}
/** Independent worker observes persisted publications/drafts. Atomic fingerprinting deduplicates events across workers. */
async function autoSuggest(workspaceId: string, worker: WorkerIdentity) {
  if (!worker.capabilities?.includes('plan')) return;
  await transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`plan:${workspaceId}`]);
    const settings = await client.query(
      `SELECT * FROM ai_plan_settings WHERE workspace_id=$1 AND enabled=true AND (last_checked IS NULL OR last_checked<now()-interval '30 seconds') FOR UPDATE`,
      [workspaceId],
    );
    if (!settings.rows[0]) return;
    let agent: AgentSnapshot | undefined;
    if (settings.rows[0].agent_id) {
      try {
        agent = await selectedAgent(client, workspaceId, settings.rows[0].agent_id, 'plan', [
          worker,
        ]);
      } catch (e) {
        if (e instanceof GenerationError) return;
        throw e;
      }
    } else if (
      (await client.query('SELECT id FROM agents WHERE workspace_id=$1 LIMIT 1', [workspaceId]))
        .rows.length
    )
      return;
    await client.query('UPDATE ai_plan_settings SET last_checked=now() WHERE workspace_id=$1', [
      workspaceId,
    ]);
    const assets = await planInventory(workspaceId, client);
    const fingerprint = hash(assets);
    if (!assets.length || fingerprint === settings.rows[0].last_hash) return;
    const active = await client.query(
      `SELECT id FROM ai_plan_jobs WHERE workspace_id=$1 AND status IN ('pending','running') LIMIT 1`,
      [workspaceId],
    );
    if (active.rows.length) return;
    await insertJob(
      client,
      workspaceId,
      worker,
      assets,
      '基于当前已发布用例、业务流程和待审草稿，主动建议一个聚焦关键业务的回归计划。明确待补齐资产和执行前提，不编造业务预期。',
      '用例资产变化后自动建议',
      undefined,
      agent,
    );
    await client.query('UPDATE ai_plan_settings SET last_hash=$2 WHERE workspace_id=$1', [
      workspaceId,
      fingerprint,
    ]);
  });
}
export async function claimPlan(workspaceId: string, worker: WorkerIdentity) {
  await autoSuggest(workspaceId, worker);
  return transaction(async (client) => {
    const r = await client.query(
      `SELECT * FROM ai_plan_jobs WHERE workspace_id=$1 AND task->'modelTarget'->>'provider'=$2 AND task->'modelTarget'->>'model'=$3 AND (task->'agent' IS NULL OR ($5::boolean AND task->'agent'->>'connectionRef'=$4)) AND (status='pending' OR (status='running' AND leased_until<now())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`,
      [
        workspaceId,
        worker.provider,
        worker.model,
        worker.connectionRef ?? 'default',
        worker.agentConfigVersion === 1,
      ],
    );
    const row = r.rows[0] as Row | undefined;
    if (!row) return null;
    if (row.attempt >= (row.task.agent?.retries ?? 2) + 1) {
      await client.query(
        `UPDATE ai_plan_jobs SET status='failed',error_code='LEASE_EXHAUSTED' WHERE id=$1`,
        [row.id],
      );
      return null;
    }
    const token = randomUUID();
    await client.query(
      `UPDATE ai_plan_jobs SET status='running',worker_id=$2,lease_token=$3,leased_until=now()+interval '30 seconds',attempt=attempt+1 WHERE id=$1`,
      [row.id, worker.workerId, token],
    );
    return { task: PlanTaskSchema.parse(row.task), leaseToken: token, attempt: row.attempt + 1 };
  });
}
export async function planLeaseAction(
  workspaceId: string,
  jobId: string,
  workerId: string,
  token: string,
  action: 'heartbeat' | 'complete' | 'fail',
  input?: unknown,
) {
  return transaction(async (client) => {
    const row = await locked(client, workspaceId, jobId);
    let result: ReturnType<typeof validatePlanResult> | undefined;
    if (action === 'complete') {
      try {
        result = validatePlanResult(PlanTaskSchema.parse(row.task), row.input_hash, input);
      } catch {
        throw new GenerationError('计划结果或来源无效', 400);
      }
      if (
        row.status === 'completed' &&
        row.worker_id === workerId &&
        row.lease_token === token &&
        row.result_hash === hash(result)
      )
        return;
    }
    if (
      row.status !== 'running' ||
      row.worker_id !== workerId ||
      row.lease_token !== token ||
      !row.leased_until ||
      new Date(row.leased_until).getTime() <= Date.now()
    )
      throw new GenerationError('计划租约失效', 409);
    if (action === 'heartbeat')
      await client.query(
        `UPDATE ai_plan_jobs SET leased_until=now()+interval '30 seconds' WHERE id=$1`,
        [jobId],
      );
    else if (result)
      await client.query(
        `UPDATE ai_plan_jobs SET status='completed',proposal=$2,original_proposal=$2,execution_events=$4,result_hash=$3,revision=revision+1 WHERE id=$1`,
        [jobId, JSON.stringify(result.proposal), hash(result), JSON.stringify(result.events ?? [])],
      );
    else
      await client.query(
        `UPDATE ai_plan_jobs SET status='failed',error_code='MODEL_FAILED' WHERE id=$1`,
        [jobId],
      );
  });
}
export async function savePlanDraft(
  workspaceId: string,
  jobId: string,
  revision: number,
  input: unknown,
) {
  return transaction(async (client) => {
    const row = await locked(client, workspaceId, jobId);
    if (row.status !== 'completed' || row.revision !== revision || row.suite_id)
      throw new GenerationError('草稿已变化或已发布，请刷新。', 409);
    let proposal: PlanProposal;
    try {
      proposal = validatePlanProposal(PlanTaskSchema.parse(row.task), input);
    } catch {
      throw new GenerationError('只能引用快照中的已发布资产；待审草稿只能列为待办。', 400);
    }
    const r = await client.query(
      `UPDATE ai_plan_jobs SET proposal=$2,saved_at=now(),revision=revision+1 WHERE id=$1 RETURNING *`,
      [jobId, JSON.stringify(proposal)],
    );
    return publicJob(r.rows[0]);
  });
}
export async function publishPlan(workspaceId: string, jobId: string, revision: number) {
  return transaction(async (client) => {
    const row = await locked(client, workspaceId, jobId);
    if (row.suite_id) return { suiteId: row.suite_id };
    if (!row.saved_at || row.revision !== revision || !row.proposal)
      throw new GenerationError('请先保存最新草稿，再确认发布。', 409);
    const proposal = validatePlanProposal(row.task, row.proposal);
    if (!proposal.members.length) throw new GenerationError('至少需要一个已发布的执行成员。', 400);
    const current = await planInventory(workspaceId, client);
    const members = proposal.members.map((m) => {
      const source = row.task.assets.find((a) => a.key === m.key);
      if (!source || !current.some((a) => a.key === source.key && a.versionId === source.versionId))
        throw new GenerationError('引用用例已更新或删除，请重新生成并审阅。', 409);
      return { type: source.type, id: source.id };
    });
    const suiteId = id('ts');
    await client.query(
      'INSERT INTO test_suites(id,workspace_id,name,description) VALUES($1,$2,$3,$4)',
      [suiteId, workspaceId, proposal.name, proposal.objective],
    );
    await client.query(
      'INSERT INTO test_suite_versions(id,test_suite_id,version,members_json,quality_gate_json) VALUES($1,$2,1,$3,$4)',
      [
        id('tsv'),
        suiteId,
        JSON.stringify(members),
        JSON.stringify({
          noNewFailures: proposal.noNewFailures,
          blockOnInfraError: proposal.blockOnInfraError,
          requiredWorkflows: members.filter((m) => m.type === 'workflow').map((m) => m.id),
        }),
      ],
    );
    await client.query('UPDATE ai_plan_jobs SET suite_id=$2,revision=revision+1 WHERE id=$1', [
      jobId,
      suiteId,
    ]);
    return { suiteId };
  });
}
export async function cancelPlan(workspaceId: string, jobId: string) {
  await pool.query(
    `UPDATE ai_plan_jobs SET status='cancelled' WHERE id=$1 AND workspace_id=$2 AND status IN ('pending','running')`,
    [jobId, workspaceId],
  );
}
