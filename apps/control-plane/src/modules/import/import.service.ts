import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { importOpenApi } from '@sketch-test/adapter-openapi';
import type { CanonicalApiModel } from '@sketch-test/canonical-api-model';
import { pool } from '../../db/db.js';
import { apiVersionId } from '../../shared/id.js';
import { getObjectStore, type ObjectStore } from '../../shared/object-storage.js';

export interface ImportInput {
  workspaceId: string;
  sourceType: 'file' | 'url';
  sourceLocation: string;
}

export interface ImportOutput {
  apiVersionId: string;
  endpointCount: number;
  diagnostics: Array<{ level: string; message: string }>;
  sourceObjectKey: string;
}

export async function importApiSpec(
  input: ImportInput,
  objectStore: ObjectStore = getObjectStore(),
): Promise<ImportOutput> {
  let rawSpec: string;

  if (input.sourceType === 'file') {
    rawSpec = readFileSync(input.sourceLocation, 'utf-8');
  } else {
    const response = await fetch(input.sourceLocation);
    if (!response.ok) {
      throw new ImportError(
        `Failed to fetch spec from ${input.sourceLocation}: HTTP ${response.status}`,
      );
    }
    rawSpec = await response.text();
  }

  const contentHash = createHash('sha256').update(rawSpec).digest('hex');
  const doc = JSON.parse(rawSpec);

  const result = importOpenApi(doc, {
    sourceLabel: input.sourceLocation,
    sourceHash: contentHash,
  });

  if (!result.success) {
    throw new ImportError(
      `Import failed: ${result.diagnostics
        .filter((d) => d.severity === 'error')
        .map((d) => d.message)
        .join('; ')}`,
    );
  }

  const id = apiVersionId();
  const model = result.model as CanonicalApiModel;
  const sourceObjectKey = `api-sources/sha256/${contentHash}.json`;
  await objectStore.put(sourceObjectKey, rawSpec, 'application/json');

  await pool.query(
    `INSERT INTO api_versions
       (id, workspace_id, source_type, source_location, source_object_key, content_hash, spec_json, diagnostics)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      input.workspaceId,
      input.sourceType,
      input.sourceLocation,
      sourceObjectKey,
      contentHash,
      JSON.stringify(model),
      JSON.stringify(result.diagnostics),
    ],
  );

  return {
    apiVersionId: id,
    endpointCount: model.endpoints.length,
    diagnostics: result.diagnostics.map((d) => ({
      level: d.severity,
      message: d.message,
    })),
    sourceObjectKey,
  };
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}
