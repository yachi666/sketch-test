import { exportArazzoText, importArazzoText } from '@sketch-test/adapter-arazzo';
import type { CanonicalApiModel } from '@sketch-test/canonical-api-model';
import { describe, expect, test } from 'vitest';
import { compileWorkflow } from '../workflow-compiler';

const apiModel = {
  schemaVersion: 'sketch-test.canonical-api/v1',
  metadata: {
    sourceId: 'source-orders',
    sourceType: 'openapi',
    sourceLabel: 'orders.yaml',
    sourceVersion: '1.0.0',
    sourceHash: 'a'.repeat(64),
    parserName: '@sketch-test/adapter-openapi',
    parserVersion: '0.1.0',
    ingestedAt: '2026-07-13T00:00:00.000Z',
  },
  servers: [{ id: 'server-1', url: 'https://orders.example.test' }],
  securitySchemes: [],
  schemas: {},
  endpoints: [
    {
      id: 'POST-/orders',
      operationId: 'createOrder',
      method: 'POST',
      path: '/orders',
      deprecated: false,
      parameters: [],
      requestBodies: [],
      responses: [],
      sourceLocations: [
        {
          sourceId: 'source-orders',
          sourceLabel: 'orders.yaml',
          sourceVersion: '1.0.0',
          sourceHash: 'a'.repeat(64),
          location: '$.paths./orders.post',
          ingestedAt: '2026-07-13T00:00:00.000Z',
        },
      ],
    },
  ],
  diagnostics: [],
} as CanonicalApiModel;

describe('Arazzo → WorkflowDefinition → ExecutionPlan', () => {
  test('compiles the imported sequential HTTP subset through the production compiler', async () => {
    const imported = importArazzoText(
      `arazzo: 1.1.0
info: { title: Order flow, version: 1.0.0 }
sourceDescriptions:
  - { name: orders, url: ./orders.yaml, type: openapi }
workflows:
  - workflowId: createOrderFlow
    steps:
      - stepId: create
        operationId: createOrder
        requestBody:
          contentType: application/json
          payload: { sku: $inputs.sku }
        successCriteria:
          - condition: $statusCode == 201
        outputs:
          orderId: $response.body#/id
`,
      { sourceLabel: 'orders.arazzo.yaml', openApiSources: { orders: apiModel } },
    );

    expect(imported.success).toBe(true);
    const compiled = await compileWorkflow(imported.workflows[0]!);
    expect(compiled.success).toBe(true);
    expect(compiled.plan?.steps[0]).toMatchObject({
      method: 'POST',
      urlTemplate: 'https://orders.example.test/orders',
      body: { sku: '${sku}' },
      assertions: [{ target: 'status', operator: 'equals', expected: 201 }],
      extractions: [{ name: 'orderId', source: 'body', expression: '$.id' }],
      sideEffect: 'cleanup-required',
    });

    const exported = exportArazzoText(imported.workflows, {
      info: { title: 'Order flow', version: '1.0.0' },
      sourceDescriptions: [{ name: 'orders', url: './orders.yaml' }],
      openApiSources: { orders: apiModel },
    });
    expect(exported.success).toBe(true);
    const reimported = importArazzoText(exported.source!, {
      sourceLabel: 'roundtrip.arazzo.yaml',
      openApiSources: { orders: apiModel },
    });
    expect(reimported.success).toBe(true);
    const recompiled = await compileWorkflow(reimported.workflows[0]!);
    expect(recompiled.plan?.planHash).toBe(compiled.plan?.planHash);
  });
});
