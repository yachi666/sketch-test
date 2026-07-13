/**
 * @sketch-test/adapter-raml — RAML 1.0 to CanonicalApiModel Adapter
 *
 * Converts RAML 1.0 API definitions into the platform's unified
 * CanonicalApiModel. This is an adapter seam: the output is always the
 * canonical model, regardless of input format.
 *
 * Supported scope:
 * - RAML 1.0 YAML specs
 * - Resource paths → Endpoints (with stable identifiers)
 * - Methods, query parameters, headers, request bodies, responses
 * - Schema extraction from RAML types
 * - Security schemes (OAuth 2.0, Basic Auth, API Key)
 * - Servers from baseUri
 * - Diagnostics for unsupported constructs (traits, resourceTypes, etc.)
 *
 * Invariants:
 * - Failed imports never create a valid ApiVersion.
 * - All structural elements carry source locations.
 * - Warnings for unsupported constructs are never silently dropped.
 * - Stable endpoint ids match OpenAPI adapter convention: METHOD-normalizedPath
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
import { parse as parseYaml } from 'yaml';

// ─── RAML Raw Types ────────────────────────────────────────────────

/** Top-level RAML 1.0 document shape. Resources are dynamic keys starting with "/". */
interface RamlDocument {
  title: string;
  version?: string;
  baseUri?: string;
  mediaType?: string;
  description?: string;
  types?: Record<string, RamlType>;
  securitySchemes?: Record<string, RamlSecurityScheme>;
  securedBy?: Array<string | RamlSecurityRequirement>;
  traits?: Record<string, unknown>;
  resourceTypes?: Record<string, unknown>;
  uses?: Record<string, unknown>;
  annotationTypes?: Record<string, unknown>;
}

interface RamlResource {
  displayName?: string;
  description?: string;
  uriParameters?: Record<string, RamlParameter>;
  securedBy?: Array<string | RamlSecurityRequirement>;
  is?: Array<string | RamlTraitApplication>;
  type?: string | RamlResourceTypeApplication;
  get?: RamlMethod;
  post?: RamlMethod;
  put?: RamlMethod;
  patch?: RamlMethod;
  delete?: RamlMethod;
  head?: RamlMethod;
  options?: RamlMethod;
  [key: string]: unknown;
}

interface RamlSecurityRequirement {
  [schemeName: string]: string[];
}

interface RamlTraitApplication {
  [traitName: string]: Record<string, unknown>;
}

interface RamlResourceTypeApplication {
  [typeName: string]: Record<string, unknown>;
}

interface RamlMethod {
  displayName?: string;
  description?: string;
  queryParameters?: Record<string, RamlParameter>;
  headers?: Record<string, RamlParameter>;
  body?: RamlBody;
  responses?: Record<string, RamlResponse>;
  securedBy?: Array<string | RamlSecurityRequirement>;
  is?: Array<string | RamlTraitApplication>;
}

interface RamlParameter {
  type?: string;
  displayName?: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  example?: unknown;
  enum?: unknown[];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  repeat?: boolean;
}

interface RamlBody {
  [mediaType: string]: RamlBodyContent | undefined;
}

interface RamlBodyContent {
  type?: string | RamlType;
  properties?: Record<string, RamlTypeProperty>;
  example?: unknown;
  examples?: Record<string, unknown>;
  description?: string;
}

interface RamlResponse {
  description?: string;
  headers?: Record<string, RamlParameter>;
  body?: RamlBody;
}

interface RamlType {
  type?: string;
  displayName?: string;
  description?: string;
  properties?: Record<string, RamlTypeProperty>;
  items?: string | RamlType;
  enum?: unknown[];
  required?: boolean;
  example?: unknown;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  pattern?: string;
  format?: string;
  facets?: Record<string, unknown>;
}

/** A property within a RAML type definition. Can be a string shorthand or a full object. */
type RamlTypeProperty = string | RamlType | RamlTypePropertyArray;

interface RamlTypePropertyArray {
  type: 'array';
  items?: string | RamlType;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
}

interface RamlSecurityScheme {
  type: string;
  displayName?: string;
  description?: string;
  describedBy?: {
    headers?: Record<string, RamlParameter>;
    queryParameters?: Record<string, RamlParameter>;
    responses?: Record<string, RamlResponse>;
  };
  settings?: {
    requestTokenUri?: string;
    authorizationUri?: string;
    tokenCredentialsUri?: string;
    accessTokenUri?: string;
    authorizationGrants?: string[];
    scopes?: string[];
    signatures?: string[];
  };
}

