import type { CanonicalApiModel } from '@sketch-test/canonical-api-model';
import { describe, expect, test } from 'vitest';
import { exportArazzoText, importArazzoText } from '../index';

function apiModel(source: string, operationId: string, method: 'GET' | 'POST', path: string) {
  return {
    schemaVersion: 'sketch-test.canonical-api/v1',
    metadata: {
      sourceId: `source-${source}`,
      sourceType: 'openapi',
      sourceLabel: `${source}.yaml`,
      sourceVersion: '1.0.0',
      sourceHash: 'a'.repeat(64),
      parserName: '@sketch-test/adapter-openapi',
      parserVersion: '0.1.0',
      ingestedAt: '2026-07-13T00:00:00.000Z',
    },
    servers: [{ id: 'server-1', url: 'https://api.example.test' }],
    securitySchemes: [],
    schemas: {},
    endpoints: [
      {
        id: `${method}-${path}`,
        operationId,
        method,
        path,
        deprecated: false,
        parameters: [],
        requestBodies: [],
        responses: [],
        sourceLocations: [
          {
            sourceId: `source-${source}`,
            sourceLabel: `${source}.yaml`,
            sourceVersion: '1.0.0',
            sourceHash: 'a'.repeat(64),
            location: `$.paths.${path}.${method.toLowerCase()}`,
            ingestedAt: '2026-07-13T00:00:00.000Z',
          },
        ],
      },
    ],
    diagnostics: [],
  } as CanonicalApiModel;
}

const usersApi = {
  ...apiModel('users', 'createUser', 'POST', '/users'),
  endpoints: [
    ...apiModel('users', 'createUser', 'POST', '/users').endpoints,
    ...apiModel('users', 'getUser', 'GET', '/users/:userId').endpoints,
  ],
} as CanonicalApiModel;

const options = {
  sourceLabel: 'workflow.arazzo.yaml',
  openApiSources: { users: usersApi },
};

