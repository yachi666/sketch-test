import { pool } from '../../db/db.js';
import { draftId, generationJobId, testCaseId, testCaseVersionId } from '../../shared/id.js';

// ─── Types ─────────────────────────────────────────────────────────

export type GenerationStrategy = 'example' | 'schema' | 'status-codes';

export interface GenerationJobRow {
  id: string;
  workspace_id: string;
  api_version_id: string;
  strategy: string;
  status: string;
  config: unknown;
  created_at: string;
  completed_at: string | null;
}

export interface DraftRow {
  id: string;
  job_id: string;
  test_case_id: string | null;
  definition: unknown;
  source_info: unknown;
  confidence: number;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface EndpointDef {
  id: string;
  operationId?: string;
  method: string;
  path: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters: ParameterDef[];
  requestBodies: RequestBodyDef[];
  responses: ResponseDef[];
}

interface ParameterDef {
  id: string;
  name: string;
  in: string;
  required?: boolean;
  schema?: { ref: string; displayName?: string };
  example?: unknown;
}

interface RequestBodyDef {
  id: string;
  required?: boolean;
  content: Record<
    string,
    {
      schema: { ref: string; displayName?: string };
      example?: unknown;
      examples?: Record<string, unknown>;
    }
  >;
}

interface ResponseDef {
  id: string;
  statusCode: number;
  description: string;
  content?: Record<
    string,
    {
      schema: { ref: string; displayName?: string };
      example?: unknown;
      examples?: Record<string, unknown>;
    }
  >;
}

export interface SchemaNode {
  id?: string;
  type?: string;
  enum?: unknown[];
  format?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: boolean;
  exclusiveMaximum?: boolean;
  multipleOf?: number;
  items?: { ref: string };
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  properties?: Record<string, { ref: string; displayName?: string }>;
  required?: string[];
  allOf?: { ref: string }[];
  oneOf?: { ref: string }[];
  anyOf?: { ref: string }[];
  nullable?: boolean;
  description?: string;
  example?: unknown;
  default?: unknown;
}

// ─── Schema Resolution ─────────────────────────────────────────────

/**
 * Resolve a schema ref into a full SchemaNode by walking the canonical schema map.
 * Returns the resolved node with inline properties (resolved recursively).
 */
export function resolveSchema(
  ref: string,
  schemas: Record<string, SchemaNode>,
  visited: Set<string> = new Set(),
): SchemaNode | null {
  if (visited.has(ref)) return null; // circular reference guard
  visited.add(ref);

  const schema = schemas[ref];
  if (!schema) return null;

  const resolved: SchemaNode = { ...schema };

  // Resolve allOf composition — merge properties and required
  if (schema.allOf) {
    const mergedProperties: Record<string, { ref: string; displayName?: string }> = {};
    const mergedRequired: string[] = [];
    for (const item of schema.allOf) {
      const sub = resolveSchema(item.ref, schemas, visited);
      if (sub) {
        if (sub.properties) Object.assign(mergedProperties, sub.properties);
        if (sub.required) mergedRequired.push(...sub.required);
        // Merge other constraints
        if (sub.type) resolved.type = resolved.type ?? sub.type;
        if (sub.minLength !== undefined) resolved.minLength = resolved.minLength ?? sub.minLength;
        if (sub.maxLength !== undefined) resolved.maxLength = resolved.maxLength ?? sub.maxLength;
        if (sub.minimum !== undefined) resolved.minimum = resolved.minimum ?? sub.minimum;
        if (sub.maximum !== undefined) resolved.maximum = resolved.maximum ?? sub.maximum;
      }
    }
    if (Object.keys(mergedProperties).length > 0) {
      resolved.properties = { ...resolved.properties, ...mergedProperties };
    }
    if (mergedRequired.length > 0) {
      resolved.required = [...new Set([...(resolved.required ?? []), ...mergedRequired])];
    }
  }

  // Resolve nested properties
  if (resolved.properties) {
    resolved.properties = { ...resolved.properties };
  }

  return resolved;
}

/**
 * Get the full resolved schema for a property by its ref.
 */
function getPropertySchema(
  propRef: string,
  schemas: Record<string, SchemaNode>,
): SchemaNode | null {
  return resolveSchema(propRef, schemas);
}

// ─── Value Generation ──────────────────────────────────────────────

/** Generate a valid value for a given schema node. */
export function generateValidValue(
  schema: SchemaNode,
  schemas: Record<string, SchemaNode>,
): unknown {
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];

