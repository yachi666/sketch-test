/**
 * Policy service unit tests.
 *
 * Tests policy CRUD and rule evaluation engine (with mocked DB).
 */
import { afterEach, describe, expect, test, vi } from 'vitest';

// ─── Mock pool ─────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../../../db/db.js', () => ({
  pool: {
    query: (...args: unknown[]) => mockQuery(...args),
  },
}));

vi.mock('../../../shared/id.js', () => ({
  policyId: () => `pol-${Math.random().toString(36).slice(2, 10)}`,
}));

import {
  createPolicy,
  deletePolicy,
  evaluatePolicies,
  getPolicy,
  listPolicies,
  updatePolicy,
} from '../policy.service';

// ─── Helpers ───────────────────────────────────────────────────────

function makePolicyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pol-001',
    workspace_id: 'ws-001',
    name: 'Production Protection',
    description: 'Blocks destructive operations in production',
    rules_json: [
      {
        id: 'rule-1',
        condition: { environmentId: 'env-prod', sideEffect: ['irreversible'] },
        effect: 'deny',
        priority: 100,
      },
    ],
    priority: 10,
    enabled: true,
    created_at: '2026-06-24T10:00:00Z',
    updated_at: '2026-06-24T10:00:00Z',
    ...overrides,
  };
}

function makeRule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rule-1',
    condition: {},
    effect: 'allow' as const,
    priority: 10,
    ...overrides,
  };
}

function makeSubject(overrides: Record<string, unknown> = {}) {
  return { id: 'usr-001', role: 'owner', ...overrides };
}

function makeResource(overrides: Record<string, unknown> = {}) {
  return { id: 'res-1', type: 'run', ...overrides };
}

// ─── Tests: CRUD ───────────────────────────────────────────────────

describe('createPolicy', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('creates a policy with rules', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT

    const policy = await createPolicy('ws-001', 'Prod Guard', [makeRule({ effect: 'deny' })]);
    expect(policy.name).toBe('Prod Guard');
    expect(policy.enabled).toBe(true);
    expect(policy.rules).toHaveLength(1);
  });
});

describe('getPolicy', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('returns a policy by ID', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makePolicyRow()] });

    const policy = await getPolicy('pol-001');
    expect(policy).not.toBeNull();
    expect(policy!.name).toBe('Production Protection');
  });

  test('returns null for non-existent policy', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const policy = await getPolicy('non-existent');
    expect(policy).toBeNull();
  });
});

describe('listPolicies', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('returns policies sorted by priority DESC', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        makePolicyRow({ id: 'pol-1', priority: 100 }),
        makePolicyRow({ id: 'pol-2', priority: 50 }),
      ],
    });

    const policies = await listPolicies('ws-001');
    expect(policies).toHaveLength(2);
    expect(policies[0]!.priority).toBe(100);
    expect(policies[1]!.priority).toBe(50);
  });

  test('returns empty array for workspace with no policies', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const policies = await listPolicies('ws-empty');
    expect(policies).toEqual([]);
  });
});

describe('updatePolicy', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('updates policy fields', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makePolicyRow({ name: 'Updated', priority: 20 })],
    });

    const policy = await updatePolicy('pol-001', { name: 'Updated', priority: 20 });
    expect(policy).not.toBeNull();
    expect(policy!.name).toBe('Updated');
    expect(policy!.priority).toBe(20);
  });

  test('throws for non-existent policy', async () => {
    // No UPDATE result returned
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE returns empty

    // Since no sets are added, it calls getPolicy which returns null → throws
    // Actually with args it would try to update. Let me check the flow:
    // With {name: 'x'}, it builds SET, queries, gets empty rows → throws

    await expect(updatePolicy('non-existent', { name: 'New' })).rejects.toThrow('non-existent');
  });
});

describe('deletePolicy', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('deletes a policy', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // DELETE — doesn't throw

    await expect(deletePolicy('pol-001')).resolves.not.toThrow();
  });
});

// ─── Tests: Rule Evaluation ────────────────────────────────────────

