import { createHash } from 'node:crypto';
import { type ArazzoOpenApiSourceBinding, importArazzoText } from '@sketch-test/adapter-arazzo';
import { type CanonicalApiModel, CanonicalApiModelSchema } from '@sketch-test/canonical-api-model';
import { type WorkflowDefinition, WorkflowDefinitionSchema } from '@sketch-test/workflow-dsl';
import { pool } from '../../db/db.js';
import { workflowId, workflowVersionId } from '../../shared/id.js';
import { getObjectStore, type ObjectStore } from '../../shared/object-storage.js';

export interface ImportArazzoInput {
  workspaceId: string;
  sourceText: string;
  sourceLocation: string;
  /** Source Description Object name → immutable ApiVersion id. */
  sources: Record<string, string>;
}

export interface ImportedArazzoWorkflow {
  workflowId: string;
  workflowVersionId: string;
  name: string;
}

export interface ImportArazzoOutput {
  workflows: ImportedArazzoWorkflow[];
  diagnostics: Array<{ level: string; code: string; message: string; path?: string }>;
  sourceObjectKey: string;
  contentHash: string;
}

interface ApiVersionRow {
  id: string;
  source_location: string;
  content_hash: string;
  spec_json: unknown;
}

export async function importArazzoWorkflows(
  input: ImportArazzoInput,
  objectStore: ObjectStore = getObjectStore(),
): Promise<ImportArazzoOutput> {
  const sourceEntries = Object.entries(input.sources);
  if (sourceEntries.length === 0) {
    throw new ArazzoImportError('At least one ApiVersion source binding is required');
  }

  const apiVersionIds = [...new Set(sourceEntries.map(([, apiVersionId]) => apiVersionId))];
  const result = await pool.query(
    `SELECT id, source_location, content_hash, spec_json
     FROM api_versions
     WHERE workspace_id = $1 AND id = ANY($2::text[])`,
    [input.workspaceId, apiVersionIds],
  );
  const rows = new Map((result.rows as ApiVersionRow[]).map((row) => [row.id, row] as const));

  const bindings: Record<string, ArazzoOpenApiSourceBinding> = {};
  for (const [sourceName, apiVersionId] of sourceEntries) {
    const row = rows.get(apiVersionId);
    if (!row) {
      throw new ArazzoImportError(
        `ApiVersion ${apiVersionId} was not found in the authenticated workspace`,
      );
    }
    const parsedModel = CanonicalApiModelSchema.safeParse(row.spec_json);
    if (!parsedModel.success) {
      throw new ArazzoImportError(`ApiVersion ${apiVersionId} has an invalid canonical model`);
    }
    bindings[sourceName] = {
      model: parsedModel.data as CanonicalApiModel,
      retrievalUrl: row.source_location,
      contentHash: row.content_hash,
    };
  }

  const imported = importArazzoText(input.sourceText, {
    sourceLabel: input.sourceLocation,
    documentUrl: input.sourceLocation,
    openApiSources: bindings,
    requireVerifiedSources: true,
  });
  if (!imported.success) {
    throw new ArazzoImportError(
      `Arazzo import failed: ${imported.diagnostics
        .filter((entry) => entry.severity === 'error')
        .map((entry) => `${entry.code}: ${entry.message}`)
        .join('; ')}`,
    );
  }

  const contentHash = createHash('sha256').update(input.sourceText).digest('hex');
  const sourceObjectKey = `workflow-sources/sha256/${contentHash}.arazzo`;
  const sourceMediaType = input.sourceText.trimStart().startsWith('{')
    ? 'application/json'
    : 'application/yaml';
  await objectStore.put(sourceObjectKey, input.sourceText, sourceMediaType);

  const definitions = imported.workflows.map((workflow) =>
    WorkflowDefinitionSchema.parse({
      ...workflow,
      source: {
        type: 'arazzo',
        sourceLabel: input.sourceLocation,
        sourceObjectKey,
        contentHash,
        specificationVersion: '1.1.0',
      },
    }),
  );

  const client = await pool.connect();
  const created: ImportedArazzoWorkflow[] = [];
  try {
    await client.query('BEGIN');
    const now = new Date().toISOString();
    for (const definition of definitions) {
      const newWorkflowId = workflowId();
      const newVersionId = workflowVersionId();
      await client.query(
        `INSERT INTO workflows (id, workspace_id, name, description, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5)`,
        [newWorkflowId, input.workspaceId, definition.name, definition.description ?? '', now],
      );
      const storedDefinition: WorkflowDefinition = { ...definition, id: newWorkflowId };
      await client.query(
        `INSERT INTO workflow_versions
           (id, workflow_id, version, definition, compiled_plan, published_at)
         VALUES ($1, $2, 1, $3, NULL, $4)`,
        [newVersionId, newWorkflowId, JSON.stringify(storedDefinition), now],
      );
      created.push({
        workflowId: newWorkflowId,
        workflowVersionId: newVersionId,
        name: definition.name,
      });
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return {
    workflows: created,
    diagnostics: imported.diagnostics.map((entry) => ({
      level: entry.severity,
      code: entry.code,
      message: entry.message,
      path: entry.path,
    })),
    sourceObjectKey,
    contentHash,
  };
}

export class ArazzoImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArazzoImportError';
  }
}
