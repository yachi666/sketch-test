/**
 * variableStore unit tests.
 *
 * Tests variable CRUD and CP secret fetching.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

// ─── Mock cpClient ─────────────────────────────────────────────────

const { mockListSecrets } = vi.hoisted(() => ({
  mockListSecrets: vi.fn(),
}));

vi.mock('../../lib/cp-client', () => ({
  cpClient: {
    listSecrets: (...args: unknown[]) => mockListSecrets(...args),
  },
}));

// ─── Mock storage lib ──────────────────────────────────────────────

const { mockLsGetJSON, mockLsSetJSON } = vi.hoisted(() => ({
  mockLsGetJSON: vi.fn(),
  mockLsSetJSON: vi.fn(),
}));

vi.mock('../../lib/storage', () => ({
  lsGetJSON: (...args: unknown[]) => mockLsGetJSON(...args),
  lsSetJSON: (...args: unknown[]) => mockLsSetJSON(...args),
  LS_VARIABLES_KEY: 'sketchtest.variables:v1',
}));

import type { Variable } from '../../types';
import { useVariableStore } from '../variableStore';

// ─── Helpers ───────────────────────────────────────────────────────

function makeVariable(overrides: Partial<Variable> = {}): Variable {
  return {
    id: 'var-001',
    name: 'baseUrl',
    type: 'plain' as const,
    scope: 'environment' as const,
    defaultValue: 'http://localhost:3000',
    sensitive: false,
    description: 'Base URL for API',
    tags: [],
    overrides: {},
    updatedAt: '2026-01-01T00:00:00Z',
    updatedBy: 'test',
    usedIn: [],
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('variableStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLsGetJSON.mockReturnValue([]);

    useVariableStore.setState({
      variables: [],
      secrets: [],
      loading: false,
      error: null,
    } as any);
  });

  describe('setVariables', () => {
    test('replaces all variables', () => {
      const vars = [makeVariable({ id: 'v1' }), makeVariable({ id: 'v2' })];
      useVariableStore.getState().setVariables(vars);
      expect(useVariableStore.getState().variables).toHaveLength(2);
    });
  });

  describe('createVariable', () => {
    test('prepends new variable', () => {
      useVariableStore.setState({
        variables: [makeVariable({ id: 'existing', name: 'Existing' })],
      } as any);

      useVariableStore.getState().createVariable(makeVariable({ id: 'new', name: 'New Var' }));

      const variables = useVariableStore.getState().variables;
      expect(variables).toHaveLength(2);
      expect(variables[0]!.name).toBe('New Var');
    });
  });

  describe('updateVariable', () => {
    test('updates an existing variable', () => {
      useVariableStore.setState({
        variables: [
          makeVariable({ id: 'var-1', name: 'Old Name', defaultValue: 'old' }),
          makeVariable({ id: 'var-2', name: 'Keep' }),
        ],
      } as any);

      useVariableStore
        .getState()
        .updateVariable(makeVariable({ id: 'var-1', name: 'New Name', defaultValue: 'new' }));

      expect(useVariableStore.getState().variables[0]!.name).toBe('New Name');
      expect(useVariableStore.getState().variables[1]!.name).toBe('Keep');
    });
  });

  describe('deleteVariable', () => {
    test('removes variable by ID', () => {
      useVariableStore.setState({
        variables: [
          makeVariable({ id: 'keep' }),
          makeVariable({ id: 'delete-me' }),
          makeVariable({ id: 'also-keep' }),
        ],
      } as any);

      useVariableStore.getState().deleteVariable('delete-me');

      const variables = useVariableStore.getState().variables;
      expect(variables).toHaveLength(2);
      expect(variables.map((v) => v.id)).toEqual(['keep', 'also-keep']);
    });

    test('handles deleting from empty list', () => {
      useVariableStore.getState().deleteVariable('any');
      expect(useVariableStore.getState().variables).toEqual([]);
    });
  });

  describe('secrets', () => {
    test('initially empty secrets array', () => {
      expect(useVariableStore.getState().secrets).toEqual([]);
    });

    test('fetchSecretsFromServer sets secrets on success', async () => {
      const mockSecrets = [
        {
          id: 'sec-001',
          name: 'API_KEY',
          description: 'External API key',
          workspaceId: 'ws-001',
          createdAt: '2026-06-24T10:00:00Z',
        },
      ];
      mockListSecrets.mockResolvedValue({ secrets: mockSecrets });

      await useVariableStore.getState().fetchSecretsFromServer('ws-001');

      const state = useVariableStore.getState();
      expect(state.secrets).toEqual(mockSecrets);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
    });

    test('fetchSecretsFromServer sets error on failure', async () => {
      mockListSecrets.mockRejectedValue(new Error('Forbidden'));

      await useVariableStore.getState().fetchSecretsFromServer('ws-001');

      const state = useVariableStore.getState();
      expect(state.error).toContain('Forbidden');
      expect(state.loading).toBe(false);
    });
  });

  describe('variable properties', () => {
    test('secret variable type is supported', () => {
      const secretVar = makeVariable({
        id: 'sec-var',
        name: 'password',
        type: 'secret',
        sensitive: true,
        defaultValue: '',
      });
      useVariableStore.getState().createVariable(secretVar);

      expect(useVariableStore.getState().variables[0]!.sensitive).toBe(true);
      expect(useVariableStore.getState().variables[0]!.type).toBe('secret');
    });

    test('tags are preserved', () => {
      const tagged = makeVariable({
        id: 'tagged',
        tags: ['auth', 'production', 'sensitive'],
      });
      useVariableStore.getState().createVariable(tagged);

      expect(useVariableStore.getState().variables[0]!.tags).toEqual([
        'auth',
        'production',
        'sensitive',
      ]);
    });
  });
});
