/**
 * @sketch-test/adapter-har — HAR (HTTP Archive) v1.2 to CanonicalApiModel adapter
 *
 * Converts HAR 1.2 files into the platform's unified CanonicalApiModel.
 * Each HAR entry (request + response pair) becomes an endpoint with its
 * response recorded.
 *
 * M0 scope:
 * - HAR 1.2 JSON
 * - Entries with request (method, url, headers, postData) → Endpoint
 * - Entries with response (status, headers, content) → Response
 * - Query string → Parameter[]
 * - Headers → Parameter[]
 *
 * Invariants:
 * - Failed imports never create a valid model.
 * - All structural elements carry source locations.
 * - Warnings for malformed entries are never silently dropped.
 * - Stable endpoint ids are normalized method + path.
 */
import type {
  ApiSourceMetadata,
  ApiSourceType,
  CanonicalApiModel,
  Endpoint,
  Parameter,
  RequestBody,
  Response,
} from '@sketch-test/canonical-api-model';
import { CANONICAL_API_MODEL_VERSION } from '@sketch-test/canonical-api-model';
import type {
  ContentHash,
  Diagnostic,
  EntityId,
  HttpMethod,
  HttpStatusCode,
  Instant,
  SemanticVersion,
} from '@sketch-test/contracts-common';

// ─── HAR Raw Types ──────────────────────────────────────────────────

interface HarLog {
  version: string;
  entries?: HarEntry[];
}

interface HarEntry {
  request: HarRequest;
  response: HarResponse;
}

interface HarRequest {
  method: string;
  url: string;
  httpVersion?: string;
  headers?: HarHeader[];
  queryString?: HarQueryString[];
  postData?: HarPostData;
  cookies?: HarCookie[];
}

interface HarResponse {
  status: number;
  statusText: string;
  httpVersion?: string;
  headers?: HarHeader[];
  content?: HarContent;
  cookies?: HarCookie[];
  redirectURL?: string;
  headersSize?: number;
  bodySize?: number;
}

interface HarHeader {
  name: string;
  value: string;
}

interface HarQueryString {
  name: string;
  value: string;
}

interface HarPostData {
  mimeType: string;
  text?: string;
  params?: HarParam[];
}

interface HarParam {
  name: string;
  value?: string;
  fileName?: string;
  contentType?: string;
}

interface HarContent {
  mimeType: string;
  text?: string;
  encoding?: string;
  size?: number;
}

interface HarCookie {
  name: string;
  value: string;
  path?: string;
  domain?: string;
  expires?: string;
  httpOnly?: boolean;
  secure?: boolean;
}

// ─── Configuration ──────────────────────────────────────────────────

export interface HarAdapterOptions {
  /** Label for the source document. */
  sourceLabel: string;
  /** Content hash of the raw HAR file. */
  sourceHash: ContentHash;
  /** Parser version identifier. */
  parserVersion?: SemanticVersion;
}

// ─── Import Result ──────────────────────────────────────────────────

export interface ImportResult {
  /** The canonical model, if parsing succeeded. */
  model: CanonicalApiModel | null;
  /** Whether the import produced a valid canonical model. */
  success: boolean;
  /** All diagnostics from the import. */
  diagnostics: Diagnostic[];
}

// ─── Helpers ────────────────────────────────────────────────────────

const HTTP_METHODS = new Set<string>(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

function isHttpMethod(s: string): boolean {
  return HTTP_METHODS.has(s.toLowerCase());
}

function toHttpMethod(s: string): HttpMethod {
  return s.toUpperCase() as HttpMethod;
}

/** Build a stable endpoint id: normalized method + " " + normalized path. */
function endpointId(method: string, path: string): EntityId {
  return `${method.toUpperCase()}-${path}` as EntityId;
}

/** Extract the pathname from a URL, removing query string and fragment. */
function extractPath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname;
  } catch {
    // If URL parsing fails, return the raw url string as-is
    return url;
  }
}

/** Pad a HAR spec version (e.g., "1.2") to semver format (e.g., "1.2.0"). */
function toSemver(version: string): string {
  const parts = version.split('.');
  while (parts.length < 3) parts.push('0');
  // Rejoin only first 3 segments for a clean semver
  return parts.slice(0, 3).join('.');
}

