import { createHash, randomUUID } from 'node:crypto';
import {
  GENERATION_PROTOCOL_VERSION,
  type GenerationTask,
  GenerationTaskSchema,
  validateGenerationResult,
  type WorkerIdentity,
} from '@sketch-test/generation-protocol';
import type pg from 'pg';
import { pool } from '../../db/db.js';
import { transaction } from '../../db/transaction.js';
import { draftId, generationJobId } from '../../shared/id.js';
import { type EndpointDef, GenerationError } from './generation.service.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function workerHeartbeat(workspaceId: string, identity: WorkerIdentity) {
  await pool.query(
    `INSERT INTO ai_workers (worker_id,workspace_id,identity) VALUES ($1,$2,$3)
    ON CONFLICT (worker_id) DO UPDATE SET identity=EXCLUDED.identity,heartbeat_at=now()
    WHERE ai_workers.workspace_id=EXCLUDED.workspace_id`,
    [identity.workerId, workspaceId, JSON.stringify(identity)],
  );
}

export async function aiCapabilities(workspaceId: string) {
  const configured = Boolean(
    process.env['AI_WORKER_TOKEN'] && process.env['AI_WORKER_WORKSPACE_ID'] === workspaceId,
  );
  if (!configured) return { configured: false, available: false, workers: [] };
  const result = await pool.query(
    `SELECT identity FROM ai_workers WHERE workspace_id=$1 AND heartbeat_at > now()-interval '45 seconds' ORDER BY heartbeat_at DESC`,
    [workspaceId],
  );
  return {
    configured,
    available: result.rows.length > 0,
    workers: result.rows.map((row) => row.identity as WorkerIdentity),
  };
}

/** Only shape facts; examples, defaults, prose and source auth never enter the model input. */
function schemaShape(
  ref: unknown,
  schemas: Record<string, unknown>,
  depth = 0,
  budget = { remaining: 64 },
): unknown {
  if (typeof ref !== 'string' || depth > 4 || budget.remaining-- <= 0) return undefined;
  const schema = schemas[ref] as Record<string, unknown> | undefined;
  if (!schema) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of [
    'type',
    'format',
    'required',
    'minimum',
    'maximum',
    'minLength',
    'maxLength',
    'minItems',
    'maxItems',
    'nullable',
  ])
    if (schema[key] !== undefined) out[key] = schema[key];
  if (schema['properties'] && typeof schema['properties'] === 'object')
    out['properties'] = Object.fromEntries(
      Object.entries(schema['properties'])
        .slice(0, 30)
        .map(([name, value]) => [
          name,
          schemaShape((value as { ref?: string }).ref, schemas, depth + 1, budget),
        ]),
    );
  if (schema['items'])
    out['items'] = schemaShape(
      (schema['items'] as { ref?: string }).ref,
      schemas,
      depth + 1,
      budget,
    );
  return out;
}

export async function enqueueAiGeneration(
  workspaceId: string,
  apiVersionId: string,
  objective: string,
  endpointIds?: string[],
) {
  const capability = await aiCapabilities(workspaceId);
  const worker = capability.workers[0];
  if (!worker) throw new GenerationError('AI Worker is not online for this workspace', 503);
  return transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `ai-generation:${workspaceId}`,
    ]);
    const count = await client.query(
      `SELECT count(*) FROM generation_jobs WHERE workspace_id=$1 AND strategy='pi' AND status IN ('pending','running')`,
      [workspaceId],
    );
    if (Number(count.rows[0].count) >= 10)
      throw new GenerationError('Workspace generation queue is full', 429);
    const source = await client.query(
      'SELECT spec_json,content_hash FROM api_versions WHERE id=$1 AND workspace_id=$2',
      [apiVersionId, workspaceId],
    );
    if (!source.rows[0]) throw new GenerationError('API version not found', 404);
    const endpoints = (source.rows[0].spec_json.endpoints ?? []) as EndpointDef[];
    const schemas = source.rows[0].spec_json.schemas ?? {};
    const selected = endpoints.filter((e) => !endpointIds || endpointIds.includes(e.id));
    if (endpointIds?.some((id) => !selected.some((e) => e.id === id)))
      throw new GenerationError('Unknown endpoint', 400);
    const id = generationJobId();
    const parsed = GenerationTaskSchema.safeParse({
      schemaVersion: GENERATION_PROTOCOL_VERSION,
      jobId: id,
      workspaceId,
      apiVersionId,
      sourceHash: source.rows[0].content_hash,
      objective,
      modelTarget: { provider: worker.provider, model: worker.model },
      endpoints: selected.map((e) => ({
        id: e.id,
        method: e.method,
        path: e.path,
        summary: `${e.method} ${e.path}`,
        // Deliberately exclude examples, source prose, servers and auth values.
        contractNotes: JSON.stringify({
          ...(source.rows[0].spec_json.metadata?.sourceType === 'code-discovery'
            ? {
                sourceKind: 'static-spring-code',
                limitations:
                  'Only literal Controller mappings, simple DTO validation and explicit statuses were discovered. Authentication, global exceptions, service logic, nested DTOs and response bodies are not proved. State missing preconditions in the rationale.',
              }
            : {}),
          parameters: e.parameters.map((p) => ({
            name: p.name,
            in: p.in,
            required: p.required ?? false,
            schema: schemaShape(p.schema?.ref, schemas),
          })),
          requestBodyRequired: e.requestBodies.some((b) => b.required),
          requestBodies: e.requestBodies.map((b) => ({
            required: b.required,
            content: Object.fromEntries(
              Object.entries(b.content).map(([type, media]) => [
                type,
                schemaShape(media.schema?.ref, schemas),
              ]),
            ),
          })),
          responses: e.responses.map((r) => ({
            status: r.statusCode,
            content: Object.fromEntries(
              Object.entries(r.content ?? {}).map(([type, media]) => [
                type,
                schemaShape(media.schema?.ref, schemas),
              ]),
            ),
          })),
        }),
        responseStatusCodes: [
          ...new Set(
            e.responses
              .map((r) => r.statusCode)
              .filter((code) => Number.isInteger(code) && code >= 100 && code <= 599),
          ),
        ],
        sideEffect: ['GET', 'HEAD', 'OPTIONS'].includes(e.method) ? 'read-only' : 'high-risk',
      })),
      limits: { maxDrafts: Math.min(selected.length, 5), timeoutMs: 120000 },
    });
    if (!parsed.success)
      throw new GenerationError(
        'Select 1–100 endpoints with explicit status codes and a bounded contract projection',
        400,
      );
    const task = parsed.data;
    const result = await client.query(
      `INSERT INTO generation_jobs (id,workspace_id,api_version_id,strategy,config) VALUES ($1,$2,$3,'pi',$4) RETURNING *`,
      [
        id,
        workspaceId,
        apiVersionId,
        JSON.stringify({
          objective,
          endpointIds: task.endpoints.map((e) => e.id),
          ...task.modelTarget,
        }),
      ],
    );
    await client.query(
      `INSERT INTO ai_generation_tasks (job_id,workspace_id,task,input_hash) VALUES ($1,$2,$3,$4)`,
      [id, workspaceId, JSON.stringify(task), hash(task)],
    );
    return result.rows[0];
  });
}