  switch (schema.type) {
    case 'string': {
      if (schema.format === 'email') return 'test@example.com';
      if (schema.format === 'uri' || schema.format === 'url') return 'https://example.com';
      if (schema.format === 'date-time') return new Date().toISOString();
      if (schema.format === 'date') return '2025-01-15';
      if (schema.format === 'uuid') return '00000000-0000-0000-0000-000000000000';
      const minLen = schema.minLength ?? 1;
      return 'a'.repeat(Math.min(minLen, 100));
    }
    case 'number':
    case 'integer': {
      if (schema.exclusiveMinimum && schema.minimum !== undefined) return schema.minimum + 1;
      if (schema.minimum !== undefined) return schema.minimum;
      return schema.type === 'integer' ? 1 : 1.0;
    }
    case 'boolean':
      return true;
    case 'array': {
      const minItems = schema.minItems ?? 0;
      if (schema.items) {
        const itemSchema = getPropertySchema(schema.items.ref, schemas);
        if (itemSchema) {
          return Array.from({ length: minItems }, () => generateValidValue(itemSchema, schemas));
        }
      }
      return [];
    }
    case 'object': {
      const obj: Record<string, unknown> = {};
      if (schema.properties) {
        const required = new Set(schema.required ?? []);
        for (const [key, propRef] of Object.entries(schema.properties)) {
          if (required.has(key)) {
            const propSchema = getPropertySchema(propRef.ref, schemas);
            if (propSchema) {
              obj[key] = generateValidValue(propSchema, schemas);
            }
          }
        }
      }
      return obj;
    }
    default:
      return null;
  }
}

/** Generate an invalid (wrong-type) value for a given schema node. */
export function generateInvalidValue(
  schema: SchemaNode,
  _schemas: Record<string, SchemaNode>,
): unknown {
  switch (schema.type) {
    case 'string':
      return 12345;
    case 'number':
    case 'integer':
      return 'not-a-number';
    case 'boolean':
      return 42;
    case 'array':
      return { not: 'an-array' };
    case 'object':
      return 'not-an-object';
    default:
      return null;
  }
}

/** Generate a boundary-violating value for a given schema node. */
export function generateBoundaryValue(
  schema: SchemaNode,
  schemas: Record<string, SchemaNode>,
): { value: unknown; rule: string; expectedStatus: number } | null {
  if (schema.type === 'string') {
    if (schema.minLength !== undefined && schema.minLength > 0) {
      return {
        value: 'a'.repeat(schema.minLength - 1),
        rule: `minLength < ${schema.minLength}`,
        expectedStatus: 400,
      };
    }
    if (schema.maxLength !== undefined) {
      return {
        value: 'a'.repeat(schema.maxLength + 1),
        rule: `maxLength > ${schema.maxLength}`,
        expectedStatus: 400,
      };
    }
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    if (schema.minimum !== undefined) {
      const boundaryVal = schema.exclusiveMinimum ? schema.minimum : schema.minimum - 1;
      return {
        value: boundaryVal,
        rule: `minimum ${schema.exclusiveMinimum ? 'exclusive ' : ''}< ${schema.minimum}`,
        expectedStatus: 400,
      };
    }
    if (schema.maximum !== undefined) {
      const boundaryVal = schema.exclusiveMaximum ? schema.maximum : schema.maximum + 1;
      return {
        value: boundaryVal,
        rule: `maximum ${schema.exclusiveMaximum ? 'exclusive ' : ''}> ${schema.maximum}`,
        expectedStatus: 400,
      };
    }
  }
  if (schema.type === 'array') {
    if (schema.minItems !== undefined && schema.minItems > 0) {
      return {
        value: [],
        rule: `minItems < ${schema.minItems}`,
        expectedStatus: 400,
      };
    }
    if (schema.maxItems !== undefined) {
      if (schema.items) {
        const itemSchema = getPropertySchema(schema.items.ref, schemas);
        if (itemSchema) {
          return {
            value: Array.from({ length: schema.maxItems + 1 }, () =>
              generateValidValue(itemSchema, schemas),
            ),
            rule: `maxItems > ${schema.maxItems}`,
            expectedStatus: 400,
          };
        }
      }
      return {
        value: Array.from({ length: schema.maxItems + 1 }, () => null),
        rule: `maxItems > ${schema.maxItems}`,
        expectedStatus: 400,
      };
    }
  }
  return null;
}

