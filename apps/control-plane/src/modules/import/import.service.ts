import { createHash } from 'node:crypto';
import { validateAndImportOpenApiText } from '@sketch-test/adapter-openapi';
import { importPostmanCollectionV3, type PostmanV3Bundle } from '@sketch-test/adapter-postman';
import type { CanonicalApiModel } from '@sketch-test/canonical-api-model';
import { pool } from '../../db/db.js';
import { apiVersionId } from '../../shared/id.js';
import { getObjectStore, type ObjectStore } from '../../shared/object-storage.js';

export interface ImportInput {
  workspaceId: string;
  sourceType: 'url';
  sourceLocation: string;
}

export interface ImportOutput {
  apiVersionId: string;
  endpointCount: number;
  diagnostics: Array<{ level: string; message: string }>;
  sourceObjectKey: string;
}

export interface PostmanV3ImportInput {
  workspaceId: string;
  sourceLocation: string;
  bundle: PostmanV3Bundle;
}

export interface ImportNetworkPolicy {
  allowedHosts: readonly string[];
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  fetch?: typeof fetch;
}

const DEFAULT_MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 3;

function defaultNetworkPolicy(env: NodeJS.ProcessEnv = process.env): ImportNetworkPolicy {
  return {
    allowedHosts: (env['IMPORT_ALLOWED_HOSTS'] ?? '127.0.0.1,localhost,[::1]')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  };
}

function validateImportUrl(value: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ImportError('Import URL must be an absolute HTTP or HTTPS URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ImportError('Import URL must use the http: or https: protocol');
  }
  if (url.username || url.password) {
    throw new ImportError('Import URL must not contain embedded credentials');
  }

  const hostname = url.hostname.toLowerCase();
  const host = url.host.toLowerCase();
  const allowed = allowedHosts.some((candidate) => {
    const normalized = candidate.trim().toLowerCase();
    return normalized === hostname || normalized === host;
  });
  if (!allowed) {
    throw new ImportError(`Import host is not allowed: ${url.host}`);
  }
  return url;
}

async function readResponseWithLimit(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength) {
    const parsedLength = Number.parseInt(declaredLength, 10);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      throw new ImportError(`Import source exceeds the ${maxBytes}-byte size limit`);
    }
  }

  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new ImportError(`Import source exceeds the ${maxBytes}-byte size limit`);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

