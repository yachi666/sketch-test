/**
 * @sketch-test/adapter-openapi — OpenAPI to CanonicalApiModel Adapter
 *
 * Converts OpenAPI 2.0 / 3.0 / 3.1 specs into the platform's unified
 * CanonicalApiModel. This is an adapter seam: the output is always the
 * canonical model, regardless of input format version.
 *
 * Supported scope:
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

import { Validator } from '@seriousme/openapi-schema-validator';
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
import {
  CANONICAL_API_MODEL_VERSION,
  CanonicalApiModelSchema,
} from '@sketch-test/canonical-api-model';
import type {
  ContentHash,
  Diagnostic,
  EntityId,
  HttpMethod,
  HttpStatusCode,
  Instant,
  SemanticVersion,
} from '@sketch-test/contracts-common';
import { SemanticVersionSchema } from '@sketch-test/contracts-common';
import { parseDocument } from 'yaml';

// ─── OpenAPI Raw Types ───────────────────────────────────────────

/** Minimal OpenAPI 3.x document shape (only the parts we map). */
interface OpenApiDocument {
  openapi: string;
  $self?: string;
  jsonSchemaDialect?: string;
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
  tags?: Array<{
    name: string;
    summary?: string;
    description?: string;
    parent?: string;
    kind?: string;
  }>;
  paths?: Record<string, OpenApiPathItem>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, OpenApiSecurityScheme>;
  };
  security?: Array<Record<string, string[]>>;
}

interface OpenApiPathItem {
  parameters?: OpenApiParameter[];
  servers?: unknown[];
  summary?: string;
  description?: string;
  additionalOperations?: Record<string, OpenApiOperation>;
  [key: string]: OpenApiOperation | OpenApiParameter[] | Record<string, OpenApiOperation> | unknown;
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
  servers?: unknown[];
}

interface OpenApiParameter {
  name?: string;
  in: string;
  description?: string;
  required?: boolean;
  deprecated?: boolean;
  allowEmptyValue?: boolean;
  style?: string;
  explode?: boolean;
  schema?: unknown;
  content?: Record<string, OpenApiMediaType>;
  example?: unknown;
  examples?: Record<string, unknown>;
}

interface OpenApiMediaType {
  schema?: unknown;
  itemSchema?: unknown;
  example?: unknown;
  examples?: Record<string, unknown>;
}

interface OpenApiRequestBody {
  description?: string;
  required?: boolean;
  content?: Record<string, OpenApiMediaType>;
}

interface OpenApiResponse {
  description: string;
  content?: Record<string, OpenApiMediaType>;
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
      deviceAuthorizationUrl?: string;
      tokenUrl?: string;
      refreshUrl?: string;
      scopes?: Record<string, string>;
    }
  >;
  openIdConnectUrl?: string;
  oauth2MetadataUrl?: string;
  deprecated?: boolean;
}

// ─── Configuration ────────────────────────────────────────────────