// ─── Request Construction ──────────────────────────────────────────

interface BuiltRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

/** Build a URL from the endpoint path, replacing path params with values. */
function buildUrl(
  path: string,
  params: ParameterDef[],
  schemas: Record<string, SchemaNode>,
): string {
  let url = path;
  const pathParams = params.filter((p) => p.in === 'path');
  for (const param of pathParams) {
    const placeholder = `{${param.name}}`;
    if (url.includes(placeholder)) {
      let value: string;
      if (param.example !== undefined) {
        value = String(param.example);
      } else if (param.schema) {
        const schema = getPropertySchema(param.schema.ref, schemas);
        if (schema?.type === 'string') {
          value = schema.format === 'uuid' ? '00000000-0000-0000-0000-000000000000' : 'test-value';
        } else if (schema?.type === 'number' || schema?.type === 'integer') {
          value = '1';
        } else {
          value = 'test-value';
        }
      } else {
        value = 'test-value';
      }
      url = url.replace(placeholder, value);
    }
  }
  return url;
}

/** Build headers from the endpoint definition. */
function buildHeaders(requestBody: RequestBodyDef | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (requestBody && Object.keys(requestBody.content).length > 0) {
    const mediaType = Object.keys(requestBody.content)[0]!;
    headers['Content-Type'] = mediaType;
  }
  return headers;
}

/** Build a request body from a request body definition and schemas. */
function buildRequestBody(
  requestBody: RequestBodyDef,
  schemas: Record<string, SchemaNode>,
  overrides?: Record<string, unknown>,
): unknown {
  const mediaTypes = Object.keys(requestBody.content);
  if (mediaTypes.length === 0) return undefined;

  const mediaType = mediaTypes[0] as string;
  const content = requestBody.content[mediaType];
  if (!content) return undefined;

  const schema = getPropertySchema(content.schema.ref, schemas);
  if (!schema) return undefined;

  const body = generateValidValue(schema, schemas) as Record<string, unknown>;

  // Apply overrides (for missing/invalid type tests)
  if (overrides) {
    for (const [key, val] of Object.entries(overrides)) {
      if (key === '__remove__') {
        // val is an array of keys to remove
        for (const k of val as string[]) {
          delete body[k];
        }
      } else if (key === '__set__') {
        Object.assign(body, val as Record<string, unknown>);
      }
    }
  }

  return body;
}

/** Build a full request for an endpoint using its first request body. */
export function buildHappyPathRequest(
  endpoint: EndpointDef,
  schemas: Record<string, SchemaNode>,
): BuiltRequest {
  const url = buildUrl(endpoint.path, endpoint.parameters, schemas);
  const requestBody = endpoint.requestBodies.length > 0 ? endpoint.requestBodies[0] : undefined;
  const headers = buildHeaders(requestBody);
  const body = requestBody ? buildRequestBody(requestBody, schemas) : undefined;

  return {
    method: endpoint.method,
    url,
    headers,
    body,
  };
}

// ─── Test Definition Generation ────────────────────────────────────

interface DraftInput {
  definition: unknown;
  sourceInfo: Record<string, unknown>;
  confidence: number;
}

/** Generate the happy-path test for an endpoint. */
function generateHappyPath(
  endpoint: EndpointDef,
  apiVersionId: string,
  schemas: Record<string, SchemaNode>,
): DraftInput {
  const req = buildHappyPathRequest(endpoint, schemas);
  const successResponse = endpoint.responses.find((r) => r.statusCode >= 200 && r.statusCode < 300);
  const expectedStatus = successResponse?.statusCode ?? 200;

  const definition = {
    schemaVersion: 'sketch-test.test/v1',
    name: `Happy path: ${endpoint.method} ${endpoint.path}`,
    description: endpoint.summary ?? '',
    sideEffect: endpoint.method === 'GET' ? 'read-only' : 'cleanup-required',
    request: {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body,
    },
    assertions: [{ target: 'status', operator: 'equals', expected: expectedStatus }],
    extract: [],
  };

  return {
    definition,
    sourceInfo: {
      strategy: 'schema',
      apiVersionId,
      endpointId: endpoint.id,
      rule: 'happy-path',
      confidence: 0.8,
    },
    confidence: 0.8,
  };
}

