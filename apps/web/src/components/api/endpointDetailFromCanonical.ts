import type {
  ApiSchemaNode,
  Endpoint as CanonicalEndpoint,
  JsonType,
} from '@sketch-test/canonical-api-model';
import type {
  ApiParameter,
  ApiRequestBody,
  ApiResponseDef,
  EndpointDetail,
  SchemaDisplayNode,
} from '../../types';

function formatExample(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function firstExample(
  example: unknown,
  examples: Record<string, unknown> | undefined,
): string | undefined {
  return formatExample(example ?? (examples ? Object.values(examples)[0] : undefined));
}

function parameterType(
  schemaRef: string | undefined,
  schemas: Record<string, SchemaDisplayNode>,
): JsonType | undefined {
  return schemaRef ? schemas[schemaRef]?.type : undefined;
}

function isSensitiveHeader(name: string): boolean {
  const normalized = name.toLowerCase();
  return (
    ['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key'].includes(
      normalized,
    ) || /(?:token|secret|password|credential|api[-_]?key)/.test(normalized)
  );
}

function schemaDisplayName(id: string, fallback?: string): string {
  return fallback ?? id.split('/').filter(Boolean).at(-1) ?? id;
}

/** Convert the canonical schema registry into the recursive viewer shape. */
export function schemaDisplayNodesFromCanonical(
  schemas: Record<string, ApiSchemaNode>,
): Record<string, SchemaDisplayNode> {
  const convert = (id: string, visiting: Set<string>): SchemaDisplayNode => {
    const schema = schemas[id];
    if (!schema || visiting.has(id)) return { id, displayName: schemaDisplayName(id) };

    const nextVisiting = new Set(visiting).add(id);
    const refNode = (ref: { ref: string; displayName?: string }): SchemaDisplayNode =>
      schemas[ref.ref]
        ? {
            ...convert(ref.ref, nextVisiting),
            displayName: ref.displayName ?? schemaDisplayName(ref.ref),
          }
        : { id: ref.ref, displayName: ref.displayName ?? schemaDisplayName(ref.ref) };

    return {
      id,
      displayName: schemaDisplayName(id),
      type: schema.type,
      format: schema.format,
      description: schema.description,
      example: schema.example,
      nullable: schema.nullable,
      deprecated: schema.deprecated,
      minLength: schema.minLength,
      maxLength: schema.maxLength,
      pattern: schema.pattern,
      enum: schema.enum,
      minimum: schema.minimum,
      maximum: schema.maximum,
      items: schema.items ? refNode(schema.items) : undefined,
      properties: schema.properties
        ? Object.fromEntries(
            Object.entries(schema.properties).map(([name, ref]) => [
              name,
              refNode(ref as { ref: string; displayName?: string }),
            ]),
          )
        : undefined,
      required: schema.required,
    };
  };

  return Object.fromEntries(Object.keys(schemas).map((id) => [id, convert(id, new Set<string>())]));
}

/**
 * Preserves executable source data when an imported canonical endpoint becomes
 * a web detail panel. This is intentionally separate from the lighter table
 * row model, which only needs summary metadata.
 */
export function endpointDetailFromCanonical(
  endpoint: CanonicalEndpoint,
  schemas: Record<string, SchemaDisplayNode>,
  inheritedSecurity?: Record<string, string[]>[],
): EndpointDetail {
  const parameters: ApiParameter[] = endpoint.parameters.map((parameter) => ({
    id: parameter.id,
    name: parameter.name,
    in: parameter.in,
    description: parameter.description,
    required: parameter.required,
    deprecated: parameter.deprecated,
    type: parameterType(parameter.schema?.ref, schemas),
    // Imported credentials must stay in environment Secrets; keep the header
    // definition but never surface its literal example in the control plane.
    example:
      parameter.in === 'header' && isSensitiveHeader(parameter.name)
        ? undefined
        : firstExample(parameter.example, parameter.examples),
    enum: parameter.schema?.ref
      ? schemas[parameter.schema.ref]?.enum?.map((value) => String(value))
      : undefined,
  }));

  const requestBodies: ApiRequestBody[] = endpoint.requestBodies.map((body) => {
    const content = Object.entries(body.content);
    const firstContent = content[0]?.[1];
    return {
      id: body.id,
      description: body.description,
      required: body.required,
      contentTypes: content.map(([mediaType]) => mediaType),
      schemaRef: firstContent?.schema.ref,
      exampleBody: firstExample(firstContent?.example, firstContent?.examples),
    };
  });

  const responses: ApiResponseDef[] = endpoint.responses.map((response) => {
    const content = Object.entries(response.content ?? {});
    const firstContent = content[0]?.[1];
    return {
      id: response.id,
      statusCode: response.statusCode,
      description: response.description,
      contentTypes: content.map(([mediaType]) => mediaType),
      schemaRef: firstContent?.schema.ref,
    };
  });

  return {
    endpointId: endpoint.id,
    method: endpoint.method,
    path: endpoint.path,
    summary: endpoint.summary ?? '',
    description: endpoint.description,
    deprecated: endpoint.deprecated,
    tags: endpoint.tags ?? [],
    parameters,
    requestBodies,
    responses,
    security: endpoint.security ?? inheritedSecurity,
  };
}
