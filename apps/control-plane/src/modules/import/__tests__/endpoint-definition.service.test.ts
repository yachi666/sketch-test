import type { CanonicalApiModel } from '@sketch-test/canonical-api-model';
import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';
import { createEndpointDefinition } from '../endpoint-definition.service.js';

const model = {
  schemaVersion: 'sketch-test.canonical-api/v1',
  metadata: {
    sourceId: 'src_1',
    sourceType: 'openapi',
    sourceLabel: 'orders.openapi.yaml',
    sourceVersion: '1.0.0',
    sourceHash: 'a'.repeat(64),
    parserName: 'test',
    parserVersion: '1.0.0',
    ingestedAt: '2026-07-16T00:00:00.000Z',
  },
  servers: [{ id: 'server_1', url: 'https://api.example.test' }],
  securitySchemes: [],
  schemas: {
    '/schemas/Order': {
      id: '/schemas/Order',
      type: 'object',
      nullable: false,
      deprecated: false,
      properties: { id: { ref: '/schemas/Order/properties/id' } },
      required: ['id'],
    },
    '/schemas/Order/properties/id': {
      id: '/schemas/Order/properties/id',
      type: 'string',
      nullable: false,
      deprecated: false,
    },
  },
  endpoints: [
    {
      id: 'GET-/orders/:id',
      method: 'GET',
      path: '/orders/:id',
      summary: 'Get order',
      deprecated: false,
      parameters: [
        {
          id: 'param_1',
          name: 'id',
          in: 'path',
          required: true,
          deprecated: false,
          allowEmptyValue: false,
          schema: { ref: '/schemas/Order/properties/id' },
        },
      ],
      requestBodies: [],
      responses: [
        {
          id: 'response_200',
          statusCode: 200,
          description: 'Order',
          content: { 'application/json': { schema: { ref: '/schemas/Order' } } },
        },
      ],
      sourceLocations: [
        {
          sourceId: 'src_1',
          sourceLabel: 'orders.openapi.yaml',
          sourceVersion: '1.0.0',
          sourceHash: 'a'.repeat(64),
          location: '#/paths/~1orders~1{id}/get',
          ingestedAt: '2026-07-16T00:00:00.000Z',
        },
      ],
    },
  ],
  diagnostics: [],
} as unknown as CanonicalApiModel;

describe('createEndpointDefinition', () => {
  test('produces a portable one-endpoint OpenAPI YAML document', () => {
    const definition = createEndpointDefinition(model, model.endpoints[0]!, 'openapi');
    const parsed = parse(definition.yaml) as {
      openapi: string;
      paths: Record<
        string,
        { get: { responses: Record<string, { content: Record<string, { schema: unknown }> }> } }
      >;
      components: {
        schemas: Record<string, { properties?: Record<string, unknown> }>;
      };
    };

    expect(definition.origin).toBe('derived-openapi');
    expect(parsed.openapi).toBe('3.2.0');
    expect(
      parsed.paths['/orders/{id}']?.get.responses['200']?.content['application/json']?.schema,
    ).toEqual({ $ref: '#/components/schemas/_2f_schemas_2f_Order' });
    expect(parsed.components.schemas['_2f_schemas_2f_Order']?.properties?.['id']).toEqual({
      $ref: '#/components/schemas/_2f_schemas_2f_Order_2f_properties_2f_id',
    });
  });

  test('marks Postman projections as derived instead of original OpenAPI', () => {
    expect(createEndpointDefinition(model, model.endpoints[0]!, 'postman-v3').origin).toBe(
      'derived-postman',
    );
  });
});