/** Generate missing-required tests for an endpoint. */
function generateMissingRequiredTests(
  endpoint: EndpointDef,
  apiVersionId: string,
  schemas: Record<string, SchemaNode>,
): DraftInput[] {
  const drafts: DraftInput[] = [];

  // Required path/query parameters
  const requiredParams = endpoint.parameters.filter((p) => p.required && p.in !== 'path');
  for (const param of requiredParams) {
    const definition = {
      schemaVersion: 'sketch-test.test/v1',
      name: `Missing required param "${param.name}": ${endpoint.method} ${endpoint.path}`,
      description: `Verify 400 response when required ${param.in} parameter "${param.name}" is missing`,
      sideEffect: 'read-only',
      request: {
        method: endpoint.method,
        url: buildUrl(endpoint.path, endpoint.parameters, schemas),
        headers: {},
        body: undefined,
      },
      assertions: [{ target: 'status', operator: 'equals', expected: 400 }],
      extract: [],
    };

    drafts.push({
      definition,
      sourceInfo: {
        strategy: 'schema-missing-required',
        apiVersionId,
        endpointId: endpoint.id,
        field: param.name,
        rule: `missing-required-param:${param.in}:${param.name}`,
        confidence: 0.8,
      },
      confidence: 0.8,
    });
  }

  // Required request body fields
  if (endpoint.requestBodies.length > 0) {
    const requestBody = endpoint.requestBodies[0]!;
    const mediaTypes = Object.keys(requestBody.content);
    if (mediaTypes.length > 0) {
      const content = requestBody.content[mediaTypes[0]!];
      if (content) {
        const schema = getPropertySchema(content.schema.ref, schemas);
        const required = schema?.required ?? [];
        const _properties = schema?.properties ?? {};

        for (const fieldName of required) {
          const baseReq = buildHappyPathRequest(endpoint, schemas);
          // Remove the required field from body
          const bodyObj = (baseReq.body as Record<string, unknown>) ?? {};
          const modifiedBody = { ...bodyObj };
          delete modifiedBody[fieldName];

          const definition = {
            schemaVersion: 'sketch-test.test/v1',
            name: `Missing required field "${fieldName}": ${endpoint.method} ${endpoint.path}`,
            description: `Verify 400/422 response when required field "${fieldName}" is missing`,
            sideEffect: 'read-only',
            request: {
              method: baseReq.method,
              url: baseReq.url,
              headers: baseReq.headers,
              body: modifiedBody,
            },
            assertions: [{ target: 'status', operator: 'equals', expected: 422 }],
            extract: [],
          };

          drafts.push({
            definition,
            sourceInfo: {
              strategy: 'schema-missing-required',
              apiVersionId,
              endpointId: endpoint.id,
              field: fieldName,
              rule: `missing-required-field:${fieldName}`,
              confidence: 0.8,
            },
            confidence: 0.8,
          });
        }
      }
    }
  }

  return drafts;
}

/** Generate invalid-type tests for an endpoint. */
function generateInvalidTypeTests(
  endpoint: EndpointDef,
  apiVersionId: string,
  schemas: Record<string, SchemaNode>,
): DraftInput[] {
  const drafts: DraftInput[] = [];
  if (endpoint.requestBodies.length === 0) return drafts;

  const requestBody = endpoint.requestBodies[0]!;
  const mediaTypes = Object.keys(requestBody.content);
  if (mediaTypes.length === 0) return drafts;

  const content = requestBody.content[mediaTypes[0]!];
  if (!content) return drafts;

  const schema = getPropertySchema(content.schema.ref, schemas);
  if (!schema?.properties) return drafts;

  const required = new Set(schema.required ?? []);

  for (const [fieldName, propRef] of Object.entries(schema.properties)) {
    if (!required.has(fieldName)) continue;

    const propSchema = getPropertySchema(propRef.ref, schemas);
    if (!propSchema?.type) continue;

    // Skip objects and arrays — type mismatch is more nuanced
    if (propSchema.type === 'object' || propSchema.type === 'array') continue;

    const baseReq = buildHappyPathRequest(endpoint, schemas);
    const bodyObj = (baseReq.body as Record<string, unknown>) ?? {};
    const modifiedBody = { ...bodyObj };
    modifiedBody[fieldName] = generateInvalidValue(propSchema, schemas);

    const definition = {
      schemaVersion: 'sketch-test.test/v1',
      name: `Invalid type for "${fieldName}": ${endpoint.method} ${endpoint.path}`,
      description: `Verify 400 response when field "${fieldName}" has wrong type`,
      sideEffect: 'read-only',
      request: {
        method: baseReq.method,
        url: baseReq.url,
        headers: baseReq.headers,
        body: modifiedBody,
      },
      assertions: [{ target: 'status', operator: 'equals', expected: 400 }],
      extract: [],
    };

    drafts.push({
      definition,
      sourceInfo: {
        strategy: 'schema-invalid-type',
        apiVersionId,
        endpointId: endpoint.id,
        field: fieldName,
        rule: `invalid-type:${propSchema.type}`,
        confidence: 0.8,
      },
      confidence: 0.8,
    });
  }

  return drafts;
}

