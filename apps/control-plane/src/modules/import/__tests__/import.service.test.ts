import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ObjectStore } from '../../../shared/object-storage.js';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('../../../db/db.js', () => ({ pool: { query: mockQuery } }));
vi.mock('../../../shared/id.js', () => ({ apiVersionId: () => 'api-v1' }));

import { importApiSpec } from '../import.service.js';

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
    );

    expect(output.sourceObjectKey).toMatch(/^api-sources\/sha256\/[a-f0-9]{64}\.json$/);
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
      ),
    ).rejects.toThrow(/unavailable/);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