// ─── Source Context ─────────────────────────────────────────────────

/** Immutable context threaded through all mapping functions in a single import. */
interface SourceContext {
  sourceId: EntityId;
  sourceLabel: string;
  sourceVersion: SemanticVersion;
  sourceHash: ContentHash;
  ingestedAt: Instant;
}

// ─── Entry Mapping ──────────────────────────────────────────────────

function mapEntryToEndpoint(
  entry: HarEntry,
  index: number,
  ctx: SourceContext,
): { endpoint: Endpoint; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const request = entry.request;
  const response = entry.response;

  const method = toHttpMethod(request.method);
  const rawPath = extractPath(request.url);
  const id = endpointId(method, rawPath);

  // Map request headers to parameters (in: header)
  const parameters: Parameter[] = [];
  if (request.headers) {
    for (const h of request.headers) {
      parameters.push({
        id: `${id}-header-${h.name}` as EntityId,
        name: h.name,
        in: 'header',
        required: false,
        deprecated: false,
        allowEmptyValue: false,
        sourceLocation: {
          sourceId: ctx.sourceId,
          sourceLabel: ctx.sourceLabel,
          sourceVersion: ctx.sourceVersion,
          sourceHash: ctx.sourceHash,
          location: `log.entries[${index}].request.headers`,
          ingestedAt: ctx.ingestedAt,
        },
      });
    }
  }

  // Map query string to parameters (in: query)
  if (request.queryString) {
    for (const q of request.queryString) {
      parameters.push({
        id: `${id}-query-${q.name}` as EntityId,
        name: q.name,
        in: 'query',
        required: false,
        deprecated: false,
        allowEmptyValue: false,
        sourceLocation: {
          sourceId: ctx.sourceId,
          sourceLabel: ctx.sourceLabel,
          sourceVersion: ctx.sourceVersion,
          sourceHash: ctx.sourceHash,
          location: `log.entries[${index}].request.queryString`,
          ingestedAt: ctx.ingestedAt,
        },
      });
    }
  }

  // Map request body
  const requestBodies: RequestBody[] = [];
  if (request.postData) {
    const contentType = request.postData.mimeType || 'application/octet-stream';
    requestBodies.push({
      id: `${id}-body` as EntityId,
      required: true,
      content: {
        [contentType]: {
          schema: { ref: `/schemas/${id}-requestBody` },
          example: request.postData.text,
        },
      },
      sourceLocation: {
        sourceId: ctx.sourceId,
        sourceLabel: ctx.sourceLabel,
        sourceVersion: ctx.sourceVersion,
        sourceHash: ctx.sourceHash,
        location: `log.entries[${index}].request.postData`,
        ingestedAt: ctx.ingestedAt,
      },
    });
  }

  // Map response
  const responses: Response[] = [];
  const statusCode = response.status as HttpStatusCode;

  const respContent: Record<string, { schema: { ref: string }; example?: unknown }> = {};
  if (response.content) {
    const mimeType = response.content.mimeType || 'application/octet-stream';
    respContent[mimeType] = {
      schema: { ref: `/schemas/${id}-response-${statusCode}` },
      example: response.content.text,
    };
  }

  // Map response headers
  const respHeaders: Record<string, { schema: { ref: string }; description?: string }> = {};
  if (response.headers) {
    for (const h of response.headers) {
      respHeaders[h.name] = {
        schema: { ref: `/schemas/${id}-response-header-${h.name}` },
        description: `Response header from HAR entry ${index}`,
      };
    }
  }

  responses.push({
    id: `${id}-resp-${statusCode}` as EntityId,
    statusCode,
    description: response.statusText || `HTTP ${statusCode}`,
    content: Object.keys(respContent).length > 0 ? respContent : undefined,
    headers: Object.keys(respHeaders).length > 0 ? respHeaders : undefined,
    sourceLocation: {
      sourceId: ctx.sourceId,
      sourceLabel: ctx.sourceLabel,
      sourceVersion: ctx.sourceVersion,
      sourceHash: ctx.sourceHash,
      location: `log.entries[${index}].response`,
      ingestedAt: ctx.ingestedAt,
    },
  });

  const endpoint: Endpoint = {
    id,
    method,
    path: rawPath,
    deprecated: false,
    parameters,
    requestBodies,
    responses,
    sourceLocations: [
      {
        sourceId: ctx.sourceId,
        sourceLabel: ctx.sourceLabel,
        sourceVersion: ctx.sourceVersion,
        sourceHash: ctx.sourceHash,
        location: `log.entries[${index}].request`,
        ingestedAt: ctx.ingestedAt,
      },
    ],
  };

  return { endpoint, diagnostics };
}

