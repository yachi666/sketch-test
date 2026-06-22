/**
 * @tap/canonical-api-model — Unified API Model v1
 *
 * This is the platform's most important stable seam. Every API source adapter
 * (OpenAPI, RAML, Code Discovery) MUST produce this model. Consumers
 * (test generation, workflow compiler, API browser) ONLY depend on this model.
 *
 * Principles:
 * - Endpoints and schemas have stable, deterministic identifiers.
 * - Source locations are preserved for every structural element.
 * - Diagnostics are first-class — warnings must not be silently dropped.
 * - Published ApiVersions are immutable.
 */

import {
  ContentHashSchema,
  DiagnosticSchema,
  EntityIdSchema,
  HttpMethodSchema,
  HttpStatusCodeSchema,
  ImmutableVersionMetaSchema,
  InstantSchema,
  MediaTypeSchema,
  SemanticVersionSchema,
  SourceLocationSchema,
} from '@tap/contracts-common';
import { z } from 'zod';

// ─── Schema Version ─────────────────────────────────────────────

/** Current schema version of the canonical model. */
export const CANONICAL_API_MODEL_VERSION = 'tap.canonical-api/v1';

// ─── Parameter Location ────────────────────────────────────────

export const ParameterLocationSchema = z.enum(['path', 'query', 'header', 'cookie']);
export type ParameterLocation = z.infer<typeof ParameterLocationSchema>;

// ─── JSON Schema Subset ─────────────────────────────────────────

export const JsonTypeSchema = z.enum([
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'object',
  'null',
]);
export type JsonType = z.infer<typeof JsonTypeSchema>;

/**
 * A stable reference to a schema node within the canonical model.
 * Uses a normalized JSON Pointer-like path relative to the API version.
 */
export const SchemaRefSchema = z.object({
  /** Canonical path, e.g. "/schemas/User/properties/email". */
  ref: z.string().min(1).max(1024),
  /** Human-readable name for display. */
  displayName: z.string().max(256).optional(),
});
export type SchemaRef = z.infer<typeof SchemaRefSchema>;

// biome-ignore lint/suspicious/noExplicitAny: self-referencing recursive Zod schema
export const ApiSchemaNodeSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    /** Stable, canonical path identifier. */
    id: z.string().min(1).max(1024),
    /** JSON type. */
    type: JsonTypeSchema.optional(),
    /** Enumeration of allowed values. */
    enum: z.array(z.unknown()).optional(),
    /** Format hint, e.g. "email", "uri", "date-time". */
    format: z.string().max(64).optional(),
    /** For string types. */
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().nonnegative().optional(),
    pattern: z.string().max(1024).optional(),
    /** For numeric types. */
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    exclusiveMinimum: z.boolean().optional(),
    exclusiveMaximum: z.boolean().optional(),
    multipleOf: z.number().positive().optional(),
    /** For array types. */
    items: SchemaRefSchema.optional(),
    minItems: z.number().int().nonnegative().optional(),
    maxItems: z.number().int().nonnegative().optional(),
    uniqueItems: z.boolean().optional(),
    /** For object types. */
    properties: z.record(z.string(), SchemaRefSchema).optional(),
    required: z.array(z.string()).optional(),
    additionalProperties: z.union([z.boolean(), SchemaRefSchema]).optional(),
    /** Composition. */
    allOf: z.array(SchemaRefSchema).optional(),
    oneOf: z.array(SchemaRefSchema).optional(),
    anyOf: z.array(SchemaRefSchema).optional(),
    /** Whether this field can be null. */
    nullable: z.boolean().default(false),
    /** Whether this field is deprecated. */
    deprecated: z.boolean().default(false),
    /** Human-readable description. */
    description: z.string().max(4096).optional(),
    /** Example value from the source spec. */
    example: z.unknown().optional(),
    /** Default value from the source spec. */
    default: z.unknown().optional(),
    /** Where this schema was defined in the source. */
    sourceLocation: SourceLocationSchema.optional(),
  }),
);
export type ApiSchemaNode = z.infer<typeof ApiSchemaNodeSchema>;

// ─── Security Schemes ───────────────────────────────────────────

export const SecuritySchemeTypeSchema = z.enum([
  'http',
  'apiKey',
  'oauth2',
  'openIdConnect',
  'mutualTls',
]);
export type SecuritySchemeType = z.infer<typeof SecuritySchemeTypeSchema>;

