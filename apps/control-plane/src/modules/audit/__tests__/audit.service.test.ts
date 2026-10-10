import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('../../../db/db.js', () => ({ pool: { query: mockQuery } }));
vi.mock('../../../shared/id.js', () => ({ auditLogId: () => 'audit-1' }));

import { listAuditEvents, recordAuditEvent } from '../audit.service.js';

describe('audit service', () => {
  beforeEach(() => mockQuery.mockReset());

  test('persists structured audit evidence with request correlation', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });
    await expect(
      recordAuditEvent({
        workspaceId: 'ws-1',
        actorType: 'runner',
        actorId: 'runner-1',
        action: 'secret.decrypt',
        resourceType: 'secret',
        resourceId: 'sec-1',
        outcome: 'success',
        requestId: 'req-1',
      }),
    ).resolves.toBe('audit-1');
    expect(mockQuery.mock.calls[0]?.[1]).toEqual([
      'audit-1',
      'ws-1',
      'runner',
      'runner-1',
      'secret.decrypt',
      'secret',
      'sec-1',
      'success',
      'req-1',
      '{}',
    ]);
  });

  test('scopes inspection to a workspace and caps result size', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: 'audit-1',
          workspace_id: 'ws-1',
          actor_type: 'runner',
          actor_id: 'runner-1',
          action: 'secret.decrypt',
          resource_type: 'secret',
          resource_id: 'sec-1',
          outcome: 'success',
          request_id: 'req-1',
          metadata: {},
          created_at: '2026-07-12T00:00:00Z',
        },
      ],
    });
    const result = await listAuditEvents('ws-1', {
      action: 'secret.decrypt',
      resourceType: 'secret',
      limit: 9999,
    });
    expect(result).toHaveLength(1);
    expect(mockQuery.mock.calls[0]?.[1]).toEqual(['ws-1', 'secret.decrypt', 'secret', 500]);
  });
});
