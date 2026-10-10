import type { CanonicalApiModel } from '@sketch-test/canonical-api-model';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ObjectStore } from '../../../shared/object-storage.js';

const { clientQuery, mockConnect, mockQuery, release } = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  mockConnect: vi.fn(),
  mockQuery: vi.fn(),
  release: vi.fn(),
}));

vi.mock('../../../db/db.js', () => ({
  pool: { query: mockQuery, connect: mockConnect },
}));
vi.mock('../../../shared/id.js', () => ({
  workflowId: () => 'wf_imported',
  workflowVersionId: () => 'wfv_imported',
}));

import { ArazzoImportError, importArazzoWorkflows } from '../arazzo-import.service.js';

const sourceHash = 'a'.repeat(64);
const apiModel = {
  schemaVersion: 'sketch-test.canonical-api/v1',
  metadata: {
    sourceId: 'av_source',
    sourceType: 'openapi',
    sourceLabel: 'https://fixture.test/openapi.json',
    sourceVersion: '1.0.0',
    sourceHash,
    parserName: '@sketch-test/adapter-openapi',
    parserVersion: '0.1.0',
    ingestedAt: '2026-07-13T00:00:00.000Z',
  },
  servers: [{ id: 'server-1', url: 'https://fixture.test' }],
  securitySchemes: [],
  schemas: {},
  endpoints: [
    {
      id: 'QUERY-/api/search',
      operationId: 'searchUsers',
      method: 'QUERY',
      path: '/api/search',
      deprecated: false,
      parameters: [],
      requestBodies: [],
      responses: [],
      sourceLocations: [
        {
          sourceId: 'av_source',
          sourceLabel: 'https://fixture.test/openapi.json',
          sourceVersion: '1.0.0',
          sourceHash,
          location: '$.paths./api/search.query',
          ingestedAt: '2026-07-13T00:00:00.000Z',
        },
      ],
    },
  ],
  diagnostics: [],
} satisfies CanonicalApiModel;

const sourceText = `arazzo: 1.1.0
info: { title: Search flow, version: 1.0.0 }
sourceDescriptions:
  - { name: fixture, url: https://fixture.test/openapi.json, type: openapi }
workflows:
  - workflowId: searchFlow
    steps:
      - stepId: search
        operationId: $sourceDescriptions.fixture.searchUsers
        requestBody:
          contentType: application/json
          payload: { term: test }
        successCriteria:
          - condition: $statusCode == 200
`;

function objectStore(): ObjectStore {
  return {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
    exists: vi.fn(),
  };
}

describe('importArazzoWorkflows', () => {
  beforeEach(() => {
    mockQuery.mockReset().mockResolvedValue({
      rows: [
        {
          id: 'av_source',
          source_location: 'https://fixture.test/openapi.json',
          content_hash: sourceHash,
          spec_json: apiModel,
        },
      ],
    });
    clientQuery.mockReset().mockResolvedValue({ rows: [] });
    release.mockReset();
    mockConnect.mockReset().mockResolvedValue({ query: clientQuery, release });
  });

  test('stores provenance and creates an immutable v1 workflow in one transaction', async () => {
    const store = objectStore();
    const result = await importArazzoWorkflows(
      {
        workspaceId: 'ws_owner',
        sourceText,
        sourceLocation: 'https://fixture.test/workflows/search.arazzo.yaml',
        sources: { fixture: 'av_source' },
      },
      store,
    );

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('workspace_id = $1'), [
      'ws_owner',
      ['av_source'],
    ]);
    expect(result.workflows).toEqual([
      { workflowId: 'wf_imported', workflowVersionId: 'wfv_imported', name: 'searchFlow' },
    ]);
    expect(result.sourceObjectKey).toMatch(/^workflow-sources\/sha256\/[a-f0-9]{64}\.arazzo$/);
    expect(store.put).toHaveBeenCalledWith(result.sourceObjectKey, sourceText, 'application/yaml');
    expect(clientQuery.mock.calls.map(([query]) => query)).toEqual([
      'BEGIN',
      expect.stringContaining('INSERT INTO workflows'),
      expect.stringContaining('INSERT INTO workflow_versions'),
      'COMMIT',
    ]);
    const storedDefinition = JSON.parse(clientQuery.mock.calls[2]?.[1]?.[2] as string);
    expect(storedDefinition).toMatchObject({
      id: 'wf_imported',
      schemaVersion: 'sketch-test.workflow/v1',
      source: {
        type: 'arazzo',
        sourceLabel: 'https://fixture.test/workflows/search.arazzo.yaml',
        sourceObjectKey: result.sourceObjectKey,
        contentHash: result.contentHash,
        specificationVersion: '1.1.0',
      },
    });
    expect(release).toHaveBeenCalledOnce();
  });

  test('rejects a source from another workspace before durable writes', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const store = objectStore();

    await expect(
      importArazzoWorkflows(
        {
          workspaceId: 'ws_attacker',
          sourceText,
          sourceLocation: 'https://fixture.test/workflows/search.arazzo.yaml',
          sources: { fixture: 'av_source' },
        },
        store,
      ),
    ).rejects.toThrow(ArazzoImportError);

    expect(store.put).not.toHaveBeenCalled();
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('rolls back and releases the client when version persistence fails', async () => {
    clientQuery.mockImplementation(async (query: string) => {
      if (query.includes('INSERT INTO workflow_versions')) throw new Error('database unavailable');
      return { rows: [] };
    });

    await expect(
      importArazzoWorkflows(
        {
          workspaceId: 'ws_owner',
          sourceText,
          sourceLocation: 'https://fixture.test/workflows/search.arazzo.yaml',
          sources: { fixture: 'av_source' },
        },
        objectStore(),
      ),
    ).rejects.toThrow(/database unavailable/);

    expect(clientQuery).toHaveBeenLastCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });
});
