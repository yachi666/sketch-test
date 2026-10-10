/**
 * OpenAPI 3.2 compatibility and fail-closed parsing tests.
 *
 * Fixtures are intentionally small adaptations of constructs in the official
 * OpenAPI 3.2 specification so each supported or gated behavior is explicit.
 */
import { describe, expect, test } from 'vitest';
import {
  importOpenApi,
  importOpenApiText,
  type OpenApiDocument,
  validateAndImportOpenApiText,
} from '../index';

const SOURCE_HASH = 'b1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2' as const;

const options = {
  sourceLabel: 'oas32.yaml',
  sourceHash: SOURCE_HASH,
};

function minimalDocument(overrides: Record<string, unknown> = {}): OpenApiDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'OpenAPI 3.2 fixture', version: '1.0.0' },
    paths: {
      '/search': {
        query: {
          operationId: 'searchItems',
          responses: { '200': { description: 'Search results' } },
        },
      },
    },
    ...overrides,
  } as OpenApiDocument;
}

describe('OpenAPI 3.2 compatibility', () => {
  test.each(['3.0.4', '3.1.2', '3.2.0'])(
    'accepts YAML for supported baseline %s through the validated entry',
    async (version) => {
      const result = await validateAndImportOpenApiText(
        `openapi: ${version}
info:
  title: Baseline API
  version: 1.0.0
paths:
  /health:
    get:
      responses:
        "200":
          description: OK
`,
        options,
      );
      expect(result.success).toBe(true);
      expect(result.model?.metadata.extra?.['openapiVersion']).toBe(version);
    },
  );

  test('imports YAML 1.2 and preserves 3.2 document metadata', () => {
    const source = `
openapi: 3.2.0
$self: https://api.example.test/openapi.yaml
jsonSchemaDialect: https://json-schema.org/draft/2020-12/schema
info:
  title: Search API
  version: 1.0.0
tags:
  - name: products
    summary: Products
    kind: nav
  - name: books
    parent: products
    kind: nav
paths:
  /search:
    query:
      operationId: searchProducts
      tags: [books]
      responses:
        "200":
          description: Search results
components:
  securitySchemes:
    deviceAuth:
      type: oauth2
      oauth2MetadataUrl: https://auth.example.test/.well-known/oauth-authorization-server
      flows:
        deviceAuthorization:
          deviceAuthorizationUrl: https://auth.example.test/device
          tokenUrl: https://auth.example.test/token
          scopes: {}
`;

    const result = importOpenApiText(source, options);

    expect(result.success).toBe(true);
    expect(result.model?.endpoints[0]?.method).toBe('QUERY');
    expect(result.model?.metadata.extra).toMatchObject({
      openapiVersion: '3.2.0',
      documentSelf: 'https://api.example.test/openapi.yaml',
      jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
      tagDefinitions: [
        { name: 'products', summary: 'Products', kind: 'nav' },
        { name: 'books', parent: 'products', kind: 'nav' },
      ],
    });
    expect(result.model?.securitySchemes[0]).toMatchObject({
      oauth2MetadataUrl: 'https://auth.example.test/.well-known/oauth-authorization-server',
      flows: {
        deviceAuthorization: {
          deviceAuthorizationUrl: 'https://auth.example.test/device',
          tokenUrl: 'https://auth.example.test/token',
        },
      },
    });
  });

  test('keeps untrusted Markdown and HTML descriptions as inert source data', () => {
    const untrusted = '<img src=x onerror="globalThis.pwned=true"> [run](javascript:alert(1))';
    const result = importOpenApi(
      minimalDocument({
        paths: {
          '/search': {
            query: {
              operationId: 'searchItems',
              description: untrusted,
              responses: { '200': { description: 'Search results' } },
            },
          },
        },
      }),
      options,
    );

    expect(result.success).toBe(true);
    expect(result.model?.endpoints[0]?.description).toBe(untrusted);
  });

  test('preserves a 3.1 JSON Schema dialect identifier', () => {
    const result = importOpenApi(
      minimalDocument({
        openapi: '3.1.2',
        jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
        paths: {
          '/health': {
            get: { responses: { '200': { description: 'OK' } } },
          },
        },
      }),
      options,
    );
    expect(result.success).toBe(true);
    expect(result.model?.metadata.extra?.['jsonSchemaDialect']).toBe(
      'https://json-schema.org/draft/2020-12/schema',
    );
  });

  test('rejects jsonSchemaDialect on OpenAPI 3.0', () => {
    const result = importOpenApi(
      minimalDocument({
        openapi: '3.0.4',
        jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
      }),
      options,
    );
    expect(result.success).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'JSON_SCHEMA_DIALECT_NOT_ALLOWED' }),
    );
  });

  test('rejects QUERY when the document declares an earlier OpenAPI version', () => {
    const result = importOpenApi(minimalDocument({ openapi: '3.1.2' }), options);
    expect(result.success).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'QUERY_METHOD_NOT_ALLOWED' }),
    );
  });

  test('rejects unknown future OpenAPI minor versions', () => {
    const result = importOpenApi(minimalDocument({ openapi: '3.3.0' }), options);
    expect(result.success).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('UNSUPPORTED_OPENAPI_VERSION');
  });

  test('rejects additional operations until the Runner protocol can execute them', () => {
    const document = minimalDocument({
      paths: {
        '/items': {
          additionalOperations: {
            COPY: { responses: { '200': { description: 'Copied' } } },
          },
        },
      },
    });
    const result = importOpenApi(document, options);
    expect(result.success).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'UNSUPPORTED_ADDITIONAL_OPERATION' }),
    );
  });

  test('rejects querystring parameters instead of coercing them to query parameters', () => {
    const document = minimalDocument({
      paths: {
        '/search': {
          query: {
            parameters: [
              {
                in: 'querystring',
                content: {
                  'application/x-www-form-urlencoded': {
                    schema: { type: 'object', properties: { q: { type: 'string' } } },
                  },
                },
              },
            ],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    });
    const result = importOpenApi(document, options);
    expect(result.success).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'QUERYSTRING_PARAMETER_NOT_EXECUTABLE' }),
    );
  });

  test('rejects streaming itemSchema until streaming evidence exists', () => {
    const document = minimalDocument({
      paths: {
        '/events': {
          get: {
            responses: {
              '200': {
                description: 'Event stream',
                content: {
                  'text/event-stream': {
                    itemSchema: { $ref: '#/components/schemas/Event' },
                  },
                },
              },
            },
          },
        },
      },
      components: { schemas: { Event: { type: 'object' } } },
    });
    const result = importOpenApi(document, options);
    expect(result.success).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'STREAMING_ITEM_SCHEMA_NOT_EXECUTABLE' }),
    );
  });

  test('registers inline request and parameter schemas without dangling references', () => {
    const result = importOpenApi(
      minimalDocument({
        paths: {
          '/search': {
            query: {
              parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1 } }],
              requestBody: {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { term: { type: 'string' } },
                    },
                  },
                },
              },
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      }),
      options,
    );
    expect(result.success).toBe(true);
    const endpoint = result.model?.endpoints[0];
    const parameterRef = endpoint?.parameters[0]?.schema?.ref;
    const bodyRef = endpoint?.requestBodies[0]?.content['application/json']?.schema.ref;
    expect(result.model?.schemas[parameterRef!]).toMatchObject({ type: 'integer', minimum: 1 });
    expect(result.model?.schemas[bodyRef!]).toMatchObject({
      type: 'object',
      properties: { term: { ref: `${bodyRef}/properties/term` } },
    });
  });
});