/** Generate boundary tests for an endpoint. */
function generateBoundaryTests(
  endpoint: EndpointDef,
  apiVersionId: string,
  schemas: Record<string, SchemaNode>,
): DraftInput[] {
  const drafts: DraftInput[] = [];
  if (endpoint.requestBodies.length === 0) return drafts;

  const requestBody = endpoint.requestBodies[0]!;
  const mediaTypes = Object.keys(requestBody.content);
  if (mediaTypes.length === 0) return drafts;

  const content = requestBody.content[mediaTypes[0]!];
  if (!content) return drafts;

  const schema = getPropertySchema(content.schema.ref, schemas);
  if (!schema?.properties) return drafts;

  const required = new Set(schema.required ?? []);

  for (const [fieldName, propRef] of Object.entries(schema.properties)) {
    const propSchema = getPropertySchema(propRef.ref, schemas);
    if (!propSchema) continue;

    const boundary = generateBoundaryValue(propSchema, schemas);
    if (!boundary) continue;

    const baseReq = buildHappyPathRequest(endpoint, schemas);
    const bodyObj = (baseReq.body as Record<string, unknown>) ?? {};

    if (required.has(fieldName)) {
      // For required fields, set the violating value
      const modifiedBody = { ...bodyObj };
      modifiedBody[fieldName] = boundary.value;

      const definition = {
        schemaVersion: 'sketch-test.test/v1',
        name: `Boundary test "${fieldName}" (${boundary.rule}): ${endpoint.method} ${endpoint.path}`,
        description: `Verify ${boundary.expectedStatus} response for boundary violation: ${boundary.rule}`,
        sideEffect: 'read-only',
        request: {
          method: baseReq.method,
          url: baseReq.url,
          headers: baseReq.headers,
          body: modifiedBody,
        },
        assertions: [{ target: 'status', operator: 'equals', expected: boundary.expectedStatus }],
        extract: [],
      };

      drafts.push({
        definition,
        sourceInfo: {
          strategy: 'schema-boundary',
          apiVersionId,
          endpointId: endpoint.id,
          field: fieldName,
          rule: boundary.rule,
          confidence: 0.7,
        },
        confidence: 0.7,
      });
    }
  }

  return drafts;
}

