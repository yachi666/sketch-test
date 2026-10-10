import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ObjectStore } from '../../../shared/object-storage.js';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('../../../db/db.js', () => ({ pool: { query: mockQuery } }));
vi.mock('../../../shared/id.js', () => ({ apiVersionId: () => 'api-v1' }));

import {
  type ImportNetworkPolicy,
  importApiSpec,
  importPostmanV3Bundle,
} from '../import.service.js';

const networkPolicy: ImportNetworkPolicy = { allowedHosts: ['example.test'] };

const document = {
  openapi: '3.1.0',
  info: { title: 'Stored API', version: '1.0.0' },
  paths: {
    '/health': {
      get: { responses: { '200': { description: 'OK' } } },
    },
  },
};

describe('importApiSpec object storage', () => {
  beforeEach(() => {
    mockQuery.mockReset().mockResolvedValue({ rowCount: 1 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(document))));
  });

  afterEach(() => vi.unstubAllGlobals());

  test('stores raw source by its SHA-256 content address before persisting metadata', async () => {
    const store: ObjectStore = {
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      exists: vi.fn(),
    };
    const output = await importApiSpec(
      {
        workspaceId: 'ws_test',
        sourceType: 'url',
        sourceLocation: 'https://example.test/openapi.json',
      },
      store,
      networkPolicy,
    );

    expect(output.sourceObjectKey).toMatch(/^api-sources\/sha256\/[a-f0-9]{64}\.source$/);
    expect(store.put).toHaveBeenCalledWith(
      output.sourceObjectKey,
      JSON.stringify(document),
      'application/json',
    );
    expect(mockQuery).toHaveBeenCalledOnce();
    expect(mockQuery.mock.calls[0]?.[1]).toContain(output.sourceObjectKey);
    expect(store.put).toHaveBeenCalledBefore(mockQuery);
  });

  test('does not create database metadata when durable source storage fails', async () => {
    const store: ObjectStore = {
      put: vi.fn().mockRejectedValue(new Error('object store unavailable')),
      get: vi.fn(),
      exists: vi.fn(),
    };

    await expect(
      importApiSpec(
        {
          workspaceId: 'ws_test',
          sourceType: 'url',
          sourceLocation: 'https://example.test/openapi.json',
        },
        store,
        networkPolicy,
      ),
    ).rejects.toThrow(/unavailable/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('imports YAML and retains its source media type', async () => {
    const yaml = `openapi: 3.2.0
info:
  title: YAML API
  version: 1.0.0
paths:
  /search:
    query:
      responses:
        "200":
          description: OK
`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(yaml)));
    const store: ObjectStore = {
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      exists: vi.fn(),
    };

    const output = await importApiSpec(
      {
        workspaceId: 'ws_test',
        sourceType: 'url',
        sourceLocation: 'https://example.test/openapi.yaml',
      },
      store,
      networkPolicy,
    );

    expect(output.endpointCount).toBe(1);
    expect(store.put).toHaveBeenCalledWith(output.sourceObjectKey, yaml, 'application/yaml');
  });

  test('rejects a host outside the explicit allowlist before fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const store: ObjectStore = { put: vi.fn(), get: vi.fn(), exists: vi.fn() };

    await expect(
      importApiSpec(
        {
          workspaceId: 'ws_test',
          sourceType: 'url',
          sourceLocation: 'http://169.254.169.254/latest/meta-data',
        },
        store,
        networkPolicy,
      ),
    ).rejects.toThrow(/not allowed/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('revalidates redirect targets against the allowlist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location: 'http://localhost/internal-openapi.json' },
        }),
      ),
    );
    const store: ObjectStore = { put: vi.fn(), get: vi.fn(), exists: vi.fn() };

    await expect(
      importApiSpec(
        {
          workspaceId: 'ws_test',
          sourceType: 'url',
          sourceLocation: 'https://example.test/openapi.json',
        },
        store,
        networkPolicy,
      ),
    ).rejects.toThrow(/not allowed/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('stops reading a response that exceeds the configured byte limit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x'.repeat(65))));
    const store: ObjectStore = { put: vi.fn(), get: vi.fn(), exists: vi.fn() };

    await expect(
      importApiSpec(
        {
          workspaceId: 'ws_test',
          sourceType: 'url',
          sourceLocation: 'https://example.test/openapi.json',
        },
        store,
        { ...networkPolicy, maxBytes: 64 },
      ),
    ).rejects.toThrow(/64-byte size limit/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('aborts an import when the fetch deadline expires', async () => {
    const abortingFetch = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        }),
    ) as unknown as typeof fetch;
    const store: ObjectStore = { put: vi.fn(), get: vi.fn(), exists: vi.fn() };

    await expect(
      importApiSpec(
        {
          workspaceId: 'ws_test',
          sourceType: 'url',
          sourceLocation: 'https://example.test/openapi.json',
        },
        store,
        { ...networkPolicy, timeoutMs: 5, fetch: abortingFetch },
      ),
    ).rejects.toThrow(/timed out after 5ms/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test.each([
    ['file:///etc/passwd', /http: or https:/],
    ['https://user:secret@example.test/openapi.json', /embedded credentials/],
  ])('rejects unsafe import URL %s', async (sourceLocation, expected) => {
    const fetchMock = vi.fn();
    const store: ObjectStore = { put: vi.fn(), get: vi.fn(), exists: vi.fn() };

    await expect(
      importApiSpec({ workspaceId: 'ws_test', sourceType: 'url', sourceLocation }, store, {
        ...networkPolicy,
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(expected);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('stores every Postman v3 source resource and keeps script bodies out of database metadata', async () => {
    const store: ObjectStore = {
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      exists: vi.fn(),
    };
    const output = await importPostmanV3Bundle(
      {
        workspaceId: 'ws_test',
        sourceLocation: 'git://example.test/postman/orders',
        bundle: {
          files: {
            'definition.yaml': 'name: Orders\n',
            'create.request.yaml':
              'name: Create\nmethod: POST\nurl: https://api.example.test/orders\n',
            'create.resources/scripts/test.js':
              "pm.test('created', () => pm.response.to.have.status(201));",
            'create.resources/extensions/future.txt': 'retain future resource',
          },
        },
      },
      store,
    );

    expect(output.sourceObjectKey).toMatch(
      /^api-sources\/postman-v3\/sha256\/[a-f0-9]{64}\.manifest\.json$/,
    );
    expect(store.put).toHaveBeenCalledTimes(5); // four resources plus their source manifest
    const insert = mockQuery.mock.calls[0]?.[1] as unknown[];
    const persistedModel = String(insert?.[6]);
    expect(persistedModel).toContain('create.resources/extensions/future.txt');
    expect(persistedModel).not.toContain("pm.test('created'");
  });
});
