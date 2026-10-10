/**
 * Endpoint OpenAPI Definition — derived, read-only endpoint documents.
 *
 * Converts the immutable CanonicalApiModel projection for one endpoint into a
 * standalone OpenAPI 3.2 document. This is intentionally a derived view: it
 * never mutates the imported source, and Postman runtime scripts remain in the
 * original source manifest rather than being represented as OpenAPI.
 */

import type {
  ApiSchemaNode,
  CanonicalApiModel,
  Endpoint,
  SchemaRef,
  SecurityScheme,
} from '@sketch-test/canonical-api-model';
import { stringify } from 'yaml';

export type DefinitionOrigin = 'derived-openapi' | 'derived-postman' | 'derived-canonical';

export interface EndpointDefinition {
  yaml: string;
  origin: DefinitionOrigin;
  sourceLabel: string;
  fileName: string;
}

type JsonSchema = Record<string, unknown>;

function denormalizePath(path: string): string {
  return path.replace(/:([A-Za-z0-9_-]+)/g, '{$1}');
}

function schemaName(ref: string): string {
  return ref.replace(
    /[^A-Za-z0-9._-]/g,
    (character) => `_${character.codePointAt(0)?.toString(16) ?? '0'}_`,
  );
}

function definitionOrigin(sourceType: string): DefinitionOrigin {
  if (sourceType.startsWith('postman')) return 'derived-postman';
  if (sourceType === 'openapi') return 'derived-openapi';
  return 'derived-canonical';
}

function securityScheme(scheme: SecurityScheme): Record<string, unknown> {
  const base: Record<string, unknown> = { type: scheme.type };
  if (scheme.scheme) base['scheme'] = scheme.scheme;
  if (scheme.in) base['in'] = scheme.in;
  if (scheme.type === 'apiKey') base['name'] = scheme.name;
  if (scheme.flows) base['flows'] = scheme.flows;
  if (scheme.openIdConnectUrl) base['openIdConnectUrl'] = scheme.openIdConnectUrl;
  if (scheme.deprecated) base['deprecated'] = true;
  return base;
}

function schemaFromNode(
  node: ApiSchemaNode,
  reference: (ref: SchemaRef) => JsonSchema,
): JsonSchema {
  const schema: JsonSchema = {};
  if (node.type)
    schema['type'] = node.nullable && node.type !== 'null' ? [node.type, 'null'] : node.type;
  if (node.enum) schema['enum'] = node.enum;
  if (node.format) schema['format'] = node.format;
  if (node.minLength !== undefined) schema['minLength'] = node.minLength;
  if (node.maxLength !== undefined) schema['maxLength'] = node.maxLength;
  if (node.pattern) schema['pattern'] = node.pattern;
  if (node.minimum !== undefined) schema['minimum'] = node.minimum;
  if (node.maximum !== undefined) schema['maximum'] = node.maximum;
  if (node.exclusiveMinimum !== undefined) schema['exclusiveMinimum'] = node.exclusiveMinimum;
  if (node.exclusiveMaximum !== undefined) schema['exclusiveMaximum'] = node.exclusiveMaximum;
  if (node.multipleOf !== undefined) schema['multipleOf'] = node.multipleOf;
  if (node.items) schema['items'] = reference(node.items);
  if (node.minItems !== undefined) schema['minItems'] = node.minItems;
  if (node.maxItems !== undefined) schema['maxItems'] = node.maxItems;
  if (node.uniqueItems !== undefined) schema['uniqueItems'] = node.uniqueItems;
  if (node.properties) {
    schema['properties'] = Object.fromEntries(
      Object.entries(node.properties as Record<string, SchemaRef>).map(([name, property]) => [
        name,
        reference(property),
      ]),
    );
  }
  if (node.required) schema['required'] = node.required;
  if (node.additionalProperties !== undefined) {
    schema['additionalProperties'] =
      typeof node.additionalProperties === 'boolean'
        ? node.additionalProperties
        : reference(node.additionalProperties);
  }
  if (node.allOf) schema['allOf'] = node.allOf.map(reference);
  if (node.oneOf) schema['oneOf'] = node.oneOf.map(reference);
  if (node.anyOf) schema['anyOf'] = node.anyOf.map(reference);
  if (node.description) schema['description'] = node.description;
  if (node.example !== undefined) schema['example'] = node.example;
  if (node.default !== undefined) schema['default'] = node.default;
  if (node.deprecated) schema['deprecated'] = true;
  return schema;
}