export const SecuritySchemeSchema = z.object({
  id: EntityIdSchema,
  type: SecuritySchemeTypeSchema,
  /** Human-readable name, e.g. "Bearer Auth". */
  name: z.string().min(1).max(128),
  /** For http: scheme (e.g. "bearer", "basic"). */
  scheme: z.string().max(64).optional(),
  /** For apiKey: where the key is placed. */
  in: ParameterLocationSchema.optional(),
  /** For oauth2 / oidc: OAuth flows. */
  flows: z
    .record(
      z.string(),
      z.object({
        authorizationUrl: z.string().url().optional(),
        tokenUrl: z.string().url().optional(),
        refreshUrl: z.string().url().optional(),
        scopes: z.record(z.string(), z.string()).optional(),
      }),
    )
    .optional(),
  /** For oidc: the discovery endpoint. */
  openIdConnectUrl: z.string().url().optional(),
  sourceLocation: SourceLocationSchema.optional(),
});
export type SecurityScheme = z.infer<typeof SecuritySchemeSchema>;

// ─── Server ─────────────────────────────────────────────────────

export const ServerSchema = z.object({
  id: EntityIdSchema,
  url: z.string().min(1).max(2048),
  description: z.string().max(1024).optional(),
  /** Variables in the server URL template. */
  variables: z
    .record(
      z.string(),
      z.object({
        default: z.string(),
        enum: z.array(z.string()).optional(),
        description: z.string().max(1024).optional(),
      }),
    )
    .optional(),
});
export type Server = z.infer<typeof ServerSchema>;

// ─── Parameters ─────────────────────────────────────────────────

export const ParameterSchema = z.object({
  /** Stable identifier within the endpoint. */
  id: EntityIdSchema,
  name: z.string().min(1).max(256),
  in: ParameterLocationSchema,
  description: z.string().max(4096).optional(),
  required: z.boolean().default(false),
  deprecated: z.boolean().default(false),
  allowEmptyValue: z.boolean().default(false),
  /** For query/path/header: simple style. */
  style: z.string().max(64).optional(),
  explode: z.boolean().optional(),
  schema: SchemaRefSchema.optional(),
  example: z.unknown().optional(),
  examples: z.record(z.string(), z.unknown()).optional(),
  sourceLocation: SourceLocationSchema.optional(),
});
export type Parameter = z.infer<typeof ParameterSchema>;

// ─── Request Body ───────────────────────────────────────────────