describe('Arazzo 1.1 sequential HTTP import', () => {
  test('maps operation ids, runtime values, criteria, outputs, and bounded retry', () => {
    const result = importArazzoText(
      `arazzo: 1.1.0
info:
  title: User lifecycle
  version: 1.0.0
sourceDescriptions:
  - name: users
    url: ./openapi.yaml
    type: openapi
workflows:
  - workflowId: userLifecycle
    summary: User lifecycle
    inputs:
      type: object
      properties:
        displayName: { type: string }
    steps:
      - stepId: create
        operationId: $sourceDescriptions.users.createUser
        requestBody:
          contentType: application/json
          payload:
            name: $inputs.displayName
        successCriteria:
          - condition: $statusCode == 201
        outputs:
          userId: $response.body#/id
      - stepId: fetch
        operationId: getUser
        parameters:
          - name: userId
            in: path
            value: $steps.create.outputs.userId
          - name: X-Trace
            in: header
            value: workflow-test
        successCriteria:
          - condition: $statusCode == 200
        onFailure:
          - name: retryFetch
            type: retry
            retryAfter: 0.25
            retryLimit: 2
`,
      options,
    );

    expect(result.success).toBe(true);
    expect(result.workflows).toHaveLength(1);
    expect(result.workflows[0]?.steps[0]).toMatchObject({
      id: 'create',
      useTest: {
        kind: 'inline',
        method: 'POST',
        url: 'https://api.example.test/users',
        headers: { 'Content-Type': 'application/json' },
        body: { name: '${displayName}' },
      },
      assertions: [{ target: 'status', operator: 'equals', expected: 201 }],
      extract: [{ name: 'userId', source: 'body', expression: '$.id' }],
      sideEffect: 'cleanup-required',
    });
    expect(result.workflows[0]?.steps[1]).toMatchObject({
      useTest: {
        method: 'GET',
        url: 'https://api.example.test/users/${create.userId}',
        headers: { 'X-Trace': 'workflow-test' },
      },
      retry: { maxRetries: 2, baseDelayMs: 250, backoffMultiplier: 1 },
      sideEffect: 'read-only',
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'ARAZZO_INPUT_SCHEMA_PRESERVED', severity: 'info' }),
    );

    const exported = exportArazzoText(result.workflows, {
      info: { title: 'User lifecycle', version: '1.0.0' },
      sourceDescriptions: [{ name: 'users', url: './openapi.yaml' }],
      openApiSources: { users: usersApi },
    });
    expect(exported.success).toBe(true);
    expect(exported.source).toContain('arazzo: 1.1.0');

    const reimported = importArazzoText(exported.source!, options);
    expect(reimported.success).toBe(true);
    expect(reimported.workflows).toEqual(result.workflows);
  });

  test('rejects AsyncAPI sources without introducing a second execution engine', () => {
    const result = importArazzoText(
      `arazzo: 1.1.0
info: { title: Async, version: 1.0.0 }
sourceDescriptions:
  - name: events
    url: ./asyncapi.yaml
    type: asyncapi
workflows:
  - workflowId: asyncFlow
    steps:
      - stepId: receive
        channelPath: $sourceDescriptions.events.orders
        action: receive
`,
      { ...options, openApiSources: {} },
    );
    expect(result.success).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'ARAZZO_ASYNCAPI_NOT_SUPPORTED' }),
    );
  });

  test('resolves relative source URLs and verifies canonical content hashes', () => {
    const source = `arazzo: 1.1.0
info: { title: Verified, version: 1.0.0 }
sourceDescriptions:
  - { name: users, url: ./openapi.yaml, type: openapi }
workflows:
  - workflowId: verified
    steps:
      - { stepId: get, operationId: getUser }
`;
    const verified = importArazzoText(source, {
      sourceLabel: 'user.arazzo.yaml',
      documentUrl: 'https://workflows.example.test/flows/user.arazzo.yaml',
      requireVerifiedSources: true,
      openApiSources: {
        users: {
          model: usersApi,
          retrievalUrl: 'https://workflows.example.test/flows/openapi.yaml',
          contentHash: 'a'.repeat(64),
        },
      },
    });
    expect(verified.success).toBe(true);

    const mismatch = importArazzoText(source, {
      sourceLabel: 'user.arazzo.yaml',
      documentUrl: 'https://workflows.example.test/flows/user.arazzo.yaml',
      requireVerifiedSources: true,
      openApiSources: {
        users: {
          model: usersApi,
          retrievalUrl: 'https://different.example.test/openapi.yaml',
          contentHash: 'b'.repeat(64),
        },
      },
    });
    expect(mismatch.success).toBe(false);
    expect(mismatch.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ARAZZO_SOURCE_URL_MISMATCH' }),
        expect.objectContaining({ code: 'ARAZZO_SOURCE_HASH_MISMATCH' }),
      ]),
    );
  });

  test('rejects workflow chaining and operationPath with stable diagnostics', () => {
    const result = importArazzoText(
      `arazzo: 1.1.0
info: { title: Unsupported flow, version: 1.0.0 }
sourceDescriptions:
  - name: users
    url: ./openapi.yaml
    type: openapi
workflows:
  - workflowId: unsupported
    steps:
      - stepId: nested
        workflowId: other
      - stepId: pathRef
        operationPath: '{$sourceDescriptions.users.url}#/paths/~1users/get'
`,
      options,
    );
    expect(result.success).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ARAZZO_WORKFLOW_CHAINING_NOT_SUPPORTED' }),
        expect.objectContaining({ code: 'ARAZZO_OPERATION_PATH_NOT_SUPPORTED' }),
      ]),
    );
  });

  test('rejects duplicate YAML keys and unknown versions', () => {
    const duplicate = importArazzoText(
      'arazzo: 1.1.0\narazzo: 1.0.1\ninfo: { title: Bad, version: 1.0.0 }\n',
      options,
    );
    expect(duplicate.diagnostics[0]?.code).toBe('INVALID_ARAZZO_SYNTAX');

    const unknown = importArazzoText(
      `arazzo: 1.2.0
info: { title: Future, version: 1.0.0 }
sourceDescriptions: [{ name: users, url: ./openapi.yaml, type: openapi }]
workflows: [{ workflowId: future, steps: [{ stepId: get, operationId: getUser }] }]
`,
      options,
    );
    expect(unknown.diagnostics[0]?.code).toBe('UNSUPPORTED_ARAZZO_VERSION');
  });

  test('returns structural diagnostics instead of throwing on malformed nested input', () => {
    const result = importArazzoText(
      `arazzo: 1.1.0
info: { title: Malformed, version: 1.0.0 }
sourceDescriptions: [null]
workflows:
  - workflowId: broken
    steps: [null]
`,
      options,
    );
    expect(result.success).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'INVALID_ARAZZO_SOURCE' }),
        expect.objectContaining({ code: 'INVALID_ARAZZO_STEP' }),
      ]),
    );
  });

  test('rejects ambiguous unqualified operation ids', () => {
    const result = importArazzoText(
      `arazzo: 1.1.0
info: { title: Ambiguous, version: 1.0.0 }
sourceDescriptions:
  - { name: users, url: ./users.yaml, type: openapi }
  - { name: admin, url: ./admin.yaml, type: openapi }
workflows:
  - workflowId: ambiguous
    steps:
      - { stepId: create, operationId: createUser }
`,
      {
        ...options,
        openApiSources: {
          users: apiModel('users', 'createUser', 'POST', '/users'),
          admin: apiModel('admin', 'createUser', 'POST', '/admin/users'),
        },
      },
    );
    expect(result.success).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'ARAZZO_OPERATION_AMBIGUOUS' }),
    );
  });
});