function operationFromEndpoint(
  endpoint: Endpoint,
  reference: (ref: SchemaRef) => JsonSchema,
): Record<string, unknown> {
  const operation: Record<string, unknown> = {
    ...(endpoint.operationId ? { operationId: endpoint.operationId } : {}),
    ...(endpoint.summary ? { summary: endpoint.summary } : {}),
    ...(endpoint.description ? { description: endpoint.description } : {}),
    ...(endpoint.tags?.length ? { tags: endpoint.tags } : {}),
    ...(endpoint.deprecated ? { deprecated: true } : {}),
    parameters: endpoint.parameters.map((parameter) => ({
      name: parameter.name,
      in: parameter.in,
      required: parameter.in === 'path' ? true : parameter.required,
      ...(parameter.description ? { description: parameter.description } : {}),
      ...(parameter.deprecated ? { deprecated: true } : {}),
      ...(parameter.allowEmptyValue ? { allowEmptyValue: true } : {}),
      ...(parameter.style ? { style: parameter.style } : {}),
      ...(parameter.explode !== undefined ? { explode: parameter.explode } : {}),
      schema: parameter.schema ? reference(parameter.schema) : {},
      ...(parameter.example !== undefined ? { example: parameter.example } : {}),
    })),
    responses: Object.fromEntries(
      endpoint.responses.map((response) => [
        String(response.statusCode),
        {
          description: response.description,
          ...(response.headers
            ? {
                headers: Object.fromEntries(
                  Object.entries(response.headers).map(([name, header]) => [
                    name,
                    {
                      ...(header.description ? { description: header.description } : {}),
                      schema: reference(header.schema),
                    },
                  ]),
                ),
              }
            : {}),
          ...(response.content
            ? {
                content: Object.fromEntries(
                  Object.entries(response.content).map(([mediaType, media]) => [
                    mediaType,
                    {
                      schema: reference(media.schema),
                      ...(media.example !== undefined ? { example: media.example } : {}),
                    },
                  ]),
                ),
              }
            : {}),
        },
      ]),
    ),
    ...(endpoint.security ? { security: endpoint.security } : {}),
  };

  if (endpoint.requestBodies.length > 0) {
    const body = endpoint.requestBodies[0];
    if (body) {
      operation['requestBody'] = {
        ...(body.description ? { description: body.description } : {}),
        required: body.required,
        content: Object.fromEntries(
          Object.entries(body.content).map(([mediaType, media]) => [
            mediaType,
            {
              schema: reference(media.schema),
              ...(media.example !== undefined ? { example: media.example } : {}),
            },
          ]),
        ),
      };
    }
  }

  return operation;
}

/** Build a portable OpenAPI document for exactly one endpoint. */
export function createEndpointDefinition(
  model: CanonicalApiModel,
  endpoint: Endpoint,
  persistedSourceType: string,
): EndpointDefinition {
  const referenced = new Set<string>();
  const reference = (ref: SchemaRef): JsonSchema => {
    referenced.add(ref.ref);
    return { $ref: `#/components/schemas/${schemaName(ref.ref)}` };
  };
  const operation = operationFromEndpoint(endpoint, reference);
  const components: Record<string, JsonSchema> = {};

  for (const ref of referenced) {
    const node = model.schemas[ref];
    if (node) components[schemaName(ref)] = schemaFromNode(node, reference);
  }

  // Building one component may reveal more references. Continue until the
  // reachable closure has been materialized.
  let previousSize = -1;
  while (previousSize !== referenced.size) {
    previousSize = referenced.size;
    for (const ref of referenced) {
      if (components[schemaName(ref)]) continue;
      const node = model.schemas[ref];
      if (node) components[schemaName(ref)] = schemaFromNode(node, reference);
    }
  }

  const securitySchemes = Object.fromEntries(
    model.securitySchemes.map((scheme) => [scheme.id, securityScheme(scheme)]),
  );
  const document = {
    openapi: '3.2.0',
    info: {
      title: `${model.metadata.sourceLabel} · ${endpoint.summary ?? `${endpoint.method} ${endpoint.path}`}`,
      version: model.metadata.sourceVersion,
      ...(endpoint.description ? { description: endpoint.description } : {}),
    },
    ...(model.servers.length
      ? {
          servers: model.servers.map((server) => ({
            url: server.url,
            ...(server.description ? { description: server.description } : {}),
            ...(server.variables ? { variables: server.variables } : {}),
          })),
        }
      : {}),
    ...(model.security?.length ? { security: model.security } : {}),
    paths: {
      [denormalizePath(endpoint.path)]: {
        [endpoint.method.toLowerCase()]: operation,
      },
    },
    ...(Object.keys(components).length || Object.keys(securitySchemes).length
      ? {
          components: {
            ...(Object.keys(components).length ? { schemas: components } : {}),
            ...(Object.keys(securitySchemes).length ? { securitySchemes } : {}),
          },
        }
      : {}),
  };

  return {
    yaml: stringify(document, { lineWidth: 0 }),
    origin: definitionOrigin(persistedSourceType),
    sourceLabel: model.metadata.sourceLabel,
    fileName: `${endpoint.method.toLowerCase()}-${endpoint.path.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'endpoint'}.openapi.yaml`,
  };
}
