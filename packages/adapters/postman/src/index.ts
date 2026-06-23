/**
 * @sketch-test/adapter-postman — Postman Collection v2.1 Adapter
 *
 * Converts Postman Collection v2.1 exports and Postman Environments into
 * the platform's CanonicalApiModel. This is the main entry point for the
 * Postman adapter, wiring together parsing, variable resolution, endpoint
 * mapping, auth extraction, and workflow hint generation.
 *
 * Usage:
 *   import { importPostmanCollection } from '@sketch-test/adapter-postman';
 *   const result = importPostmanCollection(rawCollection, { sourceLabel, sourceHash });
 *
 * Invariants:
 * - Failed imports always return `success: false` with `model: null`.
 * - All structural elements carry source provenance metadata.
 * - Warnings for unsupported constructs are never silently dropped.
 * - Stable endpoint IDs are derived from HTTP method + normalized path.
 * - The output always passes CanonicalApiModelSchema validation.
 */
import type {
  ApiSourceMetadata,
  ApiSourceType,
  CanonicalApiModel,
  Endpoint,
  SecurityScheme,
} from '@sketch-test/canonical-api-model';
import {
  CANONICAL_API_MODEL_VERSION,
  CanonicalApiModelSchema,
} from '@sketch-test/canonical-api-model';
import type {
  ContentHash,
  Diagnostic,
  EntityId,
  Instant,
  SemanticVersion,
} from '@sketch-test/contracts-common';
import { mapAuth } from './mapper/auth.js';
import { flattenItems, mapToEndpoint } from './mapper/endpoints.js';
import { mapWorkflowHints } from './mapper/folders.js';
import type { SourceContext } from './mapper/shared.js';
import { expandTemplate, resolveVariables } from './mapper/variables.js';
import { extractAssertions } from './mapper/assertions.js';
import { parseCollection } from './parser/collection.js';
import { parseEnvironment } from './parser/environment.js';

// ─── Configuration ────────────────────────────────────────────────

export interface PostmanAdapterOptions {
  /** Label for the source document. */
  sourceLabel: string;
  /** Content hash of the raw collection. */
  sourceHash: ContentHash;
  /** Parser version identifier. */
  parserVersion?: SemanticVersion;
  /** Optional Postman environment for variable resolution. */
  environment?: {
    name: string;
    values: Array<{
      key: string;
      value: string;
      type?: string;
      description?: string;
      disabled?: boolean;
    }>;
  };
  /** Whether to import auth schemes. Defaults to true. */
  importAuth?: boolean;
  /** Whether to flatten folders into endpoint tags. Defaults to true. */
  foldersToTags?: boolean;
}

export interface ImportResult {
  /** The canonical model, if parsing succeeded. */
  model: CanonicalApiModel | null;
  /** Whether the import produced a valid canonical model. */
  success: boolean;
  /** All diagnostics from the import. */
  diagnostics: Diagnostic[];
}

// ─── Helpers ──────────────────────────────────────────────────────

/** Build an immutable source context threaded through all mapping. */
function makeSourceContext(
  options: PostmanAdapterOptions,
  sourceVersion: string | undefined,
): SourceContext {
  const sourceId = `postman-${options.sourceLabel.replace(/[^a-zA-Z0-9_-]/g, '-')}` as EntityId;
  const ingestedAt = new Date().toISOString() as Instant;
  return {
    sourceId,
    sourceLabel: options.sourceLabel,
    sourceVersion: (sourceVersion || '1.0.0') as SemanticVersion,
    sourceHash: options.sourceHash,
    ingestedAt,
  };
}

// ─── Main Adapter ─────────────────────────────────────────────────

/**
 * Convert a Postman Collection v2.1 document into the platform's CanonicalApiModel.
 *
 * This is the primary entry point for the Postman adapter. It accepts a
 * raw Postman Collection (parsed object or JSON string) and produces a
 * CanonicalApiModel with stable identifiers, source locations, and diagnostics.
 *
 * Processing flow:
 * 1. Parse collection (validates structure, handles v1 rejection)
 * 2. Resolve collection and environment variables
 * 3. Flatten nested folder hierarchy into flat item list
 * 4. Extract collection-level auth schemes
 * 5. Map each flat item to a canonical Endpoint
 * 6. Extract workflow hints from folder structure
 * 7. Build and validate CanonicalApiModel with Zod
 */
