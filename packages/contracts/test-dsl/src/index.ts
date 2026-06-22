/**
 * @tap/test-dsl — Test Definition DSL v1
 *
 * Defines the structure of a single REST API test case: request, assertions,
 * variable extraction, and side-effect classification. This is the editor
 * format; the Runner receives a compiled FrozenStep.
 *
 * Invariants:
 * - Published TestCaseVersions are immutable.
 * - Variable references are resolved at compile time (scope + name).
 * - Each assertion independently records expected and actual values.
 * - Drafts cannot enter CI suites until published.
 */

import {
  ConfidenceLevelSchema,
  ContentHashSchema,
  DiagnosticSchema,
  EntityIdSchema,
  HttpMethodSchema,
  HttpStatusCodeSchema,
  ImmutableVersionMetaSchema,
  InstantSchema,
  MediaTypeSchema,
  SemanticVersionSchema,
  SideEffectLevelSchema,
} from '@tap/contracts-common';
import { z } from 'zod';

// ─── Schema Version ─────────────────────────────────────────────

export const TEST_DSL_VERSION = 'tap.test/v1';

// ─── Authentication ─────────────────────────────────────────────

export const AuthTypeSchema = z.enum(['none', 'basic', 'bearer', 'api-key', 'custom']);
export type AuthType = z.infer<typeof AuthTypeSchema>;

export const AuthConfigSchema = z.object({
  type: AuthTypeSchema,
  /** For bearer: the token (usually a variable reference). */
  token: z.string().max(4096).optional(),
  /** For basic: username and password (variable refs). */
  username: z.string().max(1024).optional(),
  password: z.string().max(1024).optional(),
  /** For api-key: header/query name and value. */
  keyName: z.string().max(256).optional(),
  keyValue: z.string().max(4096).optional(),
  keyIn: z.enum(['header', 'query']).optional(),
  /** For custom: arbitrary header template. */
  headerTemplate: z.string().max(1024).optional(),
});
export type AuthConfig = z.infer<typeof AuthConfigSchema>;

// ─── HTTP Request ───────────────────────────────────────────────

/** Supported request body types in V1. */
export const BodyTypeSchema = z.enum(['json', 'form', 'text', 'binary', 'none']);
export type BodyType = z.infer<typeof BodyTypeSchema>;

export const HttpRequestBodySchema = z.object({
  mediaType: MediaTypeSchema,
  type: BodyTypeSchema,
  /** The body value, which may contain variable references like ${data.name}. */
  value: z.unknown().optional(),
  /** For form data: key-value pairs. */
  fields: z.record(z.string(), z.string()).optional(),
});
export type HttpRequestBody = z.infer<typeof HttpRequestBodySchema>;

export const HttpRequestSchema = z.object({
  method: HttpMethodSchema,
  /** URL template with variable references, e.g. "${env.baseUrl}/users". */
  url: z.string().min(1).max(4096),
  headers: z.record(z.string(), z.string()).optional(),
  query: z.record(z.string(), z.string()).optional(),
  cookies: z.record(z.string(), z.string()).optional(),
  body: HttpRequestBodySchema.optional(),
  auth: AuthConfigSchema.optional(),
  /** Follow redirects (default: false for test determinism). */
  followRedirects: z.boolean().default(false),
  /** Request timeout in milliseconds. */
  timeoutMs: z.number().int().positive().max(300_000).default(30_000),
});
export type HttpRequest = z.infer<typeof HttpRequestSchema>;

// ─── Assertions ─────────────────────────────────────────────────

export const AssertionOperatorSchema = z.enum([
  'equals',
  'notEquals',
  'contains',
  'notContains',
  'exists',
  'notExists',
  'greaterThan',
  'lessThan',
  'matches', // regex
  'type', // typeof check
  'schema', // JSON Schema validation
  'hasItems', // array length check
  'isEmpty',
]);
export type AssertionOperator = z.infer<typeof AssertionOperatorSchema>;

export const AssertionTargetSchema = z.enum([
  'status',
  'header',
  'jsonPath',
  'body',
  'responseTime',
  'schema',
]);
export type AssertionTarget = z.infer<typeof AssertionTargetSchema>;

export const AssertionSeveritySchema = z.enum(['block', 'warn']);
export type AssertionSeverity = z.infer<typeof AssertionSeveritySchema>;

export const AssertionSchema = z.object({
  id: EntityIdSchema,
  target: AssertionTargetSchema,
  /** For status: the expected status code. */
  statusCode: HttpStatusCodeSchema.optional(),
  /** For header: the header name. */
  headerName: z.string().max(256).optional(),
  /** For jsonPath: the JSONPath expression. */
  path: z.string().max(1024).optional(),
  operator: AssertionOperatorSchema,
  /** Expected value. */
  expected: z.unknown().optional(),
  /** Whether a failure blocks the step or is a warning. */
  severity: AssertionSeveritySchema.default('block'),
  /** Human-readable description of what this assertion checks. */
  description: z.string().max(1024).optional(),
});
export type Assertion = z.infer<typeof AssertionSchema>;

// ─── Variable Extraction ────────────────────────────────────────

export const ExtractionSourceSchema = z.enum(['body', 'header', 'cookie', 'status']);
export type ExtractionSource = z.infer<typeof ExtractionSourceSchema>;