/** Generate tests from OpenAPI examples. */
function generateExampleBasedTests(
  endpoint: EndpointDef,
  apiVersionId: string,
  schemas: Record<string, SchemaNode>,
): DraftInput[] {
  const drafts: DraftInput[] = [];

  if (endpoint.requestBodies.length > 0) {
    for (const requestBody of endpoint.requestBodies) {
      for (const [mediaType, content] of Object.entries(requestBody.content)) {
        // Use example if available
        if (content.example !== undefined) {
          const baseReq = buildHappyPathRequest(endpoint, schemas);
          const definition = {
            schemaVersion: 'sketch-test.test/v1',
            name: `Example: ${endpoint.method} ${endpoint.path}`,
            description: endpoint.summary ?? `Example-based test using provided sample`,
            sideEffect: endpoint.method === 'GET' ? 'read-only' : 'cleanup-required',
            request: {
              method: baseReq.method,
              url: baseReq.url,
              headers: { 'Content-Type': mediaType },
              body: content.example,
            },
            assertions: [{ target: 'status', operator: 'equals', expected: 200 }],
            extract: [],
          };

          drafts.push({
            definition,
            sourceInfo: {
              strategy: 'example',
              apiVersionId,
              endpointId: endpoint.id,
              rule: 'example-value',
              confidence: 0.9,
            },
            confidence: 0.9,
          });
        }

        // Use named examples
        if (content.examples) {
          for (const [exampleName, exampleValue] of Object.entries(content.examples)) {
            const baseReq = buildHappyPathRequest(endpoint, schemas);
            const definition = {
              schemaVersion: 'sketch-test.test/v1',
              name: `Example "${exampleName}": ${endpoint.method} ${endpoint.path}`,
              description: `Example-based test using named example "${exampleName}"`,
              sideEffect: endpoint.method === 'GET' ? 'read-only' : 'cleanup-required',
              request: {
                method: baseReq.method,
                url: baseReq.url,
                headers: { 'Content-Type': mediaType },
                body: exampleValue,
              },
              assertions: [{ target: 'status', operator: 'equals', expected: 200 }],
              extract: [],
            };

            drafts.push({
              definition,
              sourceInfo: {
                strategy: 'example',
                apiVersionId,
                endpointId: endpoint.id,
                rule: `example-named:${exampleName}`,
                confidence: 0.9,
              },
              confidence: 0.9,
            });
          }
        }
      }
    }
  }

  // If no example found in request body, fall back to happy path
  if (drafts.length === 0) {
    const hp = generateHappyPath(endpoint, apiVersionId, schemas);
    hp.sourceInfo['strategy'] = 'example';
    hp.sourceInfo['confidence'] = 0.7; // lower confidence since we fell back
    hp.confidence = 0.7;
    drafts.push(hp);
  }

  return drafts;
}

/** Generate status-code tests for each documented response. */
function generateStatusCodesTests(
  endpoint: EndpointDef,
  apiVersionId: string,
  schemas: Record<string, SchemaNode>,
): DraftInput[] {
  const drafts: DraftInput[] = [];

  for (const response of endpoint.responses) {
    // Skip undocumented statuses
    if (response.statusCode < 100) continue;

    const baseReq = buildHappyPathRequest(endpoint, schemas);
    const definition = {
      schemaVersion: 'sketch-test.test/v1',
      name: `Status ${response.statusCode}: ${endpoint.method} ${endpoint.path}`,
      description: response.description || `Test for documented status code ${response.statusCode}`,
      sideEffect: 'read-only',
      request: {
        method: baseReq.method,
        url: baseReq.url,
        headers: baseReq.headers,
        body: baseReq.body,
      },
      assertions: [{ target: 'status', operator: 'equals', expected: response.statusCode }],
      extract: [],
    };

    // For error responses, generate an intentionally bad request
    if (response.statusCode >= 400) {
      definition.description = `[MAY NEED MANUAL REVIEW] ${definition.description}. Consider crafting a request that triggers ${response.statusCode}.`;
      definition.request.body = undefined; // Remove body for error-triggering tests
    }

    drafts.push({
      definition,
      sourceInfo: {
        strategy: 'status-codes',
        apiVersionId,
        endpointId: endpoint.id,
        rule: `status-code:${response.statusCode}`,
        confidence: 0.5, // lower confidence since these may not trigger the expected status
      },
      confidence: 0.5,
    });
  }

  return drafts;
}

// ─── Main Generation Logic ────────────────────────────────────────

interface GenerationConfig {
  endpointIds?: string[];
}

/**
 * Run a full generation job for the given API version and strategy.
 *
 * This is the core rule-driven generator. It reads an API version's endpoints
 * and schemas from the database, generates test drafts per the strategy, and
 * inserts them into `generated_drafts`.
 */
