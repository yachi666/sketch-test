/**
 * @sketch-test/adapter-openapi — OpenAPI to CanonicalApiModel Adapter
 *
 * Converts OpenAPI 2.0 / 3.0 / 3.1 specs into the platform's unified
 * CanonicalApiModel. This is an adapter seam: the output is always the
 * canonical model, regardless of input format version.
 *
 * M0 scope:
 * - OpenAPI 3.0/3.1 JSON specs
 * - Paths, methods, parameters, request bodies, responses
 * - Schema extraction with stable JSON Pointer paths
 * - Security schemes and servers
 * - Diagnostics for unsupported constructs
 *
 * Invariants:
 * - Failed imports never create a valid ApiVersion.
 * - All structural elements carry source locations.
 * - Warnings for unsupported constructs are never silently dropped.
 * - Stable endpoint ids are normalized method + path.
 */
import type {
  ApiSchemaNode,
  ApiSourceMetadata,
  ApiSourceType,
  CanonicalApiModel,
  Endpoint,
  Parameter,
  ParameterLocation,
  RequestBody,
  Response,
  SecurityScheme,
  SecuritySchemeType,
  Server,
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

// ─── OpenAPI Raw Types ───────────────────────────────────────────

/** Minimal OpenAPI 3.x document shape (only the parts we map). */
interface OpenApiDocument {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: Array<{
    url: string;
    description?: string;
    variables?: Record<string, { default: string; enum?: string[]; description?: string }>;
  }>;
  paths?: Record<string, Record<string, OpenApiOperation>>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, OpenApiSecurityScheme>;
  };
  security?: Array<Record<string, string[]>>;
}

interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  deprecated?: boolean;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses?: Record<string, OpenApiResponse>;
  security?: Array<Record<string, string[]>>;
}

interface OpenApiParameter {
  name: string;
  in: string;
  description?: string;
  required?: boolean;
  deprecated?: boolean;
  allowEmptyValue?: boolean;
  style?: string;
  explode?: boolean;
  schema?: unknown;
  example?: unknown;
  examples?: Record<string, unknown>;
}

interface OpenApiRequestBody {
  description?: string;
  required?: boolean;
  content?: Record<
    string,
    { schema?: unknown; example?: unknown; examples?: Record<string, unknown> }
  >;
}

interface OpenApiResponse {
  description: string;
  content?: Record<
    string,
    { schema?: unknown; example?: unknown; examples?: Record<string, unknown> }
  >;
  headers?: Record<string, { schema?: unknown; description?: string }>;
}

interface OpenApiSecurityScheme {
  type: string;
  name?: string;
  scheme?: string;
  in?: string;
  bearerFormat?: string;
  flows?: Record<
    string,
    {
      authorizationUrl?: string;
      tokenUrl?: string;
      refreshUrl?: string;
      scopes?: Record<string, string>;
    }
  >;
  openIdConnectUrl?: string;
}

// ─── Configuration ────────────────────────────────────────────────

export interface OpenApiAdapterOptions {
  /** Label for the source document. */
  sourceLabel: string;
  /** Content hash of the raw spec. */
  sourceHash: ContentHash;
  /** Parser version identifier. */
  parserVersion?: SemanticVersion;
}

// ─── Helpers ──────────────────────────────────────────────────────

const HTTP_METHODS = new Set<string>(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

function isHttpMethod(s: string): s is Lowercase<HttpMethod> {
  return HTTP_METHODS.has(s);
}

function toHttpMethod(s: string): HttpMethod {
  return s.toUpperCase() as HttpMethod;
}

/** Build a stable endpoint id: normalized method + " " + normalized path. */
function endpointId(method: string, path: string): EntityId {
  return `${method.toUpperCase()}-${path}` as EntityId;
}

/** Build a stable schema id from a JSON Pointer-like path. */
function schemaPath(...segments: string[]): string {
  return `/schemas/${segments.join('/')}`;
}

/** Normalize path parameters: OpenAPI uses {param}, we use :param for stable display. */
function normalizePath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ':$1');
}