async function fetchImportSource(
  sourceLocation: string,
  policy: ImportNetworkPolicy,
): Promise<string> {
  const maxBytes = policy.maxBytes ?? DEFAULT_MAX_SOURCE_BYTES;
  const timeoutMs = policy.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = policy.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const fetchFn = policy.fetch ?? fetch;
  let url = validateImportUrl(sourceLocation, policy.allowedHosts);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchFn(url, { redirect: 'manual', signal: controller.signal });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new ImportError('Import redirect is missing a Location header');
        if (redirectCount === maxRedirects) {
          throw new ImportError(`Import exceeded the ${maxRedirects}-redirect limit`);
        }
        await response.body?.cancel();
        url = validateImportUrl(new URL(location, url).href, policy.allowedHosts);
        continue;
      }
      if (!response.ok) {
        throw new ImportError(`Failed to fetch spec from ${url.href}: HTTP ${response.status}`);
      }
      return await readResponseWithLimit(response, maxBytes);
    } catch (error) {
      if (error instanceof ImportError) throw error;
      if (controller.signal.aborted) {
        throw new ImportError(`Import timed out after ${timeoutMs}ms`);
      }
      throw new ImportError(
        `Failed to fetch spec from ${url.href}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new ImportError('Import redirect limit exceeded');
}

export async function importApiSpec(
  input: ImportInput,
  objectStore: ObjectStore = getObjectStore(),
  networkPolicy: ImportNetworkPolicy = defaultNetworkPolicy(),
): Promise<ImportOutput> {
  const rawSpec = await fetchImportSource(input.sourceLocation, networkPolicy);

  const contentHash = createHash('sha256').update(rawSpec).digest('hex');
  const result = await validateAndImportOpenApiText(rawSpec, {
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
  const sourceMediaType = rawSpec.trimStart().startsWith('{')
    ? 'application/json'
    : 'application/yaml';
  const sourceObjectKey = `api-sources/sha256/${contentHash}.source`;
  await objectStore.put(sourceObjectKey, rawSpec, sourceMediaType);

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

function postmanBundleDigest(bundle: PostmanV3Bundle): string {
  const hash = createHash('sha256');
  for (const [path, content] of Object.entries(bundle.files).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    hash.update(path);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  return hash.digest('hex');
}

/**
 * Persist a Postman v3 directory export without collapsing it into one YAML
 * file. Every input resource is content-addressed and the manifest becomes the
 * immutable source referenced by the ApiVersion.
 */
export async function importPostmanV3Bundle(
  input: PostmanV3ImportInput,
  objectStore: ObjectStore = getObjectStore(),
): Promise<ImportOutput> {
  const contentHash = postmanBundleDigest(input.bundle);
  const result = importPostmanCollectionV3(input.bundle, {
    sourceLabel: input.sourceLocation,
    sourceHash: contentHash,
  });
  if (!result.success || !result.model || !result.executionModel) {
    throw new ImportError(
      `Postman v3 import failed: ${result.diagnostics
        .filter((diagnostic) => diagnostic.severity === 'error')
        .map((diagnostic) => diagnostic.message)
        .join('; ')}`,
    );
  }

  const resources = await Promise.all(
    result.executionModel.resources.map(async (resource) => {
      const resourceHash = createHash('sha256').update(resource.content).digest('hex');
      const objectKey = `api-sources/postman-v3/sha256/${resourceHash}.source`;
      await objectStore.put(objectKey, resource.content, resource.mediaType);
      return {
        path: resource.path,
        mediaType: resource.mediaType,
        contentHash: resourceHash,
        objectKey,
      };
    }),
  );
  const sourceObjectKey = `api-sources/postman-v3/sha256/${contentHash}.manifest.json`;
  const manifest = {
    schemaVersion: 'sketch-test.postman-source-manifest/v1',
    format: 'postman-collection/v3.0',
    rootPath: input.bundle.rootPath ?? '',
    contentHash,
    resources,
  };
  await objectStore.put(sourceObjectKey, JSON.stringify(manifest), 'application/json');

  // Raw scripts and extension resources live in object storage, never copied
  // into PostgreSQL JSONB. The durable metadata retains their locations and
  // preserves the complete execution topology for later migration review.
  const redactScriptSources = <T extends { source: string }>(scripts: T[]) =>
    scripts.map(({ source: _source, ...script }) => script);
  const executionMetadata = {
    ...result.executionModel,
    collection: {
      ...result.executionModel.collection,
      scripts: redactScriptSources(result.executionModel.collection.scripts),
    },
    requests: result.executionModel.requests.map((request) => ({
      ...request,
      scripts: redactScriptSources(request.scripts),
    })),
    resources,
  };
  const model: CanonicalApiModel = {
    ...result.model,
    metadata: {
      ...result.model.metadata,
      extra: {
        ...result.model.metadata.extra,
        postmanExecution: executionMetadata,
        postmanMigration: {
          status: 'review-required',
          reason:
            'Postman scripts and extension resources are retained verbatim and must be reviewed before conversion to immutable SketchTest versions.',
        },
      },
    },
  };
  const id = apiVersionId();
  await pool.query(
    `INSERT INTO api_versions
       (id, workspace_id, source_type, source_location, source_object_key, content_hash, spec_json, diagnostics)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      input.workspaceId,
      'postman-v3',
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
    diagnostics: result.diagnostics.map((diagnostic) => ({
      level: diagnostic.severity,
      message: diagnostic.message,
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
