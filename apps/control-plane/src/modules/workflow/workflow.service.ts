/**
 * Workflow Service — CRUD operations for workflows and workflow versions.
 *
 * Responsibilities:
 * - Create, read, update, delete workflows.
 * - Save drafts (new workflow versions with auto-incremented version numbers).
 * - Publish versions (compile the definition into an ExecutionPlan).
 * - Compile workflows into ExecutionPlans via the Workflow Compiler.
 */

import type { ExecutionPlan } from '@sketch-test/runner-protocol';
import { pool } from '../../db/db.js';
import { workflowId, workflowVersionId } from '../../shared/id.js';
import { type CompileResult, compileWorkflow, type WorkflowDefInput } from './workflow-compiler.js';

// ─── Types ───────────────────────────────────────────────────────

export interface Workflow {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  latestVersion?: WorkflowVersion | null;
}

export interface WorkflowVersion {
  id: string;
  workflowId: string;
  version: number;
  definition: WorkflowDefInput;
  compiledPlan: ExecutionPlan | null;
  publishedBy: string | null;
  publishedAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────

function rowToWorkflow(row: Record<string, unknown>): Workflow {
  return {
    id: row['id'] as string,
    workspaceId: row['workspace_id'] as string,
    name: row['name'] as string,
    description: (row['description'] as string) ?? '',
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}

function rowToVersion(row: Record<string, unknown>): WorkflowVersion {
  return {
    id: row['id'] as string,
    workflowId: row['workflow_id'] as string,
    version: row['version'] as number,
    definition: row['definition'] as WorkflowDefInput,
    compiledPlan: (row['compiled_plan'] as ExecutionPlan) ?? null,
    publishedBy: (row['published_by'] as string) ?? null,
    publishedAt: row['published_at'] as string,
  };
}

// ─── Workflow CRUD ───────────────────────────────────────────────

/** Create a new workflow in a workspace. */
export async function createWorkflow(
  workspaceId: string,
  name: string,
  description?: string,
): Promise<Workflow> {
  const id = workflowId();
  const now = new Date().toISOString();

  await pool.query(
    `INSERT INTO workflows (id, workspace_id, name, description, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)`,
    [id, workspaceId, name, description ?? '', now],
  );

  return {
    id,
    workspaceId,
    name,
    description: description ?? '',
    createdAt: now,
    updatedAt: now,
  };
}

/** Get a workflow by ID, including its latest version. */
export async function getWorkflow(
  id: string,
): Promise<(Workflow & { latestVersion: WorkflowVersion | null }) | null> {
  const result = await pool.query(`SELECT * FROM workflows WHERE id = $1`, [id]);
  if (result.rows.length === 0) return null;

  const workflow = rowToWorkflow(result.rows[0]!);

  // Fetch latest version
  const versionResult = await pool.query(
    `SELECT * FROM workflow_versions
     WHERE workflow_id = $1
     ORDER BY version DESC
     LIMIT 1`,
    [id],
  );

  const latestVersion = versionResult.rows.length > 0 ? rowToVersion(versionResult.rows[0]!) : null;

  return { ...workflow, latestVersion };
}

/** List all workflows in a workspace. */
export async function listWorkflows(workspaceId: string): Promise<Workflow[]> {
  const result = await pool.query(
    `SELECT * FROM workflows
     WHERE workspace_id = $1
     ORDER BY updated_at DESC
     LIMIT 100`,
    [workspaceId],
  );
  return result.rows.map(rowToWorkflow);
}

/** Update a workflow's name and/or description. */
export async function updateWorkflow(
  id: string,
  name?: string,
  description?: string,
): Promise<Workflow | null> {
  const now = new Date().toISOString();

  // Build dynamic SET clause
  const updates: string[] = ['updated_at = $2'];
  const values: unknown[] = [id, now];
  let paramIdx = 3;

  if (name !== undefined) {
    updates.push(`name = $${paramIdx}`);
    values.push(name);
    paramIdx++;
  }
  if (description !== undefined) {
    updates.push(`description = $${paramIdx}`);
    values.push(description);
    paramIdx++;
  }

  const result = await pool.query(
    `UPDATE workflows SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
    values,
  );

  if (result.rows.length === 0) return null;
  return rowToWorkflow(result.rows[0]!);
}

/** Delete a workflow and all its versions. */
export async function deleteWorkflow(id: string): Promise<void> {
  // Delete versions first (foreign key cascade not enforced as ON DELETE CASCADE
  // was not defined in the migration; handle manually)
  await pool.query(`DELETE FROM workflow_versions WHERE workflow_id = $1`, [id]);
  await pool.query(`DELETE FROM workflows WHERE id = $1`, [id]);
}

// ─── Workflow Versions ───────────────────────────────────────────

/** Save a new draft version for a workflow. Auto-increments the version number. */
export async function saveDraft(
  workflowId: string,
  definition: WorkflowDefInput,
): Promise<WorkflowVersion> {
  // Get the current max version
  const maxResult = await pool.query(
    `SELECT COALESCE(MAX(version), 0) as max_version
     FROM workflow_versions
     WHERE workflow_id = $1`,
    [workflowId],
  );
  const nextVersion = (maxResult.rows[0]! as { max_version: number }).max_version + 1;

  const id = workflowVersionId();
  const now = new Date().toISOString();

  await pool.query(
    `INSERT INTO workflow_versions (id, workflow_id, version, definition, compiled_plan, published_at)
     VALUES ($1, $2, $3, $4, NULL, $5)`,
    [id, workflowId, nextVersion, JSON.stringify(definition), now],
  );

  return {
    id,
    workflowId,
    version: nextVersion,
    definition,
    compiledPlan: null,
    publishedBy: null,
    publishedAt: now,
  };
}

/** Publish a workflow version by compiling its definition and storing the ExecutionPlan. */
export async function publishVersion(
  versionId: string,
  publishedBy?: string,
): Promise<{ version: WorkflowVersion; compileResult: CompileResult }> {
  // Fetch the version
  const result = await pool.query(`SELECT * FROM workflow_versions WHERE id = $1`, [versionId]);
  if (result.rows.length === 0) {
    throw new Error(`Workflow version ${versionId} not found`);
  }

  const row = result.rows[0]!;
  const definition = row.definition as WorkflowDefInput;

  // Compile the definition
  const compileResult = await compileWorkflow(definition, {
    resolveTest: async (testVersionId: string) => {
      const testResult = await pool.query(
        `SELECT definition FROM test_case_versions WHERE id = $1`,
        [testVersionId],
      );
      if (testResult.rows.length === 0) return null;
      const testDef = testResult.rows[0]!['definition'] as Record<string, unknown>;
      const request = testDef['request'] as Record<string, unknown> | undefined;
      return {
        method: (request?.['method'] as string) ?? 'GET',
        url: (request?.['url'] as string) ?? '',
        headers: request?.['headers'] as Record<string, string> | undefined,
        body: request?.['body'] as unknown,
        assertions: ((testDef['assertions'] as Array<Record<string, unknown>>) ?? []).map((a) => ({
          target: (a['target'] as string) ?? 'status',
          operator: (a['operator'] as string) ?? 'equals',
          expected: a['expected'],
          description: a['description'] as string | undefined,
        })),
        extract: ((testDef['extract'] as Array<Record<string, unknown>>) ?? []).map((e) => ({
          name: e['name'] as string,
          source: (e['source'] as string) ?? 'body',
          expression: e['expression'] as string,
          scope: e['scope'] as string | undefined,
        })),
        sideEffect: (testDef['sideEffect'] as string) ?? 'read-only',
      };
    },
  });

  if (!compileResult.success || !compileResult.plan) {
    return { version: rowToVersion(row), compileResult };
  }

  // Set the workflow version ID on the plan
  compileResult.plan.workflowVersionId = versionId;

  const now = new Date().toISOString();
  const publishedByValue = publishedBy ?? (row['published_by'] as string | null) ?? null;

  // Update the version with the compiled plan
  await pool.query(
    `UPDATE workflow_versions
     SET compiled_plan = $2, published_by = $3, published_at = $4
     WHERE id = $1`,
    [versionId, JSON.stringify(compileResult.plan), publishedByValue, now],
  );

  return {
    version: {
      id: row['id'] as string,
      workflowId: row['workflow_id'] as string,
      version: row['version'] as number,
      definition,
      compiledPlan: compileResult.plan,
      publishedBy: publishedByValue as string | null,
      publishedAt: now,
    },
    compileResult,
  };
}

/** Get a workflow version by ID. */
export async function getWorkflowVersion(versionId: string): Promise<WorkflowVersion | null> {
  const result = await pool.query(`SELECT * FROM workflow_versions WHERE id = $1`, [versionId]);
  if (result.rows.length === 0) return null;
  return rowToVersion(result.rows[0]!);
}

/** List all versions for a workflow, newest first. */
export async function listWorkflowVersions(workflowId: string): Promise<WorkflowVersion[]> {
  const result = await pool.query(
    `SELECT * FROM workflow_versions
     WHERE workflow_id = $1
     ORDER BY version DESC
     LIMIT 50`,
    [workflowId],
  );
  return result.rows.map(rowToVersion);
}

/** Get the latest published version (has compiled_plan) for a workflow. */
export async function getLatestPublishedVersion(
  workflowId: string,
): Promise<WorkflowVersion | null> {
  const result = await pool.query(
    `SELECT * FROM workflow_versions
     WHERE workflow_id = $1 AND compiled_plan IS NOT NULL
     ORDER BY version DESC
     LIMIT 1`,
    [workflowId],
  );
  if (result.rows.length === 0) return null;
  return rowToVersion(result.rows[0]!);
}

/** Compile a workflow definition and return diagnostics (preview, no persistence). */
export async function compileWorkflowPreview(definition: WorkflowDefInput): Promise<CompileResult> {
  return compileWorkflow(definition, {
    resolveTest: async (testVersionId: string) => {
      const testResult = await pool.query(
        `SELECT definition FROM test_case_versions WHERE id = $1`,
        [testVersionId],
      );
      if (testResult.rows.length === 0) return null;
      const testDef = testResult.rows[0]!['definition'] as Record<string, unknown>;
      const request = testDef['request'] as Record<string, unknown> | undefined;
      return {
        method: (request?.['method'] as string) ?? 'GET',
        url: (request?.['url'] as string) ?? '',
        headers: request?.['headers'] as Record<string, string> | undefined,
        body: request?.['body'] as unknown,
        assertions: ((testDef['assertions'] as Array<Record<string, unknown>>) ?? []).map((a) => ({
          target: (a['target'] as string) ?? 'status',
          operator: (a['operator'] as string) ?? 'equals',
          expected: a['expected'],
          description: a['description'] as string | undefined,
        })),
        extract: ((testDef['extract'] as Array<Record<string, unknown>>) ?? []).map((e) => ({
          name: e['name'] as string,
          source: (e['source'] as string) ?? 'body',
          expression: e['expression'] as string,
          scope: e['scope'] as string | undefined,
        })),
        sideEffect: (testDef['sideEffect'] as string) ?? 'read-only',
      };
    },
  });
}