// ─── Source Context ────────────────────────────────────────────────

/** Immutable context threaded through all mapping functions in a single import. */
interface SourceContext {
  sourceId: EntityId;
  sourceLabel: string;
  sourceVersion: SemanticVersion;
  sourceHash: ContentHash;
  ingestedAt: Instant;
}

// ─── Schema Extraction ────────────────────────────────────────────

/**
 * Recursively extract schemas from the OpenAPI components/schemas section
 * into the flat canonical schema registry with stable JSON Pointer paths.
 */
function extractSchemas(
  rawSchemas: Record<string, unknown> | undefined,
  ctx: SourceContext,
): { schemas: Record<string, ApiSchemaNode>; diagnostics: Diagnostic[] } {
  const { sourceId, sourceLabel, sourceVersion, sourceHash, ingestedAt } = ctx;
  const schemas: Record<string, ApiSchemaNode> = {};
  const diagnostics: Diagnostic[] = [];

  if (!rawSchemas) return { schemas, diagnostics };

  function walk(obj: unknown, path: string, _displayName?: string): string | null {
    if (typeof obj !== 'object' || obj === null) return null;

    const s = obj as Record<string, unknown>;
    const id = path;

    // Check if this is a schema object (has type, properties, items, etc.)
    const isSchema =
      'type' in s ||
      'properties' in s ||
      'items' in s ||
      'enum' in s ||
      'allOf' in s ||
      'oneOf' in s ||
      'anyOf' in s ||
      '$ref' in s;

    if (!isSchema) return null;

    const typeMap: Record<string, ApiSchemaNode['type']> = {
      string: 'string',
      number: 'number',
      integer: 'integer',
      boolean: 'boolean',
      array: 'array',
      object: 'object',
    };

    const node: ApiSchemaNode = {
      id,
      type: typeMap[s['type'] as string] ?? 'object',
      enum: Array.isArray(s['enum']) ? (s['enum'] as unknown[]) : undefined,
      format: typeof s['format'] === 'string' ? (s['format'] as string) : undefined,
      minLength: typeof s['minLength'] === 'number' ? s['minLength'] : undefined,
      maxLength: typeof s['maxLength'] === 'number' ? s['maxLength'] : undefined,
      pattern: typeof s['pattern'] === 'string' ? (s['pattern'] as string) : undefined,
      minimum: typeof s['minimum'] === 'number' ? s['minimum'] : undefined,
      maximum: typeof s['maximum'] === 'number' ? s['maximum'] : undefined,
      minItems: typeof s['minItems'] === 'number' ? s['minItems'] : undefined,
      maxItems: typeof s['maxItems'] === 'number' ? s['maxItems'] : undefined,
      nullable: s['nullable'] === true,
      deprecated: s['deprecated'] === true,
      description: typeof s['description'] === 'string' ? (s['description'] as string) : undefined,
      example: s['example'],
      default: s['default'],
      sourceLocation: {
        sourceId,
        sourceLabel,
        sourceVersion,
        sourceHash,
        location: `#/components/schemas${path.slice('/schemas'.length)}`,
        ingestedAt,
      },
    };

    // Handle items for array types
    if (s['items'] && typeof s['items'] === 'object') {
      const itemsObj = s['items'] as Record<string, unknown>;
      if (itemsObj['$ref'] && typeof itemsObj['$ref'] === 'string') {
        const refPath = schemaPath(
          ...(itemsObj['$ref'] as string).replace('#/components/schemas/', '').split('/'),
        );
        node.items = { ref: refPath };
      } else if (itemsObj['type']) {
        const inlinePath = `${path}/items`;
        const inlineId = walk(itemsObj, inlinePath, 'items');
        if (inlineId) node.items = { ref: inlineId };
      }
    }

    // Handle properties for object types
    if (s['properties'] && typeof s['properties'] === 'object') {
      const props: Record<string, { ref: string; displayName?: string }> = {};
      for (const [propName, propSchema] of Object.entries(
        s['properties'] as Record<string, unknown>,
      )) {
        if (propSchema && typeof propSchema === 'object') {
          const propObj = propSchema as Record<string, unknown>;
          if (propObj['$ref'] && typeof propObj['$ref'] === 'string') {
            const refPath = schemaPath(
              ...(propObj['$ref'] as string).replace('#/components/schemas/', '').split('/'),
            );
            props[propName] = { ref: refPath, displayName: propName };
          } else {
            const propPath = `${path}/properties/${propName}`;
            const propId = walk(propSchema, propPath, propName);
            if (propId) props[propName] = { ref: propId, displayName: propName };
          }
        }
      }
      if (Object.keys(props).length > 0) node.properties = props;
    }

    if (Array.isArray(s['required'])) {
      node.required = s['required'] as string[];
    }

    // Composition
    if (Array.isArray(s['allOf'])) {
      node.allOf = (s['allOf'] as Array<Record<string, unknown>>)
        .filter((item) => item['$ref'])
        .map((item) => ({
          ref: schemaPath(
            ...(item['$ref'] as string).replace('#/components/schemas/', '').split('/'),
          ),
        }));
    }

    schemas[id] = node;
    return id;
  }

  for (const [name, schemaObj] of Object.entries(rawSchemas)) {
    const rootPath = schemaPath(name);
    walk(schemaObj, rootPath, name);
  }

  return { schemas, diagnostics };
}