export const VariableExtractionSchema = z.object({
  /** Variable name to assign. */
  name: z.string().min(1).max(128),
  /** Where to extract from. */
  source: ExtractionSourceSchema,
  /** JSONPath expression (for body) or header/cookie name. */
  expression: z.string().min(1).max(1024),
  /** Scope of the extracted variable. */
  scope: z.enum(['step', 'workflow']).default('workflow'),
  /** Whether this variable contains sensitive data. */
  sensitive: z.boolean().default(false),
});
export type VariableExtraction = z.infer<typeof VariableExtractionSchema>;

// ─── Test Generation Source ─────────────────────────────────────

export const GenerationStrategySchema = z.enum([
  'example',
  'schema-positive',
  'schema-missing-required',
  'schema-invalid-type',
  'schema-boundary',
  'protocol-auth',
  'protocol-content-type',
  'stateful-crud',
  'ai-code-enhanced',
]);
export type GenerationStrategy = z.infer<typeof GenerationStrategySchema>;

export const GenerationSourceSchema = z.object({
  strategy: GenerationStrategySchema,
  /** The API version that was used as input. */
  apiVersionId: EntityIdSchema,
  /** Specific endpoint(s) used. */
  endpointIds: z.array(EntityIdSchema),
  /** Schema fields that were referenced. */
  schemaPaths: z.array(z.string().max(1024)).optional(),
  /** For AI: the model and prompt version. */
  modelInfo: z
    .object({
      provider: z.string().max(128),
      model: z.string().max(128),
      promptVersion: SemanticVersionSchema,
      inputHash: ContentHashSchema,
    })
    .optional(),
  /** For code-enhanced: code evidence references. */
  codeEvidenceIds: z.array(EntityIdSchema).optional(),
  /** Confidence of the generation. */
  confidence: ConfidenceLevelSchema,
});
export type GenerationSource = z.infer<typeof GenerationSourceSchema>;

// ─── Test Validation Status ─────────────────────────────────────

export const TestValidationStatusSchema = z.enum([
  'unvalidated',
  'syntax-valid',
  'compiled',
  'executed-once',
  'stable-pass',
  'stable-fail',
  'flaky',
]);
export type TestValidationStatus = z.infer<typeof TestValidationStatusSchema>;

// ─── Test Definition ────────────────────────────────────────────

/**
 * A complete test case definition. This is the editor-format document.
 * Publishing creates an immutable TestCaseVersion.
 */
export const TestDefinitionSchema = z.object({
  schemaVersion: z.literal(TEST_DSL_VERSION),
  id: EntityIdSchema,
  /** Human-readable name. */
  name: z.string().min(1).max(256),
  /** Optional longer description. */
  description: z.string().max(4096).optional(),
  /** Tags for organization and filtering. */
  tags: z.array(z.string().max(64)).optional(),
  /** The HTTP request to execute. */
  request: HttpRequestSchema,
  /** Assertions to evaluate after the response is received. */
  assertions: z.array(AssertionSchema),
  /** Variables to extract from the response. */
  extract: z.array(VariableExtractionSchema).optional(),
  /** Side effect classification for production safety. */
  sideEffect: SideEffectLevelSchema.default('read-only'),
  /** Generation source (empty for manually authored tests). */
  generationSource: GenerationSourceSchema.optional(),
});
export type TestDefinition = z.infer<typeof TestDefinitionSchema>;

// ─── Test Case Version ──────────────────────────────────────────

/**
 * An immutable, published test case version. Historical runs always
 * reference the exact version they used.
 */
export const TestCaseVersionSchema = z.object({
  ...ImmutableVersionMetaSchema.shape,
  definition: TestDefinitionSchema,
  /** Whether this version has been approved for CI use. */
  approved: z.boolean().default(false),
  /** Who approved it. */
  approvedBy: z.string().max(128).optional(),
  approvedAt: InstantSchema.optional(),
  validationStatus: TestValidationStatusSchema,
  /** The API version this test was written against. */
  apiVersionId: EntityIdSchema.optional(),
});
export type TestCaseVersion = z.infer<typeof TestCaseVersionSchema>;

// ─── Test Draft ─────────────────────────────────────────────────

/**
 * A generated or edited-but-unpublished test. Drafts cannot enter CI suites.
 * Publishing a draft creates a TestCaseVersion.
 */
export const TestDraftSchema = z.object({
  id: EntityIdSchema,
  testCaseId: EntityIdSchema,
  definition: TestDefinitionSchema,
  /** Expected revision number for optimistic locking. */
  expectedRevision: z.number().int().nonnegative(),
  /** Generation source (present for generated drafts). */
  generationSource: GenerationSourceSchema.optional(),
  /** Validation report from the last check. */
  validationReport: z
    .object({
      valid: z.boolean(),
      diagnostics: z.array(DiagnosticSchema),
    })
    .optional(),
});
export type TestDraft = z.infer<typeof TestDraftSchema>;

// ─── Validation ─────────────────────────────────────────────────

export const TestValidationReportSchema = z.object({
  valid: z.boolean(),
  diagnostics: z.array(DiagnosticSchema),
  /** Warnings that don't block publishing. */
  warnings: z.array(z.string()),
});
export type TestValidationReport = z.infer<typeof TestValidationReportSchema>;