async function runGeneration(
  jobId: string,
  _workspaceId: string,
  apiVersionId: string,
  strategy: GenerationStrategy,
  config: GenerationConfig,
): Promise<void> {
  try {
    // Update job status to running
    await pool.query(`UPDATE generation_jobs SET status = 'running' WHERE id = $1`, [jobId]);

    // Fetch API version
    const avResult = await pool.query(`SELECT * FROM api_versions WHERE id = $1`, [apiVersionId]);
    if (avResult.rows.length === 0) {
      await pool.query(`UPDATE generation_jobs SET status = 'failed' WHERE id = $1`, [jobId]);
      return;
    }

    const specJson = avResult.rows[0].spec_json as {
      endpoints?: EndpointDef[];
      schemas?: Record<string, SchemaNode>;
    };
    const endpoints: EndpointDef[] = specJson.endpoints ?? [];
    const schemas: Record<string, SchemaNode> = specJson.schemas ?? {};

    // Filter endpoints if specified
    const targetEndpoints =
      config.endpointIds && config.endpointIds.length > 0
        ? endpoints.filter((ep) => config.endpointIds?.includes(ep.id))
        : endpoints;

    if (targetEndpoints.length === 0) {
      await pool.query(
        `UPDATE generation_jobs SET status = 'completed', completed_at = now() WHERE id = $1`,
        [jobId],
      );
      return;
    }

    // Generate drafts per strategy
    let allDrafts: DraftInput[] = [];

    for (const endpoint of targetEndpoints) {
      switch (strategy) {
        case 'example':
          allDrafts = allDrafts.concat(generateExampleBasedTests(endpoint, apiVersionId, schemas));
          break;
        case 'schema':
          allDrafts = allDrafts.concat(generateHappyPath(endpoint, apiVersionId, schemas));
          allDrafts = allDrafts.concat(
            generateMissingRequiredTests(endpoint, apiVersionId, schemas),
          );
          allDrafts = allDrafts.concat(generateInvalidTypeTests(endpoint, apiVersionId, schemas));
          allDrafts = allDrafts.concat(generateBoundaryTests(endpoint, apiVersionId, schemas));
          break;
        case 'status-codes':
          allDrafts = allDrafts.concat(generateStatusCodesTests(endpoint, apiVersionId, schemas));
          break;
      }
    }

    // Insert all drafts
    for (const draft of allDrafts) {
      const id = draftId();
      await pool.query(
        `INSERT INTO generated_drafts (id, job_id, definition, source_info, confidence, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')`,
        [
          id,
          jobId,
          JSON.stringify(draft.definition),
          JSON.stringify(draft.sourceInfo),
          draft.confidence,
        ],
      );
    }

    // Mark job as completed
    await pool.query(
      `UPDATE generation_jobs SET status = 'completed', completed_at = now() WHERE id = $1`,
      [jobId],
    );
  } catch (err) {
    console.error('[generation] Run generation error:', err);
    await pool.query(
      `UPDATE generation_jobs SET status = 'failed', completed_at = now() WHERE id = $1`,
      [jobId],
    );
  }
}

// ─── Public API ────────────────────────────────────────────────────

/** Start a new test generation job. */
export async function generateTests(
  workspaceId: string,
  apiVersionId: string,
  strategy: GenerationStrategy,
  endpointIds?: string[],
): Promise<GenerationJobRow> {
  const id = generationJobId();

  const result = await pool.query(
    `INSERT INTO generation_jobs (id, workspace_id, api_version_id, strategy, status, config)
     VALUES ($1, $2, $3, $4, 'pending', $5)
     RETURNING *`,
    [id, workspaceId, apiVersionId, strategy, JSON.stringify({ endpointIds: endpointIds ?? [] })],
  );
  const job = result.rows[0] as GenerationJobRow;

  // Run generation asynchronously (fire and forget)
  runGeneration(id, workspaceId, apiVersionId, strategy, {
    endpointIds,
  }).catch((err) => {
    console.error('[generation] Unhandled generation error:', err);
  });

  return job;
}

/** Get a generation job by ID. */
export async function getGenerationJob(jobId: string): Promise<GenerationJobRow | null> {
  const result = await pool.query(`SELECT * FROM generation_jobs WHERE id = $1`, [jobId]);
  return result.rows.length > 0 ? (result.rows[0] as GenerationJobRow) : null;
}

/** List generation jobs in a workspace. */
export async function listGenerationJobs(workspaceId: string): Promise<GenerationJobRow[]> {
  const result = await pool.query(
    `SELECT * FROM generation_jobs
     WHERE workspace_id = $1
     ORDER BY created_at DESC LIMIT 50`,
    [workspaceId],
  );
  return result.rows as GenerationJobRow[];
}

/** List drafts for a generation job. */
export async function listDrafts(jobId: string): Promise<DraftRow[]> {
  const result = await pool.query(
    `SELECT * FROM generated_drafts
     WHERE job_id = $1
     ORDER BY created_at`,
    [jobId],
  );
  return result.rows as DraftRow[];
}

/** Get a single draft by ID. */
export async function getDraft(draftId: string): Promise<DraftRow | null> {
  const result = await pool.query(`SELECT * FROM generated_drafts WHERE id = $1`, [draftId]);
  return result.rows.length > 0 ? (result.rows[0] as DraftRow) : null;
}