// ─── Configuration ─────────────────────────────────────────────────

export interface RamlAdapterOptions {
  sourceLabel: string;
  sourceHash: ContentHash;
  parserVersion?: SemanticVersion;
}

// ─── Helpers ───────────────────────────────────────────────────────

const HTTP_METHODS = new Set<string>(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

function isHttpMethod(s: string): boolean {
  return HTTP_METHODS.has(s);
}

function toHttpMethod(s: string): HttpMethod {
  return s.toUpperCase() as HttpMethod;
}

function endpointId(method: string, path: string): EntityId {
  return `${method.toUpperCase()}-${path}` as EntityId;
}

function schemaPath(name: string): string {
  return `/schemas/${name}`;
}

function normalizePath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ':$1');
}

/**
 * Normalize RAML version strings to valid semver.
 * RAML versions like "v1", "1", "1.0" are common and need normalization.
 */
const SEMVER_REGEX = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;
const V_PREFIX_REGEX = /^v(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;

function normalizeVersion(version: string): string {
  // Already valid semver
  const semverRegex = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/;
  if (semverRegex.test(version)) return version;

  // Try v-prefixed: "v1", "v1.2", "v1.2.3"
  const vMatch = version.match(V_PREFIX_REGEX);
  if (vMatch) {
    const major = parseInt(vMatch[1] ?? '0', 10);
    const minor = parseInt(vMatch[2] ?? '0', 10);
    const patch = parseInt(vMatch[3] ?? '0', 10);
    return `${major}.${minor}.${patch}`;
  }

  // Try plain digits: "1", "1.2", "1.2.3"
  const semMatch = version.match(SEMVER_REGEX);
  if (semMatch) {
    const major = parseInt(semMatch[1] ?? '0', 10);
    const minor = parseInt(semMatch[2] ?? '0', 10);
    const patch = parseInt(semMatch[3] ?? '0', 10);
    return `${major}.${minor}.${patch}`;
  }

  // Fallback
  return '0.0.0';
}

// ─── Source Context ─────────────────────────────────────────────────

interface SourceContext {
  sourceId: EntityId;
  sourceLabel: string;
  sourceVersion: SemanticVersion;
  sourceHash: ContentHash;
  ingestedAt: Instant;
}

// ─── Type Helpers ──────────────────────────────────────────────────

function isStringType(value: unknown): value is string {
  return typeof value === 'string';
}

function isTypeObject(value: unknown): value is RamlType {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Map RAML primitive type names to canonical JSON types. */
const RAML_TYPE_MAP: Record<string, ApiSchemaNode['type']> = {
  string: 'string',
  number: 'number',
  integer: 'integer',
  boolean: 'boolean',
  array: 'array',
  object: 'object',
  date: 'string',
  datetime: 'string',
  'datetime-only': 'string',
  'time-only': 'string',
  'date-only': 'string',
  file: 'string',
  nil: 'null',
};

function isRamlPrimitive(typeName: string): boolean {
  return typeName in RAML_TYPE_MAP;
}

// ─── Shared schemas registry (module-level for inline types) ───────

let schemas: Record<string, ApiSchemaNode> = {};

// ─── Source Location Factory ───────────────────────────────────────

function makeSourceLocation(ctx: SourceContext, location: string) {
  return {
    sourceId: ctx.sourceId,
    sourceLabel: ctx.sourceLabel,
    sourceVersion: ctx.sourceVersion,
    sourceHash: ctx.sourceHash,
    location,
    ingestedAt: ctx.ingestedAt,
  };
}

// ─── Schema Extraction ─────────────────────────────────────────────

function processType(typeObj: unknown, id: string, ctx: SourceContext): string | null {
  // String shorthand: "name: string"
  if (isStringType(typeObj)) {
    const baseType = RAML_TYPE_MAP[typeObj];
    if (baseType) {
      schemas[id] = {
        id,
        type: baseType,
        sourceLocation: makeSourceLocation(ctx, id),
      };
      return id;
    }
    return schemaPath(typeObj); // reference to named type
  }

  if (!isTypeObject(typeObj)) return null;

  const t = typeObj;

  // Determine JSON type
  let jsonType: ApiSchemaNode['type'] = 'object';
  if (t.type && typeof t.type === 'string') {
    jsonType = RAML_TYPE_MAP[t.type] ?? 'object';
  }
  if (t.properties && !t.type) {
    jsonType = 'object';
  }
  if ((t.items || t.type === 'array') && !t.properties) {
    jsonType = 'array';
  }

  const hasEnum = t.enum && Array.isArray(t.enum);

  const node: ApiSchemaNode = {
    id,
    type: jsonType,
    enum: hasEnum ? t.enum : undefined,
    format: typeof t.format === 'string' ? t.format : undefined,
    minLength: typeof t.minLength === 'number' ? t.minLength : undefined,
    maxLength: typeof t.maxLength === 'number' ? t.maxLength : undefined,
    pattern: typeof t.pattern === 'string' ? t.pattern : undefined,
    minimum: typeof t.minimum === 'number' ? t.minimum : undefined,
    maximum: typeof t.maximum === 'number' ? t.maximum : undefined,
    minItems: typeof t.minItems === 'number' ? t.minItems : undefined,
    maxItems: typeof t.maxItems === 'number' ? t.maxItems : undefined,
    uniqueItems: t.uniqueItems === true ? true : undefined,
    nullable: t.required === false ? true : false,
    description: typeof t.description === 'string' ? t.description : undefined,
    example: t.example,
    default: t.default,
    sourceLocation: makeSourceLocation(ctx, `#/types/${id.replace('/schemas/', '')}`),
  };

  // Handle properties for object types
  if (t.properties && typeof t.properties === 'object') {
    const props: Record<string, { ref: string; displayName?: string }> = {};
    const required: string[] = [];

    for (const [propName, propDef] of Object.entries(t.properties as Record<string, unknown>)) {
      if (isStringType(propDef)) {
        const refType = RAML_TYPE_MAP[propDef];
        if (refType) {
          const propId = `${id}/properties/${propName}`;
          schemas[propId] = {
            id: propId,
            type: refType,
            sourceLocation: makeSourceLocation(ctx, `${id}/properties/${propName}`),
          };
          props[propName] = { ref: propId, displayName: propName };
        } else {
          props[propName] = { ref: schemaPath(propDef), displayName: propName };
        }
        required.push(propName);
      } else if (isTypeObject(propDef)) {
        const p = propDef as RamlType;
        if (p.type === 'array') {
          const propId = `${id}/properties/${propName}`;
          const arrayNode: ApiSchemaNode = {
            id: propId,
            type: 'array',
            minItems: typeof p.minItems === 'number' ? p.minItems : undefined,
            maxItems: typeof p.maxItems === 'number' ? p.maxItems : undefined,
            uniqueItems: p.uniqueItems === true ? true : undefined,
            description: typeof p.description === 'string' ? p.description : undefined,
            sourceLocation: makeSourceLocation(ctx, `${id}/properties/${propName}`),
          };

          if (isStringType(p.items)) {
            const itemsRefType = RAML_TYPE_MAP[p.items];
            if (itemsRefType) {
              const itemsId = `${propId}/items`;
              schemas[itemsId] = {
                id: itemsId,
                type: itemsRefType,
                sourceLocation: makeSourceLocation(ctx, `${propId}/items`),
              };
              arrayNode.items = { ref: itemsId };
            } else {
              arrayNode.items = { ref: schemaPath(p.items) };
            }
          } else if (isTypeObject(p.items)) {
            const itemsId = `${propId}/items`;
            const itemsResult = processType(p.items, itemsId, ctx);
            if (itemsResult) {
              arrayNode.items = { ref: itemsResult };
            }
          }

          schemas[propId] = arrayNode;
          props[propName] = { ref: propId, displayName: propName };
        } else {
          const propId = `${id}/properties/${propName}`;
          const processedId = processType(propDef, propId, ctx);
          if (processedId) {
            props[propName] = { ref: processedId, displayName: propName };
          }
        }
        if (p.required !== false) {
          required.push(propName);
        }
      }
    }

    if (Object.keys(props).length > 0) {
      node.properties = props;
    }
    if (required.length > 0) {
      node.required = required;
    }
  }

  // Handle items for array types (non-property arrays)
  if (t.items && jsonType === 'array') {
    const itemsDef = t.items;
    if (isStringType(itemsDef)) {
      const itemsRefType = RAML_TYPE_MAP[itemsDef];
      if (itemsRefType) {
        const itemsId = `${id}/items`;
        schemas[itemsId] = {
          id: itemsId,
          type: itemsRefType,
          sourceLocation: makeSourceLocation(ctx, itemsId),
        };
        node.items = { ref: itemsId };
      } else {
        node.items = { ref: schemaPath(itemsDef) };
      }
    } else if (isTypeObject(itemsDef)) {
      const itemsId = `${id}/items`;
      const itemsResult = processType(itemsDef, itemsId, ctx);
      if (itemsResult) {
        node.items = { ref: itemsResult };
      }
    }
  }

  // Handle type reference (inheritance via "type: ParentType")
  if (
    t.type &&
    typeof t.type === 'string' &&
    !isRamlPrimitive(t.type) &&
    t.type !== 'array' &&
    t.type !== 'object'
  ) {
    node.allOf = [{ ref: schemaPath(t.type) }];
  }

  schemas[id] = node;
  return id;
}

function extractSchemas(
  rawTypes: Record<string, RamlType> | undefined,
  ctx: SourceContext,
): { schemas: Record<string, ApiSchemaNode>; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const extracted: Record<string, ApiSchemaNode> = {};

  if (!rawTypes) return { schemas: extracted, diagnostics };

  for (const [name, typeObj] of Object.entries(rawTypes)) {
    const rootId = schemaPath(name);
    processType(typeObj, rootId, ctx);
  }

  // Move module-level schemas into the returned map
  for (const [key, val] of Object.entries(schemas)) {
    extracted[key] = val;
  }

  return { schemas: extracted, diagnostics };
}

// ─── Parameter Mapping ─────────────────────────────────────────────

function mapParameter(
  param: RamlParameter,
  name: string,
  location: ParameterLocation,
  ctx: SourceContext,
  resourcePath: string,
): Parameter {
  const pid = `${endpointId('GET', resourcePath)}-param-${name}` as EntityId;

  return {
    id: pid,
    name,
    in: location,
    description: param.description,
    required: param.required ?? false,
    deprecated: false,
    allowEmptyValue: false,
    example: param.example,
    sourceLocation: makeSourceLocation(ctx, `resources.${resourcePath}.parameters.${name}`),
  };
}

function extractUriParameters(
  path: string,
  uriParamDefs: Record<string, RamlParameter> | undefined,
  ctx: SourceContext,
): Parameter[] {
  const params: Parameter[] = [];
  const matches = path.match(/\{([^}]+)\}/g);
  if (!matches) return params;

  for (const match of matches) {
    const paramName = match.slice(1, -1);
    const definition = uriParamDefs?.[paramName];
    params.push(
      mapParameter(definition ?? { type: 'string', required: true }, paramName, 'path', ctx, path),
    );
  }

  return params;
}

// ─── Endpoint Mapping ──────────────────────────────────────────────

function walkResources(
  resources: Record<string, unknown>,
  parentPath: string,
  ctx: SourceContext,
  diagnostics: Diagnostic[],
  endpoints: Endpoint[],
): void {
  if (!resources || typeof resources !== 'object') return;

  // Collect nested resource paths, method keys, and resource properties
  const nestedPaths: string[] = [];
  const methodKeys: string[] = [];
  const resourceProperties: Record<string, unknown> = {};

  for (const key of Object.keys(resources)) {
    if (key.startsWith('/')) {
      nestedPaths.push(key);
    } else if (isHttpMethod(key)) {
      methodKeys.push(key);
    } else {
      resourceProperties[key] = resources[key];
    }
  }

  const fullPath = parentPath;
  const uriParamDefs = resourceProperties['uriParameters'] as
    | Record<string, RamlParameter>
    | undefined;
  const resourceSecuredBy = resourceProperties['securedBy'] as
    | Array<string | RamlSecurityRequirement>
    | undefined;
  const resourceIs = resourceProperties['is'] as Array<string | RamlTraitApplication> | undefined;
  const resourceType = resourceProperties['type'] as
    | string
    | RamlResourceTypeApplication
    | undefined;

  // Warn on unsupported resource-level constructs
  if (resourceIs || resourceType) {
    diagnostics.push({
      severity: 'warning',
      code: 'UNSUPPORTED_RESOURCE_CONSTRUCT',
      message: `Resource "${fullPath}" uses traits (is) or resourceTypes (type) which are not fully resolved — applied patterns may be incomplete`,
      path: `$.${fullPath}`,
    });
  }

  // Process HTTP methods at this resource level
  for (const rawMethod of methodKeys) {
    const methodObj = resources[rawMethod] as RamlMethod;
    if (!methodObj || typeof methodObj !== 'object') continue;

    const method = toHttpMethod(rawMethod);
    const normalizedPath = normalizePath(fullPath);
    const id = endpointId(method, normalizedPath);

    // Warn on method-level traits
    if (methodObj.is) {
      diagnostics.push({
        severity: 'warning',
        code: 'UNSUPPORTED_TRAIT_APPLICATION',
        message: `Method ${method} ${fullPath} uses traits (is) which are not fully resolved`,
        path: `$.${fullPath}.${rawMethod}`,
      });
    }

    // Extract URI parameters
    const pathParams = extractUriParameters(fullPath, uriParamDefs, ctx);

    // Map query parameters
    const queryParams: Parameter[] = [];
    if (methodObj.queryParameters) {
      for (const [paramName, paramDef] of Object.entries(methodObj.queryParameters)) {
        queryParams.push(mapParameter(paramDef, paramName, 'query', ctx, fullPath));
      }
    }

    // Map header parameters
    const headerParams: Parameter[] = [];
    if (methodObj.headers) {
      for (const [headerName, headerDef] of Object.entries(methodObj.headers)) {
        headerParams.push(mapParameter(headerDef, headerName, 'header', ctx, fullPath));
      }
    }

    const parameters: Parameter[] = [...pathParams, ...queryParams, ...headerParams];

    // Map request body
    const requestBodies: RequestBody[] = [];
    if (methodObj.body) {
      for (const [mediaType, bodyContent] of Object.entries(methodObj.body)) {
        if (!bodyContent) continue;

        let schemaRefPath: string | null = null;
        if (bodyContent.type) {
          if (isStringType(bodyContent.type)) {
            const refType = RAML_TYPE_MAP[bodyContent.type];
            if (refType) {
              schemaRefPath = schemaPath(`${id}-requestBody-${mediaType.replace('/', '-')}`);
              schemas[schemaRefPath] = {
                id: schemaRefPath,
                type: refType,
              };
            } else {
              schemaRefPath = schemaPath(bodyContent.type);
            }
          } else if (isTypeObject(bodyContent.type)) {
            schemaRefPath = schemaPath(`${id}-requestBody-${mediaType.replace('/', '-')}`);
            const processedId = processInlineType(bodyContent.type, schemaRefPath, ctx);
            if (processedId) schemaRefPath = processedId;
          }
        } else if (bodyContent.properties) {
          schemaRefPath = schemaPath(`${id}-requestBody-${mediaType.replace('/', '-')}`);
          const propEntries = Object.entries(bodyContent.properties as Record<string, unknown>);
          const inlineProps: Record<string, { ref: string }> = {};
          for (const [propName, propDef] of propEntries) {
            const propId = `${schemaRefPath}/properties/${propName}`;
            if (isStringType(propDef)) {
              schemas[propId] = {
                id: propId,
                type: RAML_TYPE_MAP[propDef] ?? 'string',
              };
              inlineProps[propName] = { ref: propId };
            }
          }
          schemas[schemaRefPath] = {
            id: schemaRefPath,
            type: 'object',
            properties: Object.keys(inlineProps).length > 0 ? inlineProps : undefined,
          };
        }

        if (schemaRefPath) {
          requestBodies.push({
            id: `${id}-body` as EntityId,
            description: bodyContent.description,
            required: method === 'POST' || method === 'PUT' || method === 'PATCH',
            content: {
              [mediaType]: {
                schema: { ref: schemaRefPath },
                example: bodyContent.example,
                examples: bodyContent.examples,
              },
            },
            sourceLocation: makeSourceLocation(ctx, `$.${fullPath}.${rawMethod}.body.${mediaType}`),
          });
        }
      }
    }

    // Map responses
    const responses: Response[] = [];
    if (methodObj.responses) {
      for (const [statusStr, respObj] of Object.entries(methodObj.responses)) {
        const parsed = parseInt(statusStr, 10);
        let statusCode: HttpStatusCode;
        if (!Number.isNaN(parsed) && parsed >= 100 && parsed <= 599) {
          statusCode = parsed as HttpStatusCode;
        } else {
          continue;
        }

        const respContent: Record<
          string,
          { schema: { ref: string }; example?: unknown; examples?: Record<string, unknown> }
        > = {};

        // Process response headers
        const respHeaders: Record<string, { schema: { ref: string }; description?: string }> = {};
        if (respObj.headers) {
          for (const [headerName, headerDef] of Object.entries(respObj.headers)) {
            const headerSchemaRef = schemaPath(`${id}-response-header-${headerName}`);
            respHeaders[headerName] = {
              schema: { ref: headerSchemaRef },
              description: headerDef.description,
            };
          }
        }

        // Process response body
        if (respObj.body) {
          for (const [mediaType, bodyContent] of Object.entries(respObj.body)) {
            if (!bodyContent) continue;

            let schemaRefPath: string | null = null;
            if (bodyContent.type) {
              if (isStringType(bodyContent.type)) {
                const refType = RAML_TYPE_MAP[bodyContent.type];
                if (refType) {
                  schemaRefPath = schemaPath(
                    `${id}-response-${statusCode}-${mediaType.replace('/', '-')}`,
                  );
                  schemas[schemaRefPath] = {
                    id: schemaRefPath,
                    type: refType,
                  };
                } else {
                  schemaRefPath = schemaPath(bodyContent.type);
                }
              } else if (isTypeObject(bodyContent.type)) {
                schemaRefPath = schemaPath(
                  `${id}-response-${statusCode}-${mediaType.replace('/', '-')}`,
                );
                const processedId = processInlineType(bodyContent.type, schemaRefPath, ctx);
                if (processedId) schemaRefPath = processedId;
              }
            } else if (bodyContent.properties) {
              schemaRefPath = schemaPath(
                `${id}-response-${statusCode}-${mediaType.replace('/', '-')}`,
              );
              const propEntries = Object.entries(bodyContent.properties as Record<string, unknown>);
              const inlineProps: Record<string, { ref: string }> = {};
              for (const [propName, propDef] of propEntries) {
                const propId = `${schemaRefPath}/properties/${propName}`;
                if (isStringType(propDef)) {
                  schemas[propId] = {
                    id: propId,
                    type: RAML_TYPE_MAP[propDef] ?? 'string',
                  };
                  inlineProps[propName] = { ref: propId };
                }
              }
              schemas[schemaRefPath] = {
                id: schemaRefPath,
                type: 'object',
                properties: Object.keys(inlineProps).length > 0 ? inlineProps : undefined,
              };
            }

            if (schemaRefPath) {
              respContent[mediaType] = {
                schema: { ref: schemaRefPath },
                example: bodyContent.example,
                examples: bodyContent.examples,
              };
            }
          }
        }

        responses.push({
          id: `${id}-resp-${statusCode}` as EntityId,
          statusCode,
          description: respObj.description ?? '',
          content: Object.keys(respContent).length > 0 ? respContent : undefined,
          headers: Object.keys(respHeaders).length > 0 ? respHeaders : undefined,
          sourceLocation: makeSourceLocation(
            ctx,
            `$.${fullPath}.${rawMethod}.responses.${statusStr}`,
          ),
        });
      }
    }

    // Build the security requirement from method-level or resource-level securedBy
    let security: Array<Record<string, string[]>> | undefined;
    const effectiveSecuredBy = methodObj.securedBy ?? resourceSecuredBy;
    if (effectiveSecuredBy) {
      security = effectiveSecuredBy.map((item) => {
        if (typeof item === 'string') {
          return { [item]: [] };
        }
        return item as Record<string, string[]>;
      });
    }

    endpoints.push({
      id,
      method,
      path: normalizedPath,
      summary: methodObj.displayName ?? methodObj.description,
      description: methodObj.description,
      deprecated: false,
      parameters,
      requestBodies,
      responses,
      security,
      sourceLocations: [makeSourceLocation(ctx, `$.${fullPath}.${rawMethod}`)],
    });
  }

  // Recurse into nested resources
  for (const nestedPath of nestedPaths) {
    const nestedFullPath = parentPath + nestedPath;
    const nestedObj = resources[nestedPath] as Record<string, unknown>;
    if (nestedObj && typeof nestedObj === 'object') {
      walkResources(nestedObj, nestedFullPath, ctx, diagnostics, endpoints);
    }
  }
}

// ─── Inline Type Processing Helper ─────────────────────────────────

function processInlineType(typeObj: RamlType, id: string, ctx: SourceContext): string | null {
  let jsonType: ApiSchemaNode['type'] = 'object';
  if (typeObj.type && typeof typeObj.type === 'string') {
    jsonType = RAML_TYPE_MAP[typeObj.type] ?? 'object';
  }
  if (typeObj.properties && !typeObj.type) {
    jsonType = 'object';
  }
  if (typeObj.items || typeObj.type === 'array') {
    jsonType = 'array';
  }

  const node: ApiSchemaNode = {
    id,
    type: jsonType,
    description: typeObj.description,
    example: typeObj.example,
    sourceLocation: makeSourceLocation(ctx, id),
  };

  if (typeObj.properties) {
    const props: Record<string, { ref: string; displayName?: string }> = {};
    for (const [propName, propDef] of Object.entries(
      typeObj.properties as Record<string, unknown>,
    )) {
      const propId = `${id}/properties/${propName}`;
      if (isStringType(propDef)) {
        schemas[propId] = {
          id: propId,
          type: RAML_TYPE_MAP[propDef] ?? 'string',
        };
        props[propName] = { ref: propId };
      }
    }
    if (Object.keys(props).length > 0) {
      node.properties = props;
    }
  }

  schemas[id] = node;
  return id;
}

// ─── Security Scheme Mapping ───────────────────────────────────────

function mapSchemeType(ramlType: string): SecuritySchemeType | null {
  switch (ramlType) {
    case 'OAuth 2.0':
      return 'oauth2';
    case 'OAuth 1.0':
      return 'oauth2';
    case 'Basic Authentication':
      return 'http';
    case 'Digest Authentication':
      return 'http';
    case 'Pass Through':
      return 'apiKey';
    case 'x-custom':
      return 'http';
    default:
      return null;
  }
}

function mapSecuritySchemes(
  rawSchemes: Record<string, RamlSecurityScheme> | undefined,
  ctx: SourceContext,
): { securitySchemes: SecurityScheme[]; diagnostics: Diagnostic[] } {
  const securitySchemes: SecurityScheme[] = [];
  const diagnostics: Diagnostic[] = [];

  if (!rawSchemes) return { securitySchemes, diagnostics };

  for (const [name, scheme] of Object.entries(rawSchemes)) {
    const mappedType = mapSchemeType(scheme.type);
    if (!mappedType) {
      diagnostics.push({
        severity: 'warning',
        code: 'UNSUPPORTED_SECURITY_TYPE',
        message: `Unsupported RAML security scheme type "${scheme.type}" for "${name}"`,
      });
      continue;
    }

    // Build scheme name for http types
    let httpScheme: string | undefined;
    if (mappedType === 'http') {
      if (scheme.type === 'Basic Authentication') {
        httpScheme = 'basic';
      } else if (scheme.type === 'Digest Authentication') {
        httpScheme = 'digest';
      } else if (scheme.type === 'x-custom') {
        httpScheme = 'bearer';
      }
    }

    // Build flows for OAuth types
    let flows:
      | Record<
          string,
          {
            authorizationUrl?: string;
            tokenUrl?: string;
            refreshUrl?: string;
            scopes?: Record<string, string>;
          }
        >
      | undefined;

    if (mappedType === 'oauth2' && scheme.settings) {
      const s = scheme.settings;
      const flowMap: Record<
        string,
        {
          authorizationUrl?: string;
          tokenUrl?: string;
          refreshUrl?: string;
          scopes?: Record<string, string>;
        }
      > = {};

      if (s.authorizationUri || s.accessTokenUri) {
        flowMap['authorizationCode'] = {
          authorizationUrl: s.authorizationUri,
          tokenUrl: s.accessTokenUri,
          scopes: s.scopes
            ? Object.fromEntries(s.scopes.map((scope) => [scope, scope]))
            : undefined,
        };
      }

      if (s.requestTokenUri && s.tokenCredentialsUri) {
        if (!('authorizationCode' in flowMap)) {
          flowMap['implicit'] = {
            authorizationUrl: s.authorizationUri ?? s.requestTokenUri,
            scopes: s.scopes
              ? Object.fromEntries(s.scopes.map((scope) => [scope, scope]))
              : undefined,
          };
        }
      }

      if (Object.keys(flowMap).length > 0) {
        flows = flowMap;
      }
    }

    // Determine `in` for API Key types
    let keyIn: ParameterLocation | undefined;
    if (mappedType === 'apiKey' && scheme.describedBy) {
      if (scheme.describedBy.headers) {
        keyIn = 'header';
      } else if (scheme.describedBy.queryParameters) {
        keyIn = 'query';
      }
    }

    securitySchemes.push({
      id: `sec-${name}` as EntityId,
      type: mappedType,
      name: scheme.displayName ?? name,
      scheme: httpScheme,
      in: keyIn,
      flows,
      sourceLocation: makeSourceLocation(ctx, `#/securitySchemes/${name}`),
    });
  }

  return { securitySchemes, diagnostics };
}

// ─── Main Adapter ──────────────────────────────────────────────────

export interface ImportResult {
  model: CanonicalApiModel | null;
  success: boolean;
  diagnostics: Diagnostic[];
}

/**
 * Convert a RAML 1.0 YAML string into the platform's CanonicalApiModel.
 */
export function importRaml(ramlString: string, options: RamlAdapterOptions): ImportResult {
  const diagnostics: Diagnostic[] = [];
  schemas = {};

  // Parse YAML
  let doc: RamlDocument;
  try {
    doc = parseYaml(ramlString) as RamlDocument;
  } catch (err) {
    return {
      model: null,
      success: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'INVALID_YAML',
          message: `Failed to parse RAML YAML: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }

  if (!doc || typeof doc !== 'object') {
    return {
      model: null,
      success: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'EMPTY_DOCUMENT',
          message: 'Parsed RAML document is empty or not an object',
        },
      ],
    };
  }

  // Validate required fields
  if (!doc.title) {
    diagnostics.push({
      severity: 'error',
      code: 'MISSING_TITLE',
      message: 'RAML document must have a "title" field',
    });
  }

  // Normalize RAML version (e.g. "v1" → "1.0.0") to valid semver
  const rawVersion = doc.version ?? '0.0.0';
  const sourceVersion = normalizeVersion(rawVersion) as SemanticVersion;
  const sourceId = `raml-${options.sourceLabel.replace(/[^a-zA-Z0-9_-]/g, '-')}` as EntityId;
  const ingestedAt = new Date().toISOString() as Instant;

  const ctx: SourceContext = {
    sourceId,
    sourceLabel: options.sourceLabel,
    sourceVersion,
    sourceHash: options.sourceHash,
    ingestedAt,
  };

  // Warn on unsupported top-level constructs
  if (doc.traits && Object.keys(doc.traits).length > 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'TRAITS_NOT_RESOLVED',
      message: 'RAML traits are not fully resolved — method definitions may be incomplete',
    });
  }

  if (doc.resourceTypes && Object.keys(doc.resourceTypes).length > 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'RESOURCE_TYPES_NOT_RESOLVED',
      message: 'RAML resourceTypes are not fully resolved — resource definitions may be incomplete',
    });
  }

  if (doc.uses && Object.keys(doc.uses).length > 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'LIBRARIES_NOT_RESOLVED',
      message: 'RAML uses/libraries are not resolved — external type references will be missing',
    });
  }

  if (doc.annotationTypes && Object.keys(doc.annotationTypes).length > 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'ANNOTATIONS_NOT_RESOLVED',
      message: 'RAML annotationTypes are not processed',
    });
  }

  // Extract schemas from types
  const { diagnostics: schemaDiags } = extractSchemas(doc.types, ctx);
  diagnostics.push(...schemaDiags);

  // Map servers from baseUri
  const servers: Server[] = [];
  if (doc.baseUri) {
    servers.push({
      id: 'server-1' as EntityId,
      url: doc.baseUri,
      description: doc.description,
    });
  }

  // Map security schemes
  const { securitySchemes, diagnostics: secDiags } = mapSecuritySchemes(doc.securitySchemes, ctx);
  diagnostics.push(...secDiags);

  // Map endpoints by walking resources
  const endpoints: Endpoint[] = [];

  // Extract resources: all top-level keys that start with "/"
  const resources: Record<string, unknown> = {};
  for (const key of Object.keys(doc as unknown as Record<string, unknown>)) {
    if (key.startsWith('/')) {
      resources[key] = (doc as unknown as Record<string, unknown>)[key];
    }
  }

  walkResources(resources, '', ctx, diagnostics, endpoints);

  // Build metadata
  const metadata: ApiSourceMetadata = {
    sourceId,
    sourceType: 'raml' as ApiSourceType,
    sourceLabel: options.sourceLabel,
    sourceVersion,
    sourceHash: options.sourceHash,
    parserName: '@sketch-test/adapter-raml',
    parserVersion: options.parserVersion ?? ('0.1.0' as SemanticVersion),
    ingestedAt,
  };

  const hasErrors = diagnostics.some((d) => d.severity === 'error');

  const model: CanonicalApiModel = {
    schemaVersion: CANONICAL_API_MODEL_VERSION,
    metadata,
    servers,
    securitySchemes,
    security: doc.securedBy
      ? doc.securedBy.map((item) => {
          if (typeof item === 'string') return { [item]: [] };
          return item as Record<string, string[]>;
        })
      : undefined,
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

// ─── Re-exports ───────────────────────────────────────────────────

export type { RamlDocument, RamlMethod, RamlParameter, RamlResource, RamlType };