describe('OpenAPI source safety', () => {
  test('validates the production entry against the published OpenAPI schema family', async () => {
    const result = await validateAndImportOpenApiText(
      `openapi: 3.2.0
info:
  title: Missing API surface
  version: 1.0.0
`,
      options,
    );
    expect(result.success).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'OPENAPI_SCHEMA_VALIDATION_FAILED' }),
    );
  });

  test('rejects duplicate YAML keys', () => {
    const result = importOpenApiText(
      'openapi: 3.2.0\nopenapi: 3.1.2\ninfo:\n  title: Duplicate\n  version: 1.0.0\n',
      options,
    );
    expect(result.success).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('INVALID_OPENAPI_SYNTAX');
  });

  test('enforces the configured source size budget', () => {
    const result = importOpenApiText('x'.repeat(128), { ...options, maxSourceBytes: 64 });
    expect(result.success).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('OPENAPI_SOURCE_TOO_LARGE');
  });

  test('enforces the configured parsed-document depth budget', () => {
    const result = importOpenApiText(
      'openapi: 3.2.0\ninfo: { title: Deep, version: 1.0.0 }\npaths: { /x: { query: { responses: { "200": { description: OK } } } } }\n',
      { ...options, maxDocumentDepth: 4 },
    );
    expect(result.success).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('OPENAPI_DEPTH_BUDGET_EXCEEDED');
  });

  test('enforces the configured parsed-document node budget', () => {
    const result = importOpenApiText(
      'openapi: 3.2.0\ninfo: { title: Wide, version: 1.0.0 }\npaths: {}\n',
      { ...options, maxDocumentNodes: 5 },
    );
    expect(result.success).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('OPENAPI_NODE_BUDGET_EXCEEDED');
  });

  test('rejects external references until bounded resolution is implemented', () => {
    const document = minimalDocument({
      components: {
        schemas: {
          User: { $ref: 'https://untrusted.example.test/schemas.json#/User' },
        },
      },
    });
    const result = importOpenApi(document, options);
    expect(result.success).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'EXTERNAL_REFERENCE_NOT_ALLOWED' }),
    );
  });

  test('preserves internal reference cycles without recursive dereferencing', () => {
    const result = importOpenApi(
      minimalDocument({
        components: {
          schemas: {
            Parent: {
              type: 'object',
              properties: { child: { $ref: '#/components/schemas/Child' } },
            },
            Child: {
              type: 'object',
              properties: { parent: { $ref: '#/components/schemas/Parent' } },
            },
          },
        },
      }),
      options,
    );

    expect(result.success).toBe(true);
    expect(result.model?.schemas['/schemas/Parent']?.properties?.['child']?.ref).toBe(
      '/schemas/Child',
    );
    expect(result.model?.schemas['/schemas/Child']?.properties?.['parent']?.ref).toBe(
      '/schemas/Parent',
    );
  });

  test('rejects boolean JSON Schemas instead of silently dropping their semantics', () => {
    const result = importOpenApi(
      minimalDocument({ components: { schemas: { Anything: true } } }),
      options,
    );
    expect(result.success).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'BOOLEAN_SCHEMA_NOT_REPRESENTABLE' }),
    );
  });

  test('returns diagnostics instead of throwing for structurally invalid input', () => {
    const result = importOpenApiText('openapi: 3.2.0\ninfo: null\n', options);
    expect(result.success).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'INVALID_OPENAPI_INFO' }),
    );
  });

  test('rejects non-semver API versions until the canonical seam can preserve them', () => {
    const result = importOpenApi(
      minimalDocument({ info: { title: 'Calendar version', version: '2026-07' } }),
      options,
    );
    expect(result.success).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('NON_SEMVER_API_VERSION');
  });
});