/** Accept a draft, creating a test case and version. */
export async function acceptDraft(
  draftId: string,
  reviewedBy?: string,
  modifications?: unknown,
): Promise<{
  testCaseId: string;
  versionId: string;
  version: number;
  draft: DraftRow;
}> {
  // Get the draft
  const draftResult = await pool.query(`SELECT * FROM generated_drafts WHERE id = $1`, [draftId]);
  if (draftResult.rows.length === 0) {
    throw new GenerationError(`Draft ${draftId} not found`, 404);
  }
  const draft = draftResult.rows[0] as DraftRow;

  if (draft.status !== 'pending') {
    throw new GenerationError(`Draft ${draftId} has already been ${draft.status}`, 409);
  }

  const definition = modifications ?? draft.definition;
  const defObj = definition as Record<string, unknown> | null | undefined;

  // Create or reuse a test case
  let tcId = draft.test_case_id;
  if (!tcId) {
    // Get the job to find workspace info
    const jobResult = await pool.query(`SELECT * FROM generation_jobs WHERE id = $1`, [
      draft.job_id,
    ]);
    const job = jobResult.rows[0] as GenerationJobRow | undefined;

    tcId = testCaseId();
    const name = (defObj?.['name'] as string) ?? `Generated test ${draftId}`;
    const description =
      (defObj?.['description'] as string) ?? `Auto-generated from job ${draft.job_id}`;

    const tcResult = await pool.query(
      `INSERT INTO test_cases (id, workspace_id, api_version_id, name, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [tcId, job?.workspace_id ?? '', job?.api_version_id ?? null, name, description],
    );

    tcId = tcResult.rows[0].id;
    // Update the draft with the test case ID
    await pool.query(`UPDATE generated_drafts SET test_case_id = $1 WHERE id = $2`, [
      tcId,
      draftId,
    ]);
  }

  // Get the max version for optimistic concurrency
  const maxVersionResult = await pool.query(
    `SELECT COALESCE(MAX(version), 0) AS max_version
     FROM test_case_versions WHERE test_case_id = $1`,
    [tcId],
  );
  const nextVersion = (maxVersionResult.rows[0] as { max_version: number }).max_version + 1;

  // Create the test case version
  const versionId = testCaseVersionId();
  const sideEffect = (defObj?.['sideEffect'] as string) ?? 'read-only';

  await pool.query(
    `INSERT INTO test_case_versions (id, test_case_id, version, definition, side_effect, published_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [versionId, tcId, JSON.stringify(definition), sideEffect, reviewedBy ?? null],
  );

  // Update draft status
  const updateStatus = modifications ? 'modified' : 'accepted';
  await pool.query(
    `UPDATE generated_drafts
     SET status = $2, reviewed_by = $3, reviewed_at = now()
     WHERE id = $1`,
    [draftId, updateStatus, reviewedBy ?? null],
  );

  // Refresh draft
  const refreshedDraft = await getDraft(draftId);
  if (!refreshedDraft) {
    throw new GenerationError('Draft disappeared after acceptance', 500);
  }

  return {
    testCaseId: tcId!,
    versionId,
    version: nextVersion,
    draft: refreshedDraft,
  };
}

/** Reject a draft. */
export async function rejectDraft(
  draftId: string,
  reviewedBy?: string,
  reason?: string,
): Promise<DraftRow | null> {
  const draftResult = await pool.query(`SELECT * FROM generated_drafts WHERE id = $1`, [draftId]);
  if (draftResult.rows.length === 0) return null;

  const draft = draftResult.rows[0] as DraftRow;
  if (draft.status !== 'pending') {
    throw new GenerationError(`Draft ${draftId} has already been ${draft.status}`, 409);
  }

  // Store rejection reason in source_info
  const sourceInfo = (draft.source_info as Record<string, unknown>) ?? {};
  if (reason) {
    sourceInfo['rejectionReason'] = reason;
  }

  await pool.query(
    `UPDATE generated_drafts
     SET status = 'rejected', reviewed_by = $2, reviewed_at = now(),
         source_info = $3
     WHERE id = $1`,
    [draftId, reviewedBy ?? null, JSON.stringify(sourceInfo)],
  );

  return getDraft(draftId);
}

// ─── Custom Error ──────────────────────────────────────────────────

export class GenerationError extends Error {
  public statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'GenerationError';
    this.statusCode = statusCode;
  }
}