export interface OpenApiAdapterOptions {
  /** Label for the source document. */
  sourceLabel: string;
  /** Content hash of the raw spec. */
  sourceHash: ContentHash;
  /** Parser version identifier. */
  parserVersion?: SemanticVersion;
  /** Maximum UTF-8 source size accepted by text import. Defaults to 5 MiB. */
  maxSourceBytes?: number;
  /** Maximum YAML alias expansion count. Defaults to 100. */
  maxYamlAliasCount?: number;
  /** Maximum parsed object/array nesting depth. Defaults to 128. */
  maxDocumentDepth?: number;
  /** Maximum parsed scalar/container node count. Defaults to 100,000. */
  maxDocumentNodes?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────

const HTTP_METHODS = new Set<string>([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
  'query',
]);

export const SUPPORTED_OPENAPI_VERSIONS = [
  '3.0.0',
  '3.0.1',
  '3.0.2',
  '3.0.3',
  '3.0.4',
  '3.1.0',
  '3.1.1',
  '3.1.2',
  '3.2.0',
] as const;

const SUPPORTED_OPENAPI_VERSION_SET = new Set<string>(SUPPORTED_OPENAPI_VERSIONS);
const DEFAULT_MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_YAML_ALIAS_COUNT = 100;
const DEFAULT_MAX_DOCUMENT_DEPTH = 128;
const DEFAULT_MAX_DOCUMENT_NODES = 100_000;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failure(code: string, message: string, path?: string): ImportResult {
  return {
    model: null,
    success: false,
    diagnostics: [{ severity: 'error', code, message, path }],
  };
}

function validateDocumentShape(value: unknown): Diagnostic[] {
  if (!isRecord(value)) {
    return [
      {
        severity: 'error',
        code: 'INVALID_OPENAPI_DOCUMENT',
        message: 'OpenAPI document must be an object.',
        path: '$',
      },
    ];
  }

  const diagnostics: Diagnostic[] = [];
  if (typeof value['openapi'] !== 'string') {
    diagnostics.push({
      severity: 'error',
      code: 'MISSING_OPENAPI_VERSION',
      message: 'OpenAPI document must declare an openapi version.',
      path: '$.openapi',
    });
  }
  if (!isRecord(value['info'])) {
    diagnostics.push({
      severity: 'error',
      code: 'INVALID_OPENAPI_INFO',
      message: 'OpenAPI document must contain an info object.',
      path: '$.info',
    });
  } else {
    if (typeof value['info']['title'] !== 'string' || value['info']['title'].length === 0) {
      diagnostics.push({
        severity: 'error',
        code: 'INVALID_OPENAPI_INFO',
        message: 'OpenAPI info.title must be a non-empty string.',
        path: '$.info.title',
      });
    }
    if (typeof value['info']['version'] !== 'string' || value['info']['version'].length === 0) {
      diagnostics.push({
        severity: 'error',
        code: 'INVALID_OPENAPI_INFO',
        message: 'OpenAPI info.version must be a non-empty string.',
        path: '$.info.version',
      });
    }
  }
  if (value['paths'] !== undefined && !isRecord(value['paths'])) {
    diagnostics.push({
      severity: 'error',
      code: 'INVALID_OPENAPI_PATHS',
      message: 'OpenAPI paths must be an object when present.',
      path: '$.paths',
    });
  }
  return diagnostics;
}

function validateDocumentComplexity(
  value: unknown,
  maxDepth: number,
  maxNodes: number,
): Diagnostic | undefined {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    nodes += 1;
    if (nodes > maxNodes) {
      return {
        severity: 'error',
        code: 'OPENAPI_NODE_BUDGET_EXCEEDED',
        message: `OpenAPI document exceeds the configured ${maxNodes}-node complexity budget.`,
        path: '$',
      };
    }
    if (current.depth > maxDepth) {
      return {
        severity: 'error',
        code: 'OPENAPI_DEPTH_BUDGET_EXCEEDED',
        message: `OpenAPI document exceeds the configured maximum depth of ${maxDepth}.`,
        path: '$',
      };
    }

    if (Array.isArray(current.value)) {
      for (const child of current.value) {
        pending.push({ value: child, depth: current.depth + 1 });
      }
    } else if (isRecord(current.value)) {
      for (const child of Object.values(current.value)) {
        pending.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
  return undefined;
}

function collectExternalReferences(value: unknown): Array<{ ref: string; path: string }> {
  const references: Array<{ ref: string; path: string }> = [];

  function visit(node: unknown, path: string, depth: number): void {
    if (depth > 128 || (!isRecord(node) && !Array.isArray(node))) return;
    if (Array.isArray(node)) {
      node.forEach((entry, index) => {
        visit(entry, `${path}[${index}]`, depth + 1);
      });
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      const childPath = `${path}.${key}`;
      if (key === '$ref' && typeof child === 'string' && !child.startsWith('#/')) {
        references.push({ ref: child, path: childPath });
      } else {
        visit(child, childPath, depth + 1);
      }
    }
  }

  visit(value, '$', 0);
  return references;
}

export function importOpenApiText(source: string, options: OpenApiAdapterOptions): ImportResult {
  const sourceBytes = new TextEncoder().encode(source).byteLength;
  const maxSourceBytes = options.maxSourceBytes ?? DEFAULT_MAX_SOURCE_BYTES;
  if (sourceBytes > maxSourceBytes) {
    return failure(
      'OPENAPI_SOURCE_TOO_LARGE',
      `OpenAPI source is ${sourceBytes} bytes; the configured limit is ${maxSourceBytes} bytes.`,
      '$',
    );
  }

  const parsed = parseDocument(source, {
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
    version: '1.2',
  });
  if (parsed.errors.length > 0) {
    return failure(
      'INVALID_OPENAPI_SYNTAX',
      `OpenAPI source is not valid JSON or YAML 1.2: ${parsed.errors[0]?.message ?? 'parse failed'}`,
      '$',
    );
  }

  let value: unknown;
  try {
    value = parsed.toJS({
      maxAliasCount: options.maxYamlAliasCount ?? DEFAULT_MAX_YAML_ALIAS_COUNT,
    });
  } catch (error) {
    return failure(
      'OPENAPI_ALIAS_BUDGET_EXCEEDED',
      `OpenAPI YAML alias expansion exceeded the configured safety budget: ${error instanceof Error ? error.message : String(error)}`,
      '$',
    );
  }

  const complexityDiagnostic = validateDocumentComplexity(
    value,
    options.maxDocumentDepth ?? DEFAULT_MAX_DOCUMENT_DEPTH,
    options.maxDocumentNodes ?? DEFAULT_MAX_DOCUMENT_NODES,
  );
  if (complexityDiagnostic) {
    return { model: null, success: false, diagnostics: [complexityDiagnostic] };
  }

  const shapeDiagnostics = validateDocumentShape(value);
  if (shapeDiagnostics.length > 0) {
    return { model: null, success: false, diagnostics: shapeDiagnostics };
  }
  return importOpenApi(value as OpenApiDocument, options);
}

/**
 * Production import entry: safe YAML/JSON parsing, official-family schema
 * validation, semantic diagnostics, and canonical mapping.
 *
 * The bundled validator schemas are derived from the schemas published by the
 * OpenAPI Initiative. Specification text remains authoritative when a schema
 * and the normative text disagree.
 */
export async function validateAndImportOpenApiText(
  source: string,
  options: OpenApiAdapterOptions,
): Promise<ImportResult> {
  const mapped = importOpenApiText(source, options);
  if (!mapped.success) return mapped;

  const validator = new Validator({ allErrors: true });
  // The validator treats newline-free strings as file names; appending a
  // newline keeps compact JSON on the in-memory data path.
  const validation = await validator.validate(`${source}\n`);
  if (validation.valid) return mapped;

  if (typeof validation.errors === 'string' || !validation.errors) {
    return failure(
      'OPENAPI_SCHEMA_VALIDATION_FAILED',
      `OpenAPI schema validation failed: ${validation.errors ?? 'unknown validation error'}`,
      '$',
    );
  }

  return {
    model: null,
    success: false,
    diagnostics: validation.errors.slice(0, 50).map((error) => ({
      severity: 'error' as const,
      code: 'OPENAPI_SCHEMA_VALIDATION_FAILED',
      message: `OpenAPI schema validation failed at ${error.instancePath || '/'}: ${error.message ?? error.keyword}`,
      path: error.instancePath ? `$${error.instancePath}` : '$',
    })),
  };
}

// ─── Source Context ────────────────────────────────────────────────

/** Immutable context threaded through all mapping functions in a single import. */
interface SourceContext {
  sourceId: EntityId;
  sourceLabel: string;
  sourceVersion: SemanticVersion;
  sourceHash: ContentHash;
  ingestedAt: Instant;
  openApiVersion: (typeof SUPPORTED_OPENAPI_VERSIONS)[number];
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
    if (typeof obj === 'boolean') {
      diagnostics.push({
        severity: 'error',
        code: 'BOOLEAN_SCHEMA_NOT_REPRESENTABLE',
        message: `Boolean JSON Schema at ${path} cannot be represented by CanonicalApiModel v1.`,
        path,
      });
      return null;
    }
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
      null: 'null',
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
      exclusiveMinimum:
        typeof s['exclusiveMinimum'] === 'boolean' ? s['exclusiveMinimum'] : undefined,
      exclusiveMaximum:
        typeof s['exclusiveMaximum'] === 'boolean' ? s['exclusiveMaximum'] : undefined,
      multipleOf: typeof s['multipleOf'] === 'number' ? s['multipleOf'] : undefined,
      minItems: typeof s['minItems'] === 'number' ? s['minItems'] : undefined,
      maxItems: typeof s['maxItems'] === 'number' ? s['maxItems'] : undefined,
      uniqueItems: typeof s['uniqueItems'] === 'boolean' ? s['uniqueItems'] : undefined,
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
    if (s['items'] !== undefined) {
      const itemsObj = s['items'];
      if (isRecord(itemsObj) && typeof itemsObj['$ref'] === 'string') {
        const refPath = schemaPath(
          ...itemsObj['$ref'].replace('#/components/schemas/', '').split('/'),
        );
        node.items = { ref: refPath };
      } else {
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
        if (isRecord(propSchema) && typeof propSchema['$ref'] === 'string') {
          const refPath = schemaPath(
            ...propSchema['$ref'].replace('#/components/schemas/', '').split('/'),
          );
          props[propName] = { ref: refPath, displayName: propName };
        } else {
          const propPath = `${path}/properties/${propName}`;
          const propId = walk(propSchema, propPath, propName);
          if (propId) props[propName] = { ref: propId, displayName: propName };
        }
      }
      if (Object.keys(props).length > 0) node.properties = props;
    }

    if (Array.isArray(s['required'])) {
      node.required = s['required'] as string[];
    }

    if (typeof s['additionalProperties'] === 'boolean') {
      node.additionalProperties = s['additionalProperties'];
    } else if (isRecord(s['additionalProperties'])) {
      const additional = s['additionalProperties'];
      if (typeof additional['$ref'] === 'string') {
        node.additionalProperties = {
          ref: schemaPath(...additional['$ref'].replace('#/components/schemas/', '').split('/')),
        };
      } else {
        const additionalId = walk(additional, `${path}/additionalProperties`);
        if (additionalId) node.additionalProperties = { ref: additionalId };
      }
    }

    for (const keyword of ['allOf', 'oneOf', 'anyOf'] as const) {
      if (!Array.isArray(s[keyword])) continue;
      const refs: Array<{ ref: string }> = [];
      for (let index = 0; index < s[keyword].length; index += 1) {
        const item = s[keyword][index];
        if (isRecord(item) && typeof item['$ref'] === 'string') {
          refs.push({
            ref: schemaPath(...item['$ref'].replace('#/components/schemas/', '').split('/')),
          });
        } else {
          const inlineId = walk(item, `${path}/${keyword}/${index}`);
          if (inlineId) refs.push({ ref: inlineId });
        }
      }
      if (refs.length > 0) node[keyword] = refs;
    }

    if (typeof s['exclusiveMinimum'] === 'number' || typeof s['exclusiveMaximum'] === 'number') {
      diagnostics.push({
        severity: 'error',
        code: 'NUMERIC_EXCLUSIVE_BOUND_NOT_REPRESENTABLE',
        message: `Numeric exclusive bounds at ${path} cannot be represented by CanonicalApiModel v1.`,
        path,
      });
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

function registerSchema(
  rawSchema: unknown,
  canonicalRoot: string,
  sourceRoot: string,
  ctx: SourceContext,
  registry: Record<string, ApiSchemaNode>,
  diagnostics: Diagnostic[],
): string | null {
  if (isRecord(rawSchema) && typeof rawSchema['$ref'] === 'string') {
    return schemaPath(...rawSchema['$ref'].replace('#/components/schemas/', '').split('/'));
  }

  const name = canonicalRoot.slice('/schemas/'.length);
  const extracted = extractSchemas({ [name]: rawSchema }, ctx);
  diagnostics.push(...extracted.diagnostics);
  const rootNode = extracted.schemas[canonicalRoot];
  if (!rootNode) {
    if (!extracted.diagnostics.some((entry) => entry.path === canonicalRoot)) {
      diagnostics.push({
        severity: 'error',
        code: 'SCHEMA_NOT_REPRESENTABLE',
        message: `Schema at ${sourceRoot} cannot be represented by CanonicalApiModel v1.`,
        path: sourceRoot,
      });
    }
    return null;
  }

  for (const [path, node] of Object.entries(extracted.schemas)) {
    if (node.sourceLocation) {
      node.sourceLocation = {
        ...node.sourceLocation,
        location: `${sourceRoot}${path.slice(canonicalRoot.length)}`,
      };
    }
    registry[path] = node;
  }
  return canonicalRoot;
}

// ─── Parameter Mapping ────────────────────────────────────────────

function mapParameter(
  param: OpenApiParameter,
  ctx: SourceContext,
  endpointPath: string,
  schemaRef?: string,
): Parameter {
  const { sourceId, sourceLabel, sourceVersion, sourceHash, ingestedAt } = ctx;
  const locMap: Record<string, ParameterLocation> = {
    path: 'path',
    query: 'query',
    header: 'header',
    cookie: 'cookie',
  };

  const parameterName = param.name ?? '$querystring';
  const pid = `${endpointId(endpointPath, endpointPath)}-param-${parameterName}` as EntityId;

  const mapped: Parameter = {
    id: pid,
    name: parameterName,
    in: locMap[param.in] ?? 'query',
    description: param.description,
    required: param.required ?? false,
    deprecated: param.deprecated ?? false,
    allowEmptyValue: param.allowEmptyValue ?? false,
    style: param.style,
    explode: param.explode,
    example: param.example,
    examples: param.examples,
    schema: schemaRef ? { ref: schemaRef } : undefined,
    sourceLocation: {
      sourceId,
      sourceLabel,
      sourceVersion,
      sourceHash,
      location: `paths.${endpointPath}.parameters.${parameterName}`,
      ingestedAt,
    },
  };

  return mapped;
}

// ─── Endpoint Mapping ─────────────────────────────────────────────

function mapEndpoints(
  paths: Record<string, OpenApiPathItem> | undefined,
  ctx: SourceContext,
): {
  endpoints: Endpoint[];
  schemas: Record<string, ApiSchemaNode>;
  diagnostics: Diagnostic[];
} {
  const { sourceId, sourceLabel, sourceVersion, sourceHash, ingestedAt } = ctx;
  const endpoints: Endpoint[] = [];
  const diagnostics: Diagnostic[] = [];
  const schemas: Record<string, ApiSchemaNode> = {};

  if (!paths) return { endpoints, schemas, diagnostics };

  for (const [rawPath, methods] of Object.entries(paths)) {
    const normalizedPath = normalizePath(rawPath);
    const pathParameters = Array.isArray(methods.parameters) ? methods.parameters : [];

    if (methods.servers !== undefined) {
      diagnostics.push({
        severity: 'error',
        code: 'PATH_SERVERS_NOT_SUPPORTED',
        message: `Path-level servers at ${rawPath} cannot yet be represented safely.`,
        path: `$.paths.${rawPath}.servers`,
      });
    }

    if (methods.additionalOperations !== undefined) {
      if (isRecord(methods.additionalOperations)) {
        for (const customMethod of Object.keys(methods.additionalOperations)) {
          diagnostics.push({
            severity: 'error',
            code: 'UNSUPPORTED_ADDITIONAL_OPERATION',
            message: `OpenAPI 3.2 additional operation "${customMethod}" at ${rawPath} is not executable by the current Runner protocol.`,
            path: `$.paths.${rawPath}.additionalOperations.${customMethod}`,
          });
        }
      } else {
        diagnostics.push({
          severity: 'error',
          code: 'INVALID_ADDITIONAL_OPERATIONS',
          message: `OpenAPI 3.2 additionalOperations at ${rawPath} must be an object.`,
          path: `$.paths.${rawPath}.additionalOperations`,
        });
      }
    }

    for (const [rawMethod, operation] of Object.entries(methods)) {
      if (!isHttpMethod(rawMethod)) {
        // Skip non-HTTP-method keys like "parameters", "servers", "summary", "description"
        if (
          rawMethod === 'parameters' ||
          rawMethod === 'servers' ||
          rawMethod === 'summary' ||
          rawMethod === 'description' ||
          rawMethod === 'additionalOperations'
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

      if (rawMethod === 'query' && ctx.openApiVersion !== '3.2.0') {
        diagnostics.push({
          severity: 'error',
          code: 'QUERY_METHOD_NOT_ALLOWED',
          message: `The QUERY method is only defined by OpenAPI 3.2; this document declares ${ctx.openApiVersion}.`,
          path: `$.paths.${rawPath}.${rawMethod}`,
        });
        continue;
      }

      if (!isRecord(operation)) {
        diagnostics.push({
          severity: 'error',
          code: 'INVALID_OPENAPI_OPERATION',
          message: `Operation ${rawMethod.toUpperCase()} ${rawPath} must be an object.`,
          path: `$.paths.${rawPath}.${rawMethod}`,
        });
        continue;
      }

      const typedOperation = operation as OpenApiOperation;

      const method = toHttpMethod(rawMethod);
      const id = endpointId(method, normalizedPath);

      if (typedOperation.servers !== undefined) {
        diagnostics.push({
          severity: 'error',
          code: 'OPERATION_SERVERS_NOT_SUPPORTED',
          message: `Operation-level servers for ${method} ${rawPath} cannot yet be represented safely.`,
          path: `$.paths.${rawPath}.${rawMethod}.servers`,
        });
      }

      // Map parameters
      const parameters: Parameter[] = [];
      const mergedParameters = new Map<string, OpenApiParameter>();
      for (const param of pathParameters) {
        mergedParameters.set(`${param.in}:${param.name ?? '$querystring'}`, param);
      }
      for (const param of typedOperation.parameters ?? []) {
        mergedParameters.set(`${param.in}:${param.name ?? '$querystring'}`, param);
      }
      for (const param of mergedParameters.values()) {
        if (param.in === 'querystring') {
          diagnostics.push({
            severity: 'error',
            code: 'QUERYSTRING_PARAMETER_NOT_EXECUTABLE',
            message: `OpenAPI 3.2 querystring serialization for ${method} ${rawPath} is not implemented.`,
            path: `$.paths.${rawPath}.${rawMethod}.parameters`,
          });
        } else {
          const parameterContent = Object.entries(param.content ?? {});
          if (parameterContent.length > 1) {
            diagnostics.push({
              severity: 'error',
              code: 'PARAMETER_CONTENT_NOT_REPRESENTABLE',
              message: `Parameter ${param.name ?? ''} on ${method} ${rawPath} has multiple content representations.`,
              path: `$.paths.${rawPath}.${rawMethod}.parameters`,
            });
          }
          const rawSchema = param.schema ?? parameterContent[0]?.[1].schema;
          const parameterName = param.name ?? 'parameter';
          const schemaRef =
            rawSchema !== undefined
              ? registerSchema(
                  rawSchema,
                  schemaPath(`${id}-parameter-${parameterName}`),
                  `$.paths.${rawPath}.${rawMethod}.parameters.${parameterName}.schema`,
                  ctx,
                  schemas,
                  diagnostics,
                )
              : undefined;
          parameters.push(mapParameter(param, ctx, rawPath, schemaRef ?? undefined));
        }
      }

      // Map request bodies
      const requestBodies: RequestBody[] = [];
      if (typedOperation.requestBody) {
        const rb = typedOperation.requestBody;
        const contentMap: Record<
          string,
          { schema: { ref: string }; example?: unknown; examples?: Record<string, unknown> }
        > = {};

        if (rb.content) {
          for (const [mediaType, mediaObj] of Object.entries(rb.content)) {
            if (mediaObj.itemSchema !== undefined) {
              diagnostics.push({
                severity: 'error',
                code: 'STREAMING_ITEM_SCHEMA_NOT_EXECUTABLE',
                message: `Streaming request media type ${mediaType} for ${method} ${rawPath} is not implemented.`,
                path: `$.paths.${rawPath}.${rawMethod}.requestBody.content.${mediaType}.itemSchema`,
              });
            }
            if (mediaObj.schema) {
              const mediaKey = mediaType.replace(/[^a-zA-Z0-9._-]/g, '_');
              const refPath = registerSchema(
                mediaObj.schema,
                schemaPath(`${id}-requestBody-${mediaKey}`),
                `$.paths.${rawPath}.${rawMethod}.requestBody.content.${mediaType}.schema`,
                ctx,
                schemas,
                diagnostics,
              );
              if (refPath) {
                contentMap[mediaType] = {
                  schema: { ref: refPath },
                  example: mediaObj.example,
                  examples: mediaObj.examples,
                };
              }
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
      if (typedOperation.responses) {
        for (const [statusStr, respObj] of Object.entries(typedOperation.responses)) {
          // Handle "default" and range responses like "2XX"
          let statusCode: HttpStatusCode;
          const parsed = parseInt(statusStr, 10);
          if (!Number.isNaN(parsed) && parsed >= 100 && parsed <= 599) {
            statusCode = parsed as HttpStatusCode;
          } else {
            diagnostics.push({
              severity: 'error',
              code: 'RESPONSE_STATUS_PATTERN_NOT_SUPPORTED',
              message: `Response key "${statusStr}" for ${method} ${rawPath} cannot be represented as a concrete status code.`,
              path: `$.paths.${rawPath}.${rawMethod}.responses.${statusStr}`,
            });
            continue;
          }

          const respContent: Record<
            string,
            { schema: { ref: string }; example?: unknown; examples?: Record<string, unknown> }
          > = {};
          if (respObj.content) {
            for (const [mediaType, mediaObj] of Object.entries(respObj.content)) {
              if (mediaObj.itemSchema !== undefined) {
                diagnostics.push({
                  severity: 'error',
                  code: 'STREAMING_ITEM_SCHEMA_NOT_EXECUTABLE',
                  message: `Streaming response media type ${mediaType} for ${method} ${rawPath} is not implemented.`,
                  path: `$.paths.${rawPath}.${rawMethod}.responses.${statusStr}.content.${mediaType}.itemSchema`,
                });
              }
              if (mediaObj.schema) {
                const mediaKey = mediaType.replace(/[^a-zA-Z0-9._-]/g, '_');
                const refPath = registerSchema(
                  mediaObj.schema,
                  schemaPath(`${id}-response-${statusCode}-${mediaKey}`),
                  `$.paths.${rawPath}.${rawMethod}.responses.${statusStr}.content.${mediaType}.schema`,
                  ctx,
                  schemas,
                  diagnostics,
                );
                if (refPath) {
                  respContent[mediaType] = {
                    schema: { ref: refPath },
                    example: mediaObj.example,
                    examples: mediaObj.examples,
                  };
                }
              }
            }
          }

          // Map response headers
          const respHeaders: Record<string, { schema: { ref: string }; description?: string }> = {};
          if (respObj.headers) {
            for (const [headerName, headerObj] of Object.entries(respObj.headers)) {
              if (headerObj.schema) {
                const refPath = registerSchema(
                  headerObj.schema,
                  schemaPath(`${id}-response-header-${headerName}`),
                  `$.paths.${rawPath}.${rawMethod}.responses.${statusStr}.headers.${headerName}.schema`,
                  ctx,
                  schemas,
                  diagnostics,
                );
                if (refPath) {
                  respHeaders[headerName] = {
                    schema: { ref: refPath },
                    description: headerObj.description,
                  };
                }
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
        (typedOperation.summary?.includes('查询') || typedOperation.summary?.includes('状态'));

      endpoints.push({
        id,
        operationId: typedOperation.operationId,
        method,
        path: normalizedPath,
        summary: typedOperation.summary,
        description: typedOperation.description,
        deprecated: typedOperation.deprecated ?? false,
        tags: typedOperation.tags,
        parameters,
        requestBodies,
        responses,
        security: typedOperation.security,
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

  return { endpoints, schemas, diagnostics };
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
                deviceAuthorizationUrl: flow.deviceAuthorizationUrl,
                tokenUrl: flow.tokenUrl,
                refreshUrl: flow.refreshUrl,
                scopes: flow.scopes,
              },
            ]),
          )
        : undefined,
      openIdConnectUrl: scheme.openIdConnectUrl,
      oauth2MetadataUrl: scheme.oauth2MetadataUrl,
      deprecated: scheme.deprecated ?? false,
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
export function importOpenApi(
  input: OpenApiDocument,
  options: OpenApiAdapterOptions,
): ImportResult {
  const doc = structuredClone(input);
  const diagnostics: Diagnostic[] = [];
  const shapeDiagnostics = validateDocumentShape(doc);
  if (shapeDiagnostics.length > 0) {
    return { model: null, success: false, diagnostics: shapeDiagnostics };
  }

  const oaVersion = doc.openapi;
  if (!SUPPORTED_OPENAPI_VERSION_SET.has(oaVersion)) {
    return failure(
      'UNSUPPORTED_OPENAPI_VERSION',
      `OpenAPI version ${oaVersion} is not supported. Supported published versions are ${SUPPORTED_OPENAPI_VERSIONS.join(', ')}.`,
      '$.openapi',
    );
  }

  const originalSourceVersion = doc.info.version;
  if (/^\d+(?:\.\d+)?$/.test(doc.info.version)) {
    doc.info.version = doc.info.version
      .split('.')
      .concat(Array(3 - doc.info.version.split('.').length).fill('0'))
      .join('.');
    diagnostics.push({
      severity: 'info',
      code: 'SOURCE_VERSION_NORMALIZED',
      message: `Source version "${originalSourceVersion}" is represented as "${doc.info.version}"; the original label and source bytes are retained.`,
      path: '$.info.version',
    });
  }
  if (!SemanticVersionSchema.safeParse(doc.info.version).success) {
    return failure(
      'NON_SEMVER_API_VERSION',
      `OpenAPI info.version "${doc.info.version}" cannot be represented by the current CanonicalApiModel semantic-version field.`,
      '$.info.version',
    );
  }

  if (doc.jsonSchemaDialect !== undefined) {
    if (oaVersion.startsWith('3.0.')) {
      diagnostics.push({
        severity: 'error',
        code: 'JSON_SCHEMA_DIALECT_NOT_ALLOWED',
        message: 'jsonSchemaDialect is not part of OpenAPI 3.0.',
        path: '$.jsonSchemaDialect',
      });
    } else {
      try {
        new URL(doc.jsonSchemaDialect);
      } catch {
        diagnostics.push({
          severity: 'error',
          code: 'INVALID_JSON_SCHEMA_DIALECT',
          message: 'jsonSchemaDialect must be an absolute URI.',
          path: '$.jsonSchemaDialect',
        });
      }
    }
  }

  for (const reference of collectExternalReferences(doc)) {
    diagnostics.push({
      severity: 'error',
      code: 'EXTERNAL_REFERENCE_NOT_ALLOWED',
      message: `External reference "${reference.ref}" requires bounded resolution and is not enabled.`,
      path: reference.path,
    });
  }

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
    openApiVersion: oaVersion as (typeof SUPPORTED_OPENAPI_VERSIONS)[number],
  };

  // Check for unsupported top-level constructs
  if ((doc as unknown as Record<string, unknown>)['webhooks']) {
    diagnostics.push({
      severity: 'warning',
      code: 'WEBHOOKS_NOT_SUPPORTED',
      message: 'OpenAPI webhooks are preserved only in the raw source and are not executable.',
      path: '$.webhooks',
    });
  }

  // Extract schemas
  const { schemas, diagnostics: schemaDiags } = extractSchemas(doc.components?.schemas, ctx);
  diagnostics.push(...schemaDiags);

  // A uniform effective server set is representable without per-endpoint server semantics.
  // Keep heterogeneous overrides rejected rather than silently changing destinations.
  const effectiveServers: NonNullable<OpenApiDocument['servers']>[] = [];
  for (const path of Object.values(doc.paths ?? {})) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']) {
      const operation = path[method] as OpenApiOperation | undefined;
      if (operation && typeof operation === 'object')
        effectiveServers.push(
          (operation.servers ?? path.servers ?? doc.servers ?? [{ url: '/' }]) as NonNullable<
            OpenApiDocument['servers']
          >,
        );
    }
  }
  const firstServers = effectiveServers[0];
  if (
    firstServers &&
    effectiveServers.every((servers) => JSON.stringify(servers) === JSON.stringify(firstServers))
  ) {
    doc.servers = firstServers;
    for (const path of Object.values(doc.paths ?? {})) {
      delete path.servers;
      for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']) {
        const operation = path[method] as OpenApiOperation | undefined;
        if (operation && typeof operation === 'object') delete operation.servers;
      }
    }
  }

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
  const { endpoints, schemas: inlineSchemas, diagnostics: epDiags } = mapEndpoints(doc.paths, ctx);
  Object.assign(schemas, inlineSchemas);
  diagnostics.push(...epDiags);

  const sourceType: ApiSourceType = 'openapi';

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
    extra: {
      openapiVersion: oaVersion,
      ...(originalSourceVersion !== doc.info.version ? { originalSourceVersion } : {}),
      ...(doc.$self ? { documentSelf: doc.$self } : {}),
      ...(doc.jsonSchemaDialect ? { jsonSchemaDialect: doc.jsonSchemaDialect } : {}),
      ...(doc.tags ? { tagDefinitions: doc.tags } : {}),
    },
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

  const canonicalResult = CanonicalApiModelSchema.safeParse(model);
  if (!canonicalResult.success) {
    return {
      model: null,
      success: false,
      diagnostics: [
        ...diagnostics,
        ...canonicalResult.error.issues.map((issue) => ({
          severity: 'error' as const,
          code: 'CANONICAL_MODEL_INVALID',
          message: issue.message,
          path: `$.${issue.path.join('.')}`,
        })),
      ],
    };
  }

  return {
    model: hasErrors ? null : canonicalResult.data,
    success: !hasErrors,
    diagnostics,
  };
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