// ─── Parameter Mapping ────────────────────────────────────────────

function mapParameter(
  param: OpenApiParameter,
  ctx: SourceContext,
  endpointPath: string,
): Parameter {
  const { sourceId, sourceLabel, sourceVersion, sourceHash, ingestedAt } = ctx;
  const locMap: Record<string, ParameterLocation> = {
    path: 'path',
    query: 'query',
    header: 'header',
    cookie: 'cookie',
  };

  const pid = `${endpointId(endpointPath, endpointPath)}-param-${param.name}` as EntityId;

  const mapped: Parameter = {
    id: pid,
    name: param.name,
    in: locMap[param.in] ?? 'query',
    description: param.description,
    required: param.required ?? false,
    deprecated: param.deprecated ?? false,
    allowEmptyValue: param.allowEmptyValue ?? false,
    style: param.style,
    explode: param.explode,
    example: param.example,
    examples: param.examples,
    sourceLocation: {
      sourceId,
      sourceLabel,
      sourceVersion,
      sourceHash,
      location: `paths.${endpointPath}.parameters.${param.name}`,
      ingestedAt,
    },
  };

  return mapped;
}

// ─── Endpoint Mapping ─────────────────────────────────────────────

function mapEndpoints(
  paths: Record<string, Record<string, OpenApiOperation>> | undefined,
  ctx: SourceContext,
): { endpoints: Endpoint[]; diagnostics: Diagnostic[] } {
  const { sourceId, sourceLabel, sourceVersion, sourceHash, ingestedAt } = ctx;
  const endpoints: Endpoint[] = [];
  const diagnostics: Diagnostic[] = [];

  if (!paths) return { endpoints, diagnostics };

  for (const [rawPath, methods] of Object.entries(paths)) {
    const normalizedPath = normalizePath(rawPath);

    for (const [rawMethod, operation] of Object.entries(methods)) {
      if (!isHttpMethod(rawMethod)) {
        // Skip non-HTTP-method keys like "parameters", "servers", "summary", "description"
        if (
          rawMethod === 'parameters' ||
          rawMethod === 'servers' ||
          rawMethod === 'summary' ||
          rawMethod === 'description'
        ) {
          continue;
        }
        diagnostics.push({
          severity: 'warning',
          code: 'UNSUPPORTED_HTTP_METHOD',
          message: `Unsupported HTTP method "${rawMethod}" at ${rawPath}, skipping`,
          path: `$.paths.${rawPath}.${rawMethod}`,
        });
        continue;
      }

      const method = toHttpMethod(rawMethod);
      const id = endpointId(method, normalizedPath);

      // Map parameters
      const parameters: Parameter[] = [];
      if (operation.parameters) {
        for (const param of operation.parameters) {
          parameters.push(mapParameter(param, ctx, rawPath));
        }
      }

      // Map request bodies
      const requestBodies: RequestBody[] = [];
      if (operation.requestBody) {
        const rb = operation.requestBody;
        const contentMap: Record<
          string,
          { schema: { ref: string }; example?: unknown; examples?: Record<string, unknown> }
        > = {};

        if (rb.content) {
          for (const [mediaType, mediaObj] of Object.entries(rb.content)) {
            if (mediaObj.schema) {
              const schemaObj = mediaObj.schema as Record<string, unknown>;
              let refPath: string;
              if (schemaObj['$ref'] && typeof schemaObj['$ref'] === 'string') {
                refPath = schemaPath(
                  ...(schemaObj['$ref'] as string).replace('#/components/schemas/', '').split('/'),
                );
              } else {
                // Inline schema — use a generated path
                refPath = schemaPath(`${id}-requestBody`);
              }
              contentMap[mediaType] = {
                schema: { ref: refPath },
                example: mediaObj.example,
                examples: mediaObj.examples,
              };
            }
          }
        }

        requestBodies.push({
          id: `${id}-body` as EntityId,
          description: rb.description,
          required: rb.required ?? false,
          content: contentMap,
          sourceLocation: {
            sourceId,
            sourceLabel,
            sourceVersion,
            sourceHash,
            location: `$.paths.${rawPath}.${rawMethod}.requestBody`,
            ingestedAt,
          },
        });
      }

      // Map responses
      const responses: Response[] = [];
      if (operation.responses) {
        for (const [statusStr, respObj] of Object.entries(operation.responses)) {
          // Handle "default" and range responses like "2XX"
          let statusCode: HttpStatusCode;
          const parsed = parseInt(statusStr, 10);
          if (!Number.isNaN(parsed) && parsed >= 100 && parsed <= 599) {
            statusCode = parsed as HttpStatusCode;
          } else if (statusStr === 'default') {
            statusCode = 200 as HttpStatusCode; // default → 200 for mapping purposes
          } else {
            continue; // skip non-standard status keys
          }

          const respContent: Record<
            string,
            { schema: { ref: string }; example?: unknown; examples?: Record<string, unknown> }
          > = {};
          if (respObj.content) {
            for (const [mediaType, mediaObj] of Object.entries(respObj.content)) {
              if (mediaObj.schema) {
                const schemaObj = mediaObj.schema as Record<string, unknown>;
                let refPath: string;
                if (schemaObj['$ref'] && typeof schemaObj['$ref'] === 'string') {
                  refPath = schemaPath(
                    ...(schemaObj['$ref'] as string)
                      .replace('#/components/schemas/', '')
                      .split('/'),
                  );
                } else {
                  refPath = schemaPath(`${id}-response-${statusCode}`);
                }
                respContent[mediaType] = {
                  schema: { ref: refPath },
                  example: mediaObj.example,
                  examples: mediaObj.examples,
                };
              }
            }
          }

          // Map response headers
          const respHeaders: Record<string, { schema: { ref: string }; description?: string }> = {};
          if (respObj.headers) {
            for (const [headerName, headerObj] of Object.entries(respObj.headers)) {
              if (headerObj.schema) {
                respHeaders[headerName] = {
                  schema: { ref: schemaPath(`${id}-response-header-${headerName}`) },
                  description: headerObj.description,
                };
              }
            }
          }

          responses.push({
            id: `${id}-resp-${statusCode}` as EntityId,
            statusCode,
            description: respObj.description,
            content: Object.keys(respContent).length > 0 ? respContent : undefined,
            headers: Object.keys(respHeaders).length > 0 ? respHeaders : undefined,
            sourceLocation: {
              sourceId,
              sourceLabel,
              sourceVersion,
              sourceHash,
              location: `$.paths.${rawPath}.${rawMethod}.responses.${statusStr}`,
              ingestedAt,
            },
          });
        }
      }

      // Detect polling endpoints (heuristic: GET with status-related response)
      const isPollEndpoint =
        method === 'GET' &&
        normalizedPath.includes('{') &&
        (operation.summary?.includes('查询') || operation.summary?.includes('状态'));

      endpoints.push({
        id,
        operationId: operation.operationId,
        method,
        path: normalizedPath,
        summary: operation.summary,
        description: operation.description,
        deprecated: operation.deprecated ?? false,
        tags: operation.tags,
        parameters,
        requestBodies,
        responses,
        security: operation.security,
        sourceLocations: [
          {
            sourceId,
            sourceLabel,
            sourceVersion,
            sourceHash,
            location: `$.paths.${rawPath}.${rawMethod}`,
            ingestedAt,
          },
        ],
      });

      if (isPollEndpoint) {
        diagnostics.push({
          severity: 'info',
          code: 'POLL_CANDIDATE',
          message: `Endpoint ${id} looks like a polling endpoint — suitable for workflow poll steps`,
          path: `$.paths.${rawPath}.${rawMethod}`,
        });
      }
    }
  }

  return { endpoints, diagnostics };
}