interface TaskRow {
  job_id: string;
  workspace_id: string;
  task: GenerationTask;
  input_hash: string;
  worker_id: string | null;
  lease_token: string | null;
  leased_until: Date | null;
  attempt: number;
  max_attempts: number;
  result_hash: string | null;
  status: string;
}
export async function claimAiGeneration(workspaceId: string, worker: WorkerIdentity) {
  await workerHeartbeat(workspaceId, worker);
  return transaction(async (client) => {
    const selected = await client.query(
      `SELECT t.*,j.status FROM ai_generation_tasks t JOIN generation_jobs j ON j.id=t.job_id
      WHERE t.workspace_id=$1 AND t.task->'modelTarget'->>'provider'=$2 AND t.task->'modelTarget'->>'model'=$3
      AND (j.status='pending' OR (j.status='running' AND t.leased_until < now()))
      ORDER BY j.created_at FOR UPDATE OF t,j SKIP LOCKED LIMIT 1`,
      [workspaceId, worker.provider, worker.model],
    );
    const row = selected.rows[0] as TaskRow | undefined;
    if (!row) return null;
    if (row.attempt >= row.max_attempts) {
      await client.query(
        `UPDATE generation_jobs SET status='failed',completed_at=now() WHERE id=$1`,
        [row.job_id],
      );
      await client.query(
        `UPDATE ai_generation_tasks SET error_code='LEASE_EXHAUSTED' WHERE job_id=$1`,
        [row.job_id],
      );
      return null;
    }
    const leaseToken = randomUUID();
    await client.query(
      `UPDATE ai_generation_tasks SET worker_id=$2,lease_token=$3,leased_until=now()+interval '30 seconds',attempt=attempt+1,error_code=NULL WHERE job_id=$1`,
      [row.job_id, worker.workerId, leaseToken],
    );
    await client.query(
      `UPDATE generation_jobs SET status='running',completed_at=NULL WHERE id=$1`,
      [row.job_id],
    );
    return { task: GenerationTaskSchema.parse(row.task), leaseToken, attempt: row.attempt + 1 };
  });
}