export const RequestBodySchema = z.object({
  id: EntityIdSchema,
  description: z.string().max(4096).optional(),
  required: z.boolean().default(false),
  content: z.record(
    MediaTypeSchema,
    z.object({
      schema: SchemaRefSchema,
      example: z.unknown().optional(),
      examples: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
  sourceLocation: SourceLocationSchema.optional(),
});
export type RequestBody = z.infer<typeof RequestBodySchema>;

// ─── Response ───────────────────────────────────────────────────

export const ResponseSchema = z.object({
  id: EntityIdSchema,
  statusCode: HttpStatusCodeSchema,
  description: z.string().max(4096),
  content: z
    .record(
      MediaTypeSchema,
      z.object({
        schema: SchemaRefSchema,
        example: z.unknown().optional(),
        examples: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .optional(),
  headers: z
    .record(
      z.string(),
      z.object({
        schema: SchemaRefSchema,
        description: z.string().max(1024).optional(),
      }),
    )
    .optional(),
  sourceLocation: SourceLocationSchema.optional(),
});
export type Response = z.infer<typeof ResponseSchema>;

// ─── Endpoint ───────────────────────────────────────────────────

/**
 * An endpoint is the core unit of the API model. It has a stable identifier
 * derived from normalized HTTP method + path. Every field traces back to
 * its source location.
 */
export const EndpointSchema = z.object({
  /** Stable canonical key: normalizedMethod + " " + normalizedPath. */
  id: EntityIdSchema,
  /** Original operationId from the source, used as an alias. */
  operationId: z.string().max(256).optional(),
  method: HttpMethodSchema,
  path: z.string().min(1).max(1024),
  summary: z.string().max(1024).optional(),
  description: z.string().max(8192).optional(),
  deprecated: z.boolean().default(false),
  tags: z.array(z.string().max(128)).optional(),
  parameters: z.array(ParameterSchema),
  requestBodies: z.array(RequestBodySchema),
  responses: z.array(ResponseSchema),
  /** Security requirements override. Empty = inherit from API level. */
  security: z.array(z.record(z.string(), z.array(z.string()))).optional(),
  /** Locations in the source document(s). At least one is required. */
  sourceLocations: z.array(SourceLocationSchema).min(1),
});
export type Endpoint = z.infer<typeof EndpointSchema>;

// ─── API Source Metadata ────────────────────────────────────────

export const ApiSourceTypeSchema = z.enum(['openapi', 'raml', 'code-discovery', 'manual']);
export type ApiSourceType = z.infer<typeof ApiSourceTypeSchema>;

export const ApiSourceMetadataSchema = z.object({
  sourceId: EntityIdSchema,
  sourceType: ApiSourceTypeSchema,
  /** Original file name or repository reference. */
  sourceLabel: z.string().min(1).max(256),
  /** Version of the source document. */
  sourceVersion: SemanticVersionSchema,
  /** Content hash of the original source file. */
  sourceHash: ContentHashSchema,
  /** Parser/Adapter name and version. */
  parserName: z.string().min(1).max(128),
  parserVersion: SemanticVersionSchema,
  /** When the source was ingested. */
  ingestedAt: InstantSchema,
  /** Additional adapter-specific metadata. */
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type ApiSourceMetadata = z.infer<typeof ApiSourceMetadataSchema>;

// ─── Canonical API Model ────────────────────────────────────────

/**
 * The unified API model — the output of every adapter. This is what
 * flows into test generation, API browsing, and diff computation.
 */
export const CanonicalApiModelSchema = z.object({
  /** Schema version for forward compatibility. */
  schemaVersion: z.literal(CANONICAL_API_MODEL_VERSION),
  /** Source traceability. */
  metadata: ApiSourceMetadataSchema,
  /** Servers defined at the API level. Endpoints may override. */
  servers: z.array(ServerSchema),
  /** Security schemes defined at the API level. */
  securitySchemes: z.array(SecuritySchemeSchema),
  /** Default security requirement. */
  security: z.array(z.record(z.string(), z.array(z.string()))).optional(),
  /** All schemas, keyed by canonical path. */
  schemas: z.record(z.string(), ApiSchemaNodeSchema),
  /** All endpoints discovered from the source. */
  endpoints: z.array(EndpointSchema),
  /** Warnings and info from the parser. Errors mean no valid model. */
  diagnostics: z.array(DiagnosticSchema),
});
export type CanonicalApiModel = z.infer<typeof CanonicalApiModelSchema>;

// ─── API Version ────────────────────────────────────────────────

/**
 * A published, immutable API version. Created by an adapter after
 * successful parsing and validation.
 */
export const ApiVersionSchema = z.object({
  ...ImmutableVersionMetaSchema.shape,
  /** The canonical model payload for this version. */
  model: CanonicalApiModelSchema,
});
export type ApiVersion = z.infer<typeof ApiVersionSchema>;

// ─── API Change Set (Diff) ──────────────────────────────────────

export const ChangeTypeSchema = z.enum(['added', 'removed', 'modified', 'deprecated']);
export type ChangeType = z.infer<typeof ChangeTypeSchema>;

export const BreakingChangeSchema = z.object({
  changeType: ChangeTypeSchema,
  endpointId: EntityIdSchema,
  path: z.string().max(1024),
  description: z.string().min(1).max(1024),
  /** Whether this is a potentially breaking change. */
  breaking: z.boolean(),
  /** Affected test case and workflow ids. */
  affectedTestCases: z.array(EntityIdSchema),
  affectedWorkflows: z.array(EntityIdSchema),
});
export type BreakingChange = z.infer<typeof BreakingChangeSchema>;

export const ApiChangeSetSchema = z.object({
  baseVersionId: EntityIdSchema,
  targetVersionId: EntityIdSchema,
  /** Endpoint-level changes. */
  endpointChanges: z.array(BreakingChangeSchema),
  /** Schema-level changes. */
  schemaChanges: z.array(BreakingChangeSchema),
  /** Summary counts. */
  summary: z.object({
    addedEndpoints: z.number().int().nonnegative(),
    removedEndpoints: z.number().int().nonnegative(),
    modifiedEndpoints: z.number().int().nonnegative(),
    breakingChanges: z.number().int().nonnegative(),
  }),
});
export type ApiChangeSet = z.infer<typeof ApiChangeSetSchema>;