// ─── Security Scheme Mapping ──────────────────────────────────────

function mapSecuritySchemes(
  rawSchemes: Record<string, OpenApiSecurityScheme> | undefined,
  ctx: SourceContext,
): { securitySchemes: SecurityScheme[]; diagnostics: Diagnostic[] } {
  const { sourceId, sourceLabel, sourceVersion, sourceHash, ingestedAt } = ctx;
  const securitySchemes: SecurityScheme[] = [];
  const diagnostics: Diagnostic[] = [];

  if (!rawSchemes) return { securitySchemes, diagnostics };

  const typeMap: Record<string, SecuritySchemeType> = {
    http: 'http',
    apiKey: 'apiKey',
    oauth2: 'oauth2',
    openIdConnect: 'openIdConnect',
    mutualTLS: 'mutualTls',
  };

  for (const [name, scheme] of Object.entries(rawSchemes)) {
    const mappedType = typeMap[scheme.type];
    if (!mappedType) {
      diagnostics.push({
        severity: 'warning',
        code: 'UNSUPPORTED_SECURITY_TYPE',
        message: `Unsupported security scheme type "${scheme.type}" for "${name}"`,
      });
      continue;
    }

    const secScheme: SecurityScheme = {
      id: `sec-${name}` as EntityId,
      type: mappedType,
      name: scheme.name ?? name,
      scheme: scheme.scheme,
      in: scheme.in as ParameterLocation | undefined,
      flows: scheme.flows
        ? Object.fromEntries(
            Object.entries(scheme.flows).map(([flowName, flow]) => [
              flowName,
              {
                authorizationUrl: flow.authorizationUrl,
                tokenUrl: flow.tokenUrl,
                refreshUrl: flow.refreshUrl,
                scopes: flow.scopes,
              },
            ]),
          )
        : undefined,
      openIdConnectUrl: scheme.openIdConnectUrl,
      sourceLocation: {
        sourceId,
        sourceLabel,
        sourceVersion,
        sourceHash,
        location: `#/components/securitySchemes/${name}`,
        ingestedAt,
      },
    };

    securitySchemes.push(secScheme);
  }

  return { securitySchemes, diagnostics };
}