async function lockedTask(client: pg.PoolClient, workspaceId: string, jobId: string) {
  const result = await client.query(
    `SELECT t.*,j.status FROM ai_generation_tasks t JOIN generation_jobs j ON j.id=t.job_id WHERE t.job_id=$1 AND t.workspace_id=$2 FOR UPDATE OF t,j`,
    [jobId, workspaceId],
  );
  const task = result.rows[0] as TaskRow | undefined;
  if (!task) throw new GenerationError('Generation task not found', 404);
  return task;
}
function checkLease(row: TaskRow, workerId: string, token: string) {
  if (
    row.status !== 'running' ||
    row.worker_id !== workerId ||
    row.lease_token !== token ||
    !row.leased_until ||
    new Date(row.leased_until).getTime() <= Date.now()
  )
    throw new GenerationError('Generation lease expired or cancelled', 409);
}
export async function renewAiGeneration(
  workspaceId: string,
  jobId: string,
  workerId: string,
  token: string,
) {
  return transaction(async (client) => {
    const row = await lockedTask(client, workspaceId, jobId);
    checkLease(row, workerId, token);
    await client.query(
      `UPDATE ai_generation_tasks SET leased_until=now()+interval '30 seconds' WHERE job_id=$1`,
      [jobId],
    );
  });
}
export async function completeAiGeneration(
  workspaceId: string,
  jobId: string,
  workerId: string,
  token: string,
  input: unknown,
) {
  return transaction(async (client) => {
    const row = await lockedTask(client, workspaceId, jobId);
    let result: ReturnType<typeof validateGenerationResult>;
    try {
      result = validateGenerationResult(
        GenerationTaskSchema.parse(row.task),
        row.input_hash,
        input,
      );
    } catch {
      throw new GenerationError('Invalid generation result or provenance', 400);
    }
    const resultHash = hash(result);
    if (
      row.status === 'completed' &&
      row.worker_id === workerId &&
      row.lease_token === token &&
      row.result_hash === resultHash
    )
      return;
    checkLease(row, workerId, token);
    const source = await client.query(
      'SELECT spec_json FROM api_versions WHERE id=$1 AND workspace_id=$2',
      [result.apiVersionId, workspaceId],
    );
    const canonical = source.rows[0]?.spec_json;
    for (const draft of result.drafts) {
      const sourceEndpoint = canonical?.endpoints?.find(
        (endpoint: { id: string }) => endpoint.id === draft.endpointId,
      );
      await client.query(
        `INSERT INTO generated_drafts (id,job_id,definition,source_info,confidence) VALUES ($1,$2,$3,$4,NULL)`,
        [
          draftId(),
          jobId,
          JSON.stringify(draft.definition),
          JSON.stringify({
            strategy: 'pi',
            method: draft.definition.request.method,
            path: row.task.endpoints.find((e) => e.id === draft.endpointId)?.path,
            endpointId: draft.endpointId,
            apiVersionId: result.apiVersionId,
            sourceHash: result.sourceHash,
            inputHash: result.inputHash,
            harness: result.harness,
            harnessVersion: result.harnessVersion,
            promptVersion: result.promptVersion,
            provider: result.provider,
            model: result.model,
            rationale: draft.rationale,
            attempt: row.attempt,
            ...(canonical?.metadata?.sourceType === 'code-discovery'
              ? {
                  repositoryUrl: canonical.metadata.extra?.repositoryUrl,
                  commit: canonical.metadata.extra?.commit,
                  codeLocations: sourceEndpoint?.sourceLocations ?? [],
                }
              : {}),
          }),
        ],
      );
    }
    await client.query(`UPDATE ai_generation_tasks SET result_hash=$2 WHERE job_id=$1`, [
      jobId,
      resultHash,
    ]);
    await client.query(
      `UPDATE generation_jobs SET status='completed',completed_at=now() WHERE id=$1`,
      [jobId],
    );
  });
}
export async function failAiGeneration(
  workspaceId: string,
  jobId: string,
  workerId: string,
  token: string,
  errorCode: string,
) {
  return transaction(async (client) => {
    const row = await lockedTask(client, workspaceId, jobId);
    checkLease(row, workerId, token);
    await client.query(`UPDATE ai_generation_tasks SET error_code=$2 WHERE job_id=$1`, [
      jobId,
      errorCode,
    ]);
    await client.query(
      `UPDATE generation_jobs SET status='failed',completed_at=now() WHERE id=$1`,
      [jobId],
    );
  });
}
export async function changeAiGeneration(
  workspaceId: string,
  jobId: string,
  action: 'cancel' | 'retry',
) {
  return transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `ai-generation:${workspaceId}`,
    ]);
    const row = await lockedTask(client, workspaceId, jobId);
    if (action === 'cancel') {
      if (!['pending', 'running'].includes(row.status))
        throw new GenerationError('Only active jobs can be cancelled', 409);
      await client.query(
        `UPDATE generation_jobs SET status='cancelled',completed_at=now() WHERE id=$1`,
        [jobId],
      );
    } else {
      if (!['failed', 'cancelled'].includes(row.status))
        throw new GenerationError('Only failed or cancelled jobs can be retried', 409);
      const count = await client.query(
        `SELECT count(*) FROM generation_jobs WHERE workspace_id=$1 AND strategy='pi' AND status IN ('pending','running')`,
        [workspaceId],
      );
      if (Number(count.rows[0].count) >= 10)
        throw new GenerationError('Workspace generation queue is full', 429);
      await client.query(
        `UPDATE ai_generation_tasks SET lease_token=NULL,leased_until=NULL,error_code=NULL,max_attempts=attempt+3 WHERE job_id=$1`,
        [jobId],
      );
      await client.query(
        `UPDATE generation_jobs SET status='pending',completed_at=NULL WHERE id=$1`,
        [jobId],
      );
    }
  });
}
