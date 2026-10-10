import type {
  ApiSchemaNode,
  Endpoint as CanonicalEndpoint,
} from '@sketch-test/canonical-api-model';
import { describe, expect, test } from 'vitest';
import {
  endpointDetailFromCanonical,
  schemaDisplayNodesFromCanonical,
} from './endpointDetailFromCanonical';

const schemas: Record<string, ApiSchemaNode> = {
  '/schemas/CreateOrder': {
    id: '/schemas/CreateOrder',
    type: 'object',
    properties: {
      sku: { ref: '/schemas/Sku', displayName: 'SKU' },
    },
    required: ['sku'],
    nullable: false,
    deprecated: false,
  },
  '/schemas/Sku': {
    id: '/schemas/Sku',
    type: 'string',
    example: 'coffee-001',
    nullable: false,
    deprecated: false,
  },
};

const endpoint = {
  id: 'POST-/orders',
  method: 'POST',
  path: '/orders/:orderId',
  summary: '创建订单',
  deprecated: false,
  tags: ['订单'],
  parameters: [
    {
      id: 'param-order-id',
      name: 'orderId',
      in: 'path',
      required: true,
      deprecated: false,
      allowEmptyValue: false,
      example: 'order-001',
    },
    {
      id: 'param-trace',
      name: 'X-Trace-Id',
      in: 'header',
      required: false,
      deprecated: false,
      allowEmptyValue: false,
      example: 'trace-001',
    },
    {
      id: 'param-authorization',
      name: 'Authorization',
      in: 'header',
      required: true,
      deprecated: false,
      allowEmptyValue: false,
      example: 'Bearer should-not-be-displayed',
    },
  ],
  requestBodies: [
    {
      id: 'body-order',
      required: true,
      content: {
        'application/json': {
          schema: { ref: '/schemas/CreateOrder' },
          example: { sku: 'coffee-001' },
        },
      },
    },
  ],
  responses: [
    {
      id: 'response-created',
      statusCode: 201,
      description: '已创建',
      content: {
        'application/json': {
          schema: { ref: '/schemas/CreateOrder' },
        },
      },
    },
  ],
  sourceLocations: [],
} as CanonicalEndpoint;

describe('endpointDetailFromCanonical', () => {
  test('preserves source parameters, headers, body examples, and response definitions', () => {
    const displaySchemas = schemaDisplayNodesFromCanonical(schemas);
    const detail = endpointDetailFromCanonical(endpoint, displaySchemas);

    expect(detail.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'orderId', in: 'path', example: 'order-001' }),
        expect.objectContaining({ name: 'X-Trace-Id', in: 'header', example: 'trace-001' }),
        expect.objectContaining({ name: 'Authorization', in: 'header', example: undefined }),
      ]),
    );
    expect(detail.requestBodies[0]).toMatchObject({
      contentTypes: ['application/json'],
      schemaRef: '/schemas/CreateOrder',
      exampleBody: '{"sku":"coffee-001"}',
    });
    expect(detail.responses[0]).toMatchObject({
      statusCode: 201,
      schemaRef: '/schemas/CreateOrder',
    });
    expect(displaySchemas['/schemas/CreateOrder']?.properties?.['sku']?.type).toBe('string');
  });
});