export function importPostmanCollection(
  raw: unknown,
  options: PostmanAdapterOptions,
): ImportResult {
  const diagnostics: Diagnostic[] = [];

  // 1. Parse collection
  const { collection, diagnostics: parseDiags } = parseCollection(raw);
  diagnostics.push(...parseDiags);
  if (!collection) {
    return { model: null, success: false, diagnostics };
  }

  // 2. Build source context
  const ctx = makeSourceContext(options, collection.info.version);

  // 3. Resolve variables (collection + optional environment)
  const scope = resolveVariables(collection.variable, options.environment?.values);

  // 4. Flatten items (folders → tags with folder paths)
  const flatItems = flattenItems(collection.item);

  // If foldersToTags is disabled, clear tags accumulated by flattenItems
  if (options.foldersToTags === false) {
    for (const fi of flatItems) {
      fi.tags = [];
      fi.folderPath = '';
    }
  }

  // 5. Extract collection-level auth (unless importAuth is explicitly disabled)
  let securitySchemes: SecurityScheme[] = [];
  let securityRequirement: Record<string, string[]> | undefined;
  if (options.importAuth !== false) {
    const authResult = mapAuth(undefined, collection.auth, ctx);
    securitySchemes = authResult.securitySchemes;
    securityRequirement = authResult.securityRequirement;
    diagnostics.push(...authResult.diagnostics);
  }

  // 6. Expand templates in flat items using the resolved variable scope.
  //    This must happen before endpoint mapping so that {{var}} patterns
  //    in paths, headers, URL params, and auth are resolved.
  for (const fi of flatItems) {
    const req = fi.item.request;
    if (!req) continue;

    // Expand templates in URL
    if (typeof req.url === 'string') {
      req.url = expandTemplate(req.url, scope);
    } else if (req.url?.raw) {
      req.url.raw = expandTemplate(req.url.raw, scope);
      if (req.url.path) {
        req.url.path = req.url.path.map((p) => expandTemplate(p, scope));
      }
      if (req.url.query) {
        for (const q of req.url.query) {
          q.value = expandTemplate(q.value, scope);
        }
      }
      if (req.url.variable) {
        for (const v of req.url.variable) {
          v.value = expandTemplate(v.value, scope);
        }
      }
    }

    // Expand templates in headers
    if (req.header) {
      for (const h of req.header) {
        h.value = expandTemplate(h.value, scope);
      }
    }

    // Expand templates in item-level auth params
    if (req.auth) {
      for (const key of Object.keys(req.auth)) {
        if (key !== 'type' && typeof req.auth[key] === 'string') {
          (req.auth as Record<string, unknown>)[key] = expandTemplate(
            req.auth[key] as string,
            scope,
          );
        }
      }
    }
  }

  // 7. Map each flat item to a canonical Endpoint
  const endpoints: Endpoint[] = [];
  for (const fi of flatItems) {
    const { endpoint, diagnostics: epDiags } = mapToEndpoint(fi, ctx);

    // Extract assertions from Postman test scripts
    if (fi.item.event) {
      const { assertions, rawScripts } = extractAssertions(fi.item.event);
      if (assertions.length > 0 || rawScripts.length > 0) {
        endpoint.extra = { ...endpoint.extra };
        if (assertions.length > 0) {
          endpoint.extra['assertions'] = assertions;
        }
        if (rawScripts.length > 0) {
          endpoint.extra['rawScripts'] = rawScripts;
        }
      }
    }

    endpoints.push(endpoint);
    diagnostics.push(...epDiags);
  }

  // 8. Extract workflow hints from folder structure
  const workflowHints = mapWorkflowHints(flatItems);

  // 9. Build source metadata
  const sourceType: ApiSourceType = 'manual';
  const metadata: ApiSourceMetadata = {
    sourceId: ctx.sourceId,
    sourceType,
    sourceLabel: options.sourceLabel,
    sourceVersion: ctx.sourceVersion,
    sourceHash: options.sourceHash,
    parserName: '@sketch-test/adapter-postman',
    parserVersion: options.parserVersion ?? ('0.1.0' as SemanticVersion),
    ingestedAt: ctx.ingestedAt,
    extra: {
      collectionName: collection.info.name,
      collectionDescription: collection.info.description,
      workflowHints: workflowHints.length > 0 ? workflowHints : undefined,
      variableScope: Object.fromEntries(scope.variables),
      dynamicVariables: scope.dynamicVariables.length > 0 ? scope.dynamicVariables : undefined,
      unresolvedVariables: scope.unresolved.length > 0 ? scope.unresolved : undefined,
    },
  };

  // 9. Determine overall success
  const hasErrors = diagnostics.some((d) => d.severity === 'error');

  // 10. Build CanonicalApiModel
  const model: CanonicalApiModel = {
    schemaVersion: CANONICAL_API_MODEL_VERSION,
    metadata,
    servers: [],
    securitySchemes,
    security: securityRequirement ? [securityRequirement] : undefined,
    schemas: {},
    endpoints,
    diagnostics,
  };

  // 11. Validate with Zod
  const parsed = CanonicalApiModelSchema.safeParse(model);
  if (!parsed.success) {
    diagnostics.push({
      severity: 'error',
      code: 'VALIDATION_ERROR',
      message: `CanonicalApiModel validation failed: ${parsed.error.message}`,
    });
    return { model: null, success: false, diagnostics };
  }

  return { model: parsed.data, success: !hasErrors, diagnostics };
}