describe('evaluatePolicies', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('default-allow when no policies match', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        makePolicyRow({
          rules_json: [
            makeRule({
              id: 'rule-1',
              condition: { environmentId: 'env-prod' },
              effect: 'deny' as const,
              priority: 10,
            }),
          ],
        }),
      ],
    });

    const result = await evaluatePolicies(
      'ws-001',
      makeSubject(),
      'execute',
      makeResource({ environmentId: 'env-staging' }),
    );

    expect(result.decision).toBe('allow');
    expect(result.matchedRules).toHaveLength(0);
  });

  test('denies when a deny rule matches via scalar condition', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        makePolicyRow({
          rules_json: [
            makeRule({
              id: 'rule-deny',
              condition: { environmentId: 'env-prod' },
              effect: 'deny' as const,
              priority: 10,
            }),
          ],
        }),
      ],
    });

    const result = await evaluatePolicies(
      'ws-001',
      makeSubject(),
      'execute',
      makeResource({ environmentId: 'env-prod' }),
    );

    expect(result.decision).toBe('deny');
    expect(result.matchedRules).toContain('rule-deny');
  });

  test('require-approval when a require-approval rule matches', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        makePolicyRow({
          rules_json: [
            makeRule({
              id: 'rule-approve',
              condition: { sideEffect: ['irreversible'] },
              effect: 'require-approval' as const,
              priority: 10,
            }),
          ],
        }),
      ],
    });

    const result = await evaluatePolicies(
      'ws-001',
      makeSubject(),
      'execute',
      makeResource({ sideEffect: 'irreversible' }),
    );

    expect(result.decision).toBe('require-approval');
  });

  test('higher priority rule wins when multiple match', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        makePolicyRow({
          rules_json: [
            makeRule({
              id: 'rule-high',
              condition: { sideEffect: ['irreversible'] },
              effect: 'deny' as const,
              priority: 100,
            }),
            makeRule({
              id: 'rule-low',
              condition: { sideEffect: ['irreversible'] },
              effect: 'allow' as const,
              priority: 10,
            }),
          ],
        }),
      ],
    });

    const result = await evaluatePolicies(
      'ws-001',
      makeSubject(),
      'execute',
      makeResource({ sideEffect: 'irreversible' }),
    );

    expect(result.decision).toBe('deny');
  });

  test('skips disabled policies', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // No enabled policies
    // DB query filters: WHERE enabled = true

    const result = await evaluatePolicies(
      'ws-001',
      makeSubject(),
      'execute',
      makeResource({ environmentId: 'env-prod' }),
    );

    expect(result.decision).toBe('allow');
  });

  test('matches array condition when value is in the list', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        makePolicyRow({
          rules_json: [
            makeRule({
              id: 'rule-1',
              condition: { method: ['DELETE', 'PATCH'] },
              effect: 'deny' as const,
              priority: 10,
            }),
          ],
        }),
      ],
    });

    const result = await evaluatePolicies(
      'ws-001',
      makeSubject(),
      'execute',
      makeResource({ method: 'DELETE' }),
    );

    expect(result.decision).toBe('deny');
  });

  test('does not match array condition when value not in list', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        makePolicyRow({
          rules_json: [
            makeRule({
              id: 'rule-1',
              condition: { method: ['DELETE', 'PATCH'] },
              effect: 'deny' as const,
              priority: 10,
            }),
          ],
        }),
      ],
    });

    const result = await evaluatePolicies(
      'ws-001',
      makeSubject(),
      'execute',
      makeResource({ method: 'GET' }),
    );

    expect(result.decision).toBe('allow');
  });

  test('empty condition matches everything', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        makePolicyRow({
          rules_json: [
            makeRule({
              id: 'catch-all',
              condition: {},
              effect: 'deny' as const,
              priority: 1,
            }),
          ],
        }),
      ],
    });

    const result = await evaluatePolicies('ws-001', makeSubject(), 'any-action', makeResource());

    expect(result.decision).toBe('deny');
  });

  test('condition fails when key not present in resource or context', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        makePolicyRow({
          rules_json: [
            makeRule({
              id: 'rule-1',
              condition: { nonexistentField: 'value' },
              effect: 'deny' as const,
              priority: 10,
            }),
          ],
        }),
      ],
    });

    const result = await evaluatePolicies('ws-001', makeSubject(), 'execute', makeResource());

    expect(result.decision).toBe('allow');
  });

  test('condition with null value in resource fails to match', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        makePolicyRow({
          rules_json: [
            makeRule({
              id: 'rule-1',
              condition: { environmentId: 'env-1' },
              effect: 'deny' as const,
              priority: 10,
            }),
          ],
        }),
      ],
    });

    const result = await evaluatePolicies(
      'ws-001',
      makeSubject(),
      'execute',
      makeResource({ environmentId: null }),
    );

    expect(result.decision).toBe('allow');
  });

  test('matches when condition key present in context', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        makePolicyRow({
          rules_json: [
            makeRule({
              id: 'rule-ctx',
              condition: { sourceIp: '10.0.0.1' },
              effect: 'deny' as const,
              priority: 10,
            }),
          ],
        }),
      ],
    });

    const result = await evaluatePolicies(
      'ws-001',
      makeSubject(),
      'execute',
      makeResource(), // sourceIp not in resource
      { sourceIp: '10.0.0.1' }, // but in context
    );

    expect(result.decision).toBe('deny');
  });
});
