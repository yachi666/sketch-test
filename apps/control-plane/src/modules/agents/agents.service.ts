import { randomUUID } from 'node:crypto';
import {
  type AgentConfig,
  type AgentSnapshot,
  AgentSnapshotSchema,
  type ConnectionConfig,
  type WorkerIdentity,
} from '@sketch-test/generation-protocol';
import type pg from 'pg';
import { pool } from '../../db/db.js';
import { transaction } from '../../db/transaction.js';
import { GenerationError } from '../generation/generation.service.js';

export async function connections(workspaceId: string) {
  const rows = await pool.query(
    `SELECT id,name,provider,connection_ref AS "connectionRef",created_at AS "createdAt" FROM agent_connections WHERE workspace_id=$1 ORDER BY created_at`,
    [workspaceId],
  );
  return rows.rows;
}
export async function addConnection(workspaceId: string, config: ConnectionConfig) {
  try {
    const row = await pool.query(
      `INSERT INTO agent_connections(id,workspace_id,name,provider,connection_ref) VALUES($1,$2,$3,$4,$5) RETURNING id,name,provider,connection_ref AS "connectionRef"`,
      [`conn_${randomUUID()}`, workspaceId, config.name, config.provider, config.connectionRef],
    );
    return row.rows[0];
  } catch (e) {
    if ((e as { code?: string }).code === '23505')
      throw new GenerationError('此厂商的连接引用已存在', 409);
    throw e;
  }
}
export async function listAgents(workspaceId: string) {
  const rows = await pool.query(
    `SELECT v.config FROM agents a JOIN agent_versions v ON v.agent_id=a.id AND v.version=a.version WHERE a.workspace_id=$1 ORDER BY a.created_at`,
    [workspaceId],
  );
  return rows.rows.map((r) => r.config as AgentSnapshot);
}
export async function saveAgent(
  workspaceId: string,
  userId: string,
  config: AgentConfig,
  id?: string,
  expectedVersion?: number,
) {
  return transaction(async (client) => {
    const connection = await client.query(
      'SELECT * FROM agent_connections WHERE id=$1 AND workspace_id=$2 FOR SHARE',
      [config.connectionId, workspaceId],
    );
    const c = connection.rows[0];
    if (!c) throw new GenerationError('连接不存在或不属于当前工作区', 404);
    let version = 1;
    const agentId = id ?? `ag_${randomUUID()}`;
    if (id) {
      const old = await client.query(
        'SELECT version FROM agents WHERE id=$1 AND workspace_id=$2 FOR UPDATE',
        [id, workspaceId],
      );
      if (!old.rows[0]) throw new GenerationError('Agent 不存在', 404);
      if (old.rows[0].version !== expectedVersion)
        throw new GenerationError('配置已被更新，请刷新后重试', 409);
      version = old.rows[0].version + 1;
      await client.query('UPDATE agents SET version=$2 WHERE id=$1', [id, version]);
    } else
      await client.query('INSERT INTO agents(id,workspace_id) VALUES($1,$2)', [
        agentId,
        workspaceId,
      ]);
    const snapshot = AgentSnapshotSchema.parse({
      ...config,
      schemaVersion: 'sketch-test.agent/v1',
      id: agentId,
      version,
      provider: c.provider,
      connectionRef: c.connection_ref,
      connectionName: c.name,
    });
    await client.query(
      'INSERT INTO agent_versions(agent_id,version,config,created_by) VALUES($1,$2,$3,$4)',
      [agentId, version, JSON.stringify(snapshot), userId],
    );
    return snapshot;
  });
}
export async function agentVersions(workspaceId: string, id: string) {
  const rows = await pool.query(
    `SELECT v.config,v.created_at AS "createdAt" FROM agent_versions v JOIN agents a ON a.id=v.agent_id WHERE a.id=$1 AND a.workspace_id=$2 ORDER BY v.version DESC`,
    [id, workspaceId],
  );
  if (!rows.rows.length) throw new GenerationError('Agent 不存在', 404);
  return rows.rows;
}
/** Freeze under a row lock: later config changes cannot change a queued task. */
export async function selectedAgent(
  client: pg.PoolClient,
  workspaceId: string,
  id: string,
  capability: 'test' | 'plan',
  workers: WorkerIdentity[],
) {
  const row = await client.query(
    `SELECT v.config FROM agents a JOIN agent_versions v ON v.agent_id=a.id AND v.version=a.version WHERE a.id=$1 AND a.workspace_id=$2 FOR SHARE OF a`,
    [id, workspaceId],
  );
  if (!row.rows[0]) throw new GenerationError('Agent 不存在', 404);
  const snapshot = AgentSnapshotSchema.parse(row.rows[0].config);
  if (!snapshot.enabled || snapshot.capability !== capability)
    throw new GenerationError('Agent 已停用或不适用于此功能', 409);
  if (
    !workers.some(
      (w) =>
        w.agentConfigVersion === 1 &&
        w.provider === snapshot.provider &&
        w.model === snapshot.model &&
        (w.connectionRef ?? 'default') === snapshot.connectionRef,
    )
  )
    throw new GenerationError('此 Agent 的模型连接未在线；不会自动切换厂商或模型', 503);
  return snapshot;
}
export async function execution(workspaceId: string, id: string) {
  const row = await pool.query(
    `SELECT j.id,j.status,j.config,j.created_at AS "createdAt",j.completed_at AS "completedAt",t.attempt,t.error_code AS "errorCode",t.worker_id AS "workerId",t.input_hash AS "inputHash",t.result_hash AS "resultHash" FROM generation_jobs j LEFT JOIN ai_generation_tasks t ON t.job_id=j.id WHERE j.id=$1 AND j.workspace_id=$2`,
    [id, workspaceId],
  );
  if (!row.rows[0]) throw new GenerationError('执行记录不存在', 404);
  const events = await pool.query(
    'SELECT id,attempt,type,payload,created_at AS "createdAt" FROM generation_events WHERE job_id=$1 ORDER BY id',
    [id],
  );
  const outputs = await pool.query(
    `SELECT id,status,test_case_id AS "testCaseId",original_definition AS "originalDefinition",source_info AS "sourceInfo" FROM generated_drafts WHERE job_id=$1 ORDER BY created_at`,
    [id],
  );
  return {
    ...row.rows[0],
    agent: row.rows[0].config.agent ?? null,
    modelSnapshot: null,
    events: events.rows,
    outputs: outputs.rows,
  };
}
export async function caseProvenance(workspaceId: string, id: string) {
  const result = await pool.query(
    `SELECT d.job_id AS "jobId",d.id AS "draftId",d.source_info AS "sourceInfo",d.status,d.reviewed_at AS "reviewedAt" FROM test_cases c JOIN generated_drafts d ON d.test_case_id=c.id WHERE c.id=$1 AND c.workspace_id=$2 ORDER BY d.created_at DESC`,
    [id, workspaceId],
  );
  return result.rows;
}
export async function recordEvent(
  client: pg.PoolClient,
  jobId: string,
  attempt: number,
  type: string,
  payload: unknown = {},
) {
  await client.query(
    'INSERT INTO generation_events(job_id,attempt,type,payload) VALUES($1,$2,$3,$4)',
    [jobId, attempt, type, JSON.stringify(payload)],
  );
}