/**
 * Convert a Postman Environment into a minimal CanonicalApiModel.
 *
 * Postman Environments are variable sets that can be used during collection
 * import for variable resolution. The environment variables are stored in
 * metadata.extra for downstream consumption.
 */
export function importPostmanEnvironment(
  raw: unknown,
  options: { sourceLabel: string; sourceHash: ContentHash },
): ImportResult {
  const diagnostics: Diagnostic[] = [];

  // Parse environment
  const { env, diagnostics: parseDiags } = parseEnvironment(raw);
  diagnostics.push(...parseDiags);
  if (!env) {
    return { model: null, success: false, diagnostics };
  }

  // Build source context
  const sourceId = `postman-env-${options.sourceLabel.replace(/[^a-zA-Z0-9_-]/g, '-')}` as EntityId;
  const ingestedAt = new Date().toISOString() as Instant;
  const ctx: SourceContext = {
    sourceId,
    sourceLabel: options.sourceLabel,
    sourceVersion: '1.0.0' as SemanticVersion,
    sourceHash: options.sourceHash,
    ingestedAt,
  };

  // Collect environment variables (skip disabled)
  const envVars: Record<string, string> = {};
  for (const v of env.values) {
    if (!v.disabled) {
      envVars[v.key] = v.value;
    }
  }

  const metadata: ApiSourceMetadata = {
    sourceId: ctx.sourceId,
    sourceType: 'manual' as ApiSourceType,
    sourceLabel: options.sourceLabel,
    sourceVersion: ctx.sourceVersion,
    sourceHash: options.sourceHash,
    parserName: '@sketch-test/adapter-postman',
    parserVersion: '0.1.0' as SemanticVersion,
    ingestedAt: ctx.ingestedAt,
    extra: {
      environmentName: env.name,
      variables: envVars,
      variableCount: Object.keys(envVars).length,
    },
  };

  const hasErrors = diagnostics.some((d) => d.severity === 'error');

  const model: CanonicalApiModel = {
    schemaVersion: CANONICAL_API_MODEL_VERSION,
    metadata,
    servers: [],
    securitySchemes: [],
    schemas: {},
    endpoints: [],
    diagnostics,
  };

  // Validate with Zod
  const parsed = CanonicalApiModelSchema.safeParse(model);
  if (!parsed.success) {
    diagnostics.push({
      severity: 'error',
      code: 'VALIDATION_ERROR',
      message: `CanonicalApiModel validation failed: ${parsed.error.message}`,
    });
    return { model: null, success: false, diagnostics };
  }

  return { model: parsed.data, success: !hasErrors, diagnostics };
}

// ─── Re-exports ───────────────────────────────────────────────────
export { parseCollection } from './parser/collection.js';
export { parseEnvironment } from './parser/environment.js';