// ─── Main Adapter ───────────────────────────────────────────────────

/**
 * Convert a HAR 1.2 document into the platform's CanonicalApiModel.
 *
 * This is the primary entry point for the HAR adapter. It accepts a
 * parsed HAR JSON object and produces a CanonicalApiModel with stable
 * identifiers, source locations, and diagnostics.
 */
export function importHar(har: unknown, options: HarAdapterOptions): ImportResult {
  const diagnostics: Diagnostic[] = [];

  // Validate top-level structure
  if (typeof har !== 'object' || har === null) {
    return {
      model: null,
      success: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'INVALID_HAR',
          message: 'HAR input must be a non-null object.',
        },
      ],
    };
  }

  const harObj = har as { log?: HarLog };
  if (!harObj.log || !Array.isArray(harObj.log.entries)) {
    return {
      model: null,
      success: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'INVALID_HAR_STRUCTURE',
          message: 'HAR must have a top-level "log" object with an "entries" array.',
        },
      ],
    };
  }

  const entries = harObj.log.entries;
  if (entries.length === 0) {
    return {
      model: null,
      success: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'EMPTY_HAR',
          message: 'HAR log.entries array is empty.',
        },
      ],
    };
  }

  const sourceVersion = toSemver(harObj.log.version) as SemanticVersion;
  const sourceId = `har-${options.sourceLabel.replace(/[^a-zA-Z0-9_-]/g, '-')}` as EntityId;

  // Compute ingestion timestamp once at import start — all entities from the
  // same import share the same timestamp, preserving batch-import semantics.
  const ingestedAt = new Date().toISOString() as Instant;

  const ctx: SourceContext = {
    sourceId,
    sourceLabel: options.sourceLabel,
    sourceVersion,
    sourceHash: options.sourceHash,
    ingestedAt,
  };

  // Map each entry to an endpoint
  const endpoints: Endpoint[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    if (!entry || !entry.request || !entry.response) {
      diagnostics.push({
        severity: 'warning',
        code: 'INVALID_HAR_ENTRY',
        message: `HAR entry at index ${i} is missing request or response. Skipping.`,
        path: `log.entries[${i}]`,
      });
      continue;
    }

    if (!isHttpMethod(entry.request.method)) {
      diagnostics.push({
        severity: 'warning',
        code: 'UNSUPPORTED_HTTP_METHOD',
        message: `Unsupported HTTP method "${entry.request.method}" at index ${i}, skipping`,
        path: `log.entries[${i}].request.method`,
      });
      continue;
    }

    const { endpoint, diagnostics: epDiags } = mapEntryToEndpoint(entry, i, ctx);
    diagnostics.push(...epDiags);
    endpoints.push(endpoint);
  }

  if (endpoints.length === 0) {
    return {
      model: null,
      success: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'NO_VALID_ENDPOINTS',
          message: 'No valid endpoints could be extracted from the HAR file.',
        },
        ...diagnostics,
      ],
    };
  }

  // Build metadata
  const metadata: ApiSourceMetadata = {
    sourceId,
    sourceType: 'manual' as ApiSourceType,
    sourceLabel: options.sourceLabel,
    sourceVersion,
    sourceHash: options.sourceHash,
    parserName: '@sketch-test/adapter-har',
    parserVersion: options.parserVersion ?? ('0.1.0' as SemanticVersion),
    ingestedAt,
  };

  const model: CanonicalApiModel = {
    schemaVersion: CANONICAL_API_MODEL_VERSION,
    metadata,
    servers: [],
    securitySchemes: [],
    schemas: {},
    endpoints,
    diagnostics,
  };

  return {
    model,
    success: true,
    diagnostics,
  };
}