test('preserves original version labels and uniform path server semantics without changing input', () => {
  const input = minimalDocument({
    info: { title: 'Weather', version: '1.0' },
    paths: {
      '/forecast': {
        servers: [{ url: 'https://api.open-meteo.com' }],
        get: { responses: { '200': { description: 'OK' } } },
      },
    },
  });
  const before = structuredClone(input);
  const result = importOpenApi(input, options);
  expect(result.success).toBe(true);
  expect(result.model?.metadata).toMatchObject({
    sourceVersion: '1.0.0',
    extra: { originalSourceVersion: '1.0' },
  });
  expect(result.model?.servers[0]?.url).toBe('https://api.open-meteo.com');
  expect(input).toEqual(before);
});

test('heterogeneous path servers still fail closed', () => {
  const result = importOpenApi(
    minimalDocument({
      paths: {
        '/a': {
          servers: [{ url: 'https://a.example' }],
          get: { responses: { '200': { description: 'OK' } } },
        },
        '/b': {
          servers: [{ url: 'https://b.example' }],
          get: { responses: { '200': { description: 'OK' } } },
        },
      },
    }),
    options,
  );
  expect(result.success).toBe(false);
  expect(result.diagnostics.some((item) => item.code === 'PATH_SERVERS_NOT_SUPPORTED')).toBe(true);
});
