import { ExecutionPlanSchema, type FrozenStep } from '@sketch-test/runner-protocol';
import { pool } from '../../db/db.js';
import { executionPlanContentHash } from '../../shared/execution-plan-hash.js';
import { runId } from '../../shared/id.js';
import { GenerationError } from '../generation/generation.service.js';
import { compileTestCaseVersionPlan, TestPlanCompileError } from './test-plan-compiler.js';

export function bindEnvironmentSteps(
  steps: FrozenStep[],
  variables: Record<string, string>,
): FrozenStep[] {
  function bind(value: unknown): unknown {
    if (typeof value === 'string')
      return value.replace(/\$\{env\.([^}]+)\}/g, (_match, key: string) => {
        if (!Object.hasOwn(variables, key))
          throw new GenerationError(`Environment variable ${key} is required`, 400);
        return variables[key] as string;
      });
    if (Array.isArray(value)) return value.map(bind);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, bind(v)]));
    return value;
  }
  const bound = bind(steps) as FrozenStep[];
  // Single-case execution has no upstream step/data context. Fail before requesting a lease.
  if (/\$\{[^}]+\}/.test(JSON.stringify(bound)))
    throw new GenerationError(
      'Unresolved test inputs; configure environment variables or use a workflow',
      400,
    );
  for (const step of bound) {
    let url: URL;
    try {
      url = new URL(step.urlTemplate);
    } catch {
      throw new GenerationError('Test URL must resolve to an absolute URL', 400);
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new GenerationError('Test URL must be HTTP(S) without embedded credentials', 400);
  }
  return bound;
}
export async function runPublishedTest(
  workspaceId: string,
  versionId: string,
  environmentVersionId: string,
  confirmSideEffects: boolean,
) {
  const test = await pool.query(
    `SELECT v.*,t.api_version_id FROM test_case_versions v JOIN test_cases t ON t.id=v.test_case_id WHERE v.id=$1 AND t.workspace_id=$2 AND v.published_by IS NOT NULL`,
    [versionId, workspaceId],
  );
  if (!test.rows[0]) throw new GenerationError('Published test version not found', 404);
  const env = await pool.query(
    `SELECT v.* FROM environment_versions v JOIN environments e ON e.id=v.environment_id WHERE v.id=$1 AND e.workspace_id=$2`,
    [environmentVersionId, workspaceId],
  );
  if (!env.rows[0]) throw new GenerationError('Environment version not found', 404);
  if (env.rows[0].require_approval)
    throw new GenerationError(
      'This environment requires an approval workflow and cannot be run directly',
      409,
    );
  if (env.rows[0].runner_labels?.length)
    throw new GenerationError(
      'Direct test execution does not support Runner label constraints; select an unrestricted test environment',
      409,
    );
  let plan: ReturnType<typeof compileTestCaseVersionPlan>;
  try {
    plan = compileTestCaseVersionPlan(versionId, test.rows[0].definition);
  } catch (error) {
    if (error instanceof TestPlanCompileError) throw new GenerationError(error.message, 400);
    throw error;
  }
  if (plan.steps.some((step) => step.sideEffect !== 'read-only') && !confirmSideEffects)
    throw new GenerationError('Confirm test side effects before executing', 409);
  plan.steps = bindEnvironmentSteps(plan.steps, {
    ...(env.rows[0].variables ?? {}),
    baseUrl: env.rows[0].base_url.replace(/\/$/, ''),
  });
  plan.environmentVersionId = environmentVersionId;
  plan.planHash = executionPlanContentHash(plan.steps);
  plan = ExecutionPlanSchema.parse(plan);
  const id = runId();
  await pool.query(
    `INSERT INTO runs(id,workspace_id,api_version_id,test_case_version_id,status,plan_json) VALUES($1,$2,$3,$4,'pending',$5)`,
    [id, workspaceId, test.rows[0].api_version_id, versionId, JSON.stringify(plan)],
  );
  return { runId: id, environmentVersionId, testCaseVersionId: versionId };
}