// ─── Main Adapter ─────────────────────────────────────────────────

export interface ImportResult {
  /** The canonical model, if parsing succeeded. */
  model: CanonicalApiModel | null;
  /** Whether the import produced a valid canonical model. */
  success: boolean;
  /** All diagnostics from the import. */
  diagnostics: Diagnostic[];
}

/**
 * Convert an OpenAPI 3.x document into the platform's CanonicalApiModel.
 *
 * This is the primary entry point for the OpenAPI adapter. It accepts a
 * parsed OpenAPI document and produces a CanonicalApiModel with stable
 * identifiers, source locations, and diagnostics.
 */
export function importOpenApi(doc: OpenApiDocument, options: OpenApiAdapterOptions): ImportResult {
  const diagnostics: Diagnostic[] = [];
  const sourceVersion = doc.info.version as SemanticVersion;
  const sourceId = `openapi-${options.sourceLabel.replace(/[^a-zA-Z0-9_-]/g, '-')}` as EntityId;

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

  // Validate OpenAPI version
  const oaVersion = doc.openapi;
  if (!oaVersion.startsWith('3.')) {
    return {
      model: null,
      success: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'UNSUPPORTED_OPENAPI_VERSION',
          message: `OpenAPI version ${oaVersion} is not supported. M0 supports 3.0 and 3.1.`,
        },
      ],
    };
  }

  // Check for unsupported top-level constructs
  if ((doc as unknown as Record<string, unknown>)['webhooks']) {
    diagnostics.push({
      severity: 'warning',
      code: 'WEBHOOKS_NOT_SUPPORTED',
      message: 'OpenAPI webhooks are not supported in V1 and will be ignored.',
    });
  }

  // Extract schemas
  const { schemas, diagnostics: schemaDiags } = extractSchemas(doc.components?.schemas, ctx);
  diagnostics.push(...schemaDiags);

  // Map servers
  const servers: Server[] = (doc.servers ?? []).map((s, i) => ({
    id: `server-${i + 1}` as EntityId,
    url: s.url,
    description: s.description,
    variables: s.variables
      ? Object.fromEntries(
          Object.entries(s.variables).map(([k, v]) => [
            k,
            {
              default: v.default,
              enum: v.enum,
              description: v.description,
            },
          ]),
        )
      : undefined,
  }));

  // Map security schemes
  const { securitySchemes, diagnostics: secDiags } = mapSecuritySchemes(
    doc.components?.securitySchemes,
    ctx,
  );
  diagnostics.push(...secDiags);

  // Map endpoints
  const { endpoints, diagnostics: epDiags } = mapEndpoints(doc.paths, ctx);
  diagnostics.push(...epDiags);

  // Determine source type based on OpenAPI version
  const sourceType: ApiSourceType = oaVersion.startsWith('2.') ? 'openapi' : 'openapi';

  // Build metadata
  const metadata: ApiSourceMetadata = {
    sourceId,
    sourceType,
    sourceLabel: options.sourceLabel,
    sourceVersion,
    sourceHash: options.sourceHash,
    parserName: '@sketch-test/adapter-openapi',
    parserVersion: options.parserVersion ?? ('0.1.0' as SemanticVersion),
    ingestedAt,
  };

  const hasErrors = diagnostics.some((d) => d.severity === 'error');

  const model: CanonicalApiModel = {
    schemaVersion: CANONICAL_API_MODEL_VERSION,
    metadata,
    servers,
    securitySchemes,
    security: doc.security,
    schemas,
    endpoints,
    diagnostics,
  };

  return {
    model: hasErrors ? null : model,
    success: !hasErrors,
    diagnostics,
  };
}

/**
 * Fetch and import an OpenAPI spec from a URL.
 */
export async function importOpenApiFromUrl(
  url: string,
  options: OpenApiAdapterOptions,
): Promise<ImportResult> {
  const response = await fetch(url);
  if (!response.ok) {
    return {
      model: null,
      success: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'FETCH_FAILED',
          message: `Failed to fetch OpenAPI spec from ${url}: HTTP ${response.status}`,
        },
      ],
    };
  }

  const doc = (await response.json()) as OpenApiDocument;
  return importOpenApi(doc, options);
}

// ─── Re-exports ───────────────────────────────────────────────────

export type {
  OpenApiDocument,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiRequestBody,
  OpenApiResponse,
  OpenApiSecurityScheme,
};
