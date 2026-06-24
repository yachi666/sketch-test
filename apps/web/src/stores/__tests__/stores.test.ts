/**
 * Web store unit tests.
 *
 * Tests core state transitions without network dependencies.
 * Uses vi.mock to isolate stores from their API clients.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// ─── Mock cpClient before importing stores ─────────────────────────

const mockLogin = vi.fn();
const mockGetMe = vi.fn();

vi.mock('../../lib/cp-client', () => ({
  cpClient: {
    login: (...args: unknown[]) => mockLogin(...args),
    getMe: (...args: unknown[]) => mockGetMe(...args),
  },
}));

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// ─── Auth Store ──────────────────────────────────────────────────────

import { useAuthStore } from '../authStore';

describe('authStore', () => {
  beforeEach(() => {
    localStorageMock.clear();
    mockLogin.mockReset();
    mockGetMe.mockReset();
    useAuthStore.setState({ user: null, token: null, loading: false, error: null });
  });

  test('initial state is unauthenticated', () => {
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  test('isAuthenticated returns false when no user/token', () => {
    expect(useAuthStore.getState().isAuthenticated()).toBe(false);
  });

  test('isAuthenticated returns true when user and token exist', () => {
    useAuthStore.setState({
      user: { id: 'u1', name: 'Test', email: 'test@test.com', role: 'editor' },
      token: 'tok-123',
    });
    expect(useAuthStore.getState().isAuthenticated()).toBe(true);
  });

  test('isAuthenticated returns false when only token exists (no user)', () => {
    useAuthStore.setState({ token: 'tok-123', user: null });
    expect(useAuthStore.getState().isAuthenticated()).toBe(false);
  });

  test('logout clears user, token, and localStorage', () => {
    useAuthStore.setState({
      user: { id: 'u1', name: 'Test', email: 'test@test.com', role: 'editor' },
      token: 'tok-123',
    });
    useAuthStore.getState().logout();
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.token).toBeNull();
    expect(localStorageMock.removeItem).toHaveBeenCalled();
  });

  test('login sets loading=true during request', async () => {
    mockLogin.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));
    const loginPromise = useAuthStore.getState().login('a@b.com', 'pw');
    expect(useAuthStore.getState().loading).toBe(true);
    expect(useAuthStore.getState().error).toBeNull();
  });

  test('login on success sets user and token', async () => {
    const mockUser = { id: 'u1', name: 'Alice', email: 'alice@test.com', role: 'editor' as const };
    mockLogin.mockResolvedValue({ user: mockUser, token: 'tok-success' });

    await useAuthStore.getState().login('alice@test.com', 'password');

    const state = useAuthStore.getState();
    expect(state.user).toEqual(mockUser);
    expect(state.token).toBe('tok-success');
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      expect.stringContaining('auth-token'),
      'tok-success',
    );
  });

  test('login on failure sets error and re-throws', async () => {
    mockLogin.mockRejectedValue(new Error('Invalid credentials'));

    await expect(useAuthStore.getState().login('bad@test.com', 'wrong')).rejects.toThrow(
      'Invalid credentials',
    );

    const state = useAuthStore.getState();
    expect(state.error).toBe('Error: Invalid credentials');
    expect(state.user).toBeNull();
    expect(state.token).toBeNull();
    expect(state.loading).toBe(false);
  });

  test('restoreSession with valid token fetches user', async () => {
    useAuthStore.setState({ token: 'stored-token' });
    const mockUser = { id: 'u2', name: 'Bob', email: 'bob@test.com', role: 'viewer' as const };
    mockGetMe.mockResolvedValue(mockUser);

    await useAuthStore.getState().restoreSession();

    const state = useAuthStore.getState();
    expect(state.user).toEqual(mockUser);
    expect(state.loading).toBe(false);
    expect(mockGetMe).toHaveBeenCalledWith('stored-token');
  });

  test('restoreSession with invalid token clears session', async () => {
    useAuthStore.setState({ token: 'expired-token' });
    mockGetMe.mockRejectedValue(new Error('Unauthorized'));

    await useAuthStore.getState().restoreSession();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.token).toBeNull();
    expect(state.loading).toBe(false);
    expect(localStorageMock.removeItem).toHaveBeenCalled();
  });

  test('restoreSession does nothing when no token', async () => {
    const stateBefore = useAuthStore.getState();
    await useAuthStore.getState().restoreSession();
    expect(mockGetMe).not.toHaveBeenCalled();
    expect(useAuthStore.getState()).toEqual(stateBefore);
  });
});

// ─── Variable Store ──────────────────────────────────────────────────

import { useVariableStore } from '../variableStore';
import type { Variable } from '../../types';

function makeVar(overrides: Partial<Variable> = {}): Variable {
  return {
    id: 'var-001',
    name: 'testVar',
    defaultValue: 'val1',
    overrides: {},
    type: 'plain',
    scope: 'environment',
    tags: [],
    sensitive: false,
    description: '',
    updatedAt: new Date().toISOString(),
    updatedBy: 'test',
    usedIn: [],
    ...overrides,
  };
}

describe('variableStore', () => {
  beforeEach(() => {
    // Reset localStorage before each test to avoid fixture auto-load
    localStorageMock.clear();
    localStorageMock.getItem.mockReturnValue(null);
    useVariableStore.setState({ variables: [], loading: false, error: null });
  });

  test('createVariable inserts a new variable', () => {
    useVariableStore
      .getState()
      .createVariable(makeVar({ name: 'baseUrl', defaultValue: 'https://api.example.com' }));
    const vars = useVariableStore.getState().variables;
    expect(vars).toHaveLength(1);
    expect(vars[0]!.name).toBe('baseUrl');
    expect(vars[0]!.defaultValue).toBe('https://api.example.com');
  });

  test('updateVariable modifies an existing variable', () => {
    useVariableStore
      .getState()
      .createVariable(makeVar({ id: 'v1', name: 'oldName', defaultValue: 'oldValue' }));
    useVariableStore
      .getState()
      .updateVariable(makeVar({ id: 'v1', name: 'newName', defaultValue: 'newValue' }));

    const updated = useVariableStore.getState().variables[0]!;
    expect(updated.name).toBe('newName');
    expect(updated.defaultValue).toBe('newValue');
  });

  test('deleteVariable removes a variable', () => {
    useVariableStore.getState().createVariable(makeVar({ id: 'toDelete' }));
    useVariableStore.getState().deleteVariable('toDelete');
    expect(useVariableStore.getState().variables).toHaveLength(0);
  });

  test('deleteVariable does nothing for non-existent id', () => {
    useVariableStore.getState().createVariable(makeVar({ id: 'keep' }));
    useVariableStore.getState().deleteVariable('non-existent');
    expect(useVariableStore.getState().variables).toHaveLength(1);
  });

  test('sensitive variables preserve type and sensitive flag', () => {
    useVariableStore
      .getState()
      .createVariable(makeVar({ id: 'apiKey', name: 'apiKey', type: 'secret', sensitive: true }));
    expect(useVariableStore.getState().variables[0]!.sensitive).toBe(true);
    expect(useVariableStore.getState().variables[0]!.type).toBe('secret');
  });
});

// ─── Environment Store ───────────────────────────────────────────────

import { useEnvironmentStore } from '../environmentStore';
import type { Environment } from '../../types';

function makeEnv(overrides: Partial<Environment> = {}): Environment {
  return {
    id: 'env-001',
    name: 'Default',
    description: '',
    tags: [],
    isProduction: false,
    updatedAt: new Date().toISOString(),
    updatedBy: 'test',
    ...overrides,
  };
}

describe('environmentStore', () => {
  beforeEach(() => {
    localStorageMock.clear();
    localStorageMock.getItem.mockReturnValue(null);
    useEnvironmentStore.setState({
      environments: [],
      activeEnvironmentId: '',
      loading: false,
      error: null,
    });
  });

  test('createEnvironment creates new environment', () => {
    useEnvironmentStore
      .getState()
      .createEnvironment(makeEnv({ name: 'Staging', description: 'Staging env' }));
    const envs = useEnvironmentStore.getState().environments;
    expect(envs).toHaveLength(1);
    expect(envs[0]!.name).toBe('Staging');
  });

  test('updateEnvironment modifies existing environment', () => {
    useEnvironmentStore.getState().createEnvironment(makeEnv({ id: 'env-1', name: 'Dev' }));
    useEnvironmentStore.getState().updateEnvironment(makeEnv({ id: 'env-1', name: 'Development' }));

    const updated = useEnvironmentStore.getState().environments[0]!;
    expect(updated.name).toBe('Development');
  });

  test('deleteEnvironment removes environment', () => {
    useEnvironmentStore.getState().createEnvironment(makeEnv({ id: 'temp' }));
    useEnvironmentStore.getState().deleteEnvironment('temp');
    expect(useEnvironmentStore.getState().environments).toHaveLength(0);
  });

  test('setActiveEnvironmentId changes active environment', () => {
    useEnvironmentStore.getState().setActiveEnvironmentId('env-prod');
    expect(useEnvironmentStore.getState().activeEnvironmentId).toBe('env-prod');
  });

  test('multiple environments can coexist', () => {
    useEnvironmentStore.getState().createEnvironment(makeEnv({ id: 'a', name: 'A' }));
    useEnvironmentStore.getState().createEnvironment(makeEnv({ id: 'b', name: 'B' }));
    useEnvironmentStore.getState().createEnvironment(makeEnv({ id: 'c', name: 'C' }));
    expect(useEnvironmentStore.getState().environments).toHaveLength(3);
  });

  test('isProduction flag is preserved', () => {
    useEnvironmentStore.getState().createEnvironment(makeEnv({ id: 'prod', isProduction: true }));
    expect(useEnvironmentStore.getState().environments[0]!.isProduction).toBe(true);
  });
});

// ─── Workflow Store ──────────────────────────────────────────────────

import { useWorkflowStore } from '../workflowStore';
import type { WorkflowStep } from '../../types';

function makeWfStep(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    id: 'ws-001',
    method: 'GET',
    url: '/api/test',
    headers: {},
    body: undefined,
    assertions: [],
    extractions: [],
    ...overrides,
  };
}

describe('workflowStore', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      activeWorkflowId: null,
      steps: [],
      selectedId: '',
      logs: [],
      runState: { status: 'idle' },
      runningRef: { current: false },
      currentRunId: null,
      cpWorkflows: [],
      loading: false,
      error: null,
    });
  });

  test('setSteps replaces all steps', () => {
    const newSteps: WorkflowStep[] = [
      makeWfStep({ id: 's1', method: 'GET', url: '/api/a' }),
      makeWfStep({ id: 's2', method: 'POST', url: '/api/b' }),
    ];
    useWorkflowStore.getState().setSteps(newSteps);

    expect(useWorkflowStore.getState().steps).toHaveLength(2);
    expect(useWorkflowStore.getState().steps[0]!.method).toBe('GET');
    expect(useWorkflowStore.getState().steps[1]!.method).toBe('POST');
  });

  test('setSteps with updater function modifies existing steps', () => {
    useWorkflowStore
      .getState()
      .setSteps([makeWfStep({ id: 's1', url: '/api/a' }), makeWfStep({ id: 's2', url: '/api/b' })]);

    useWorkflowStore
      .getState()
      .setSteps((prev) => prev.map((s) => (s.id === 's1' ? { ...s, url: '/api/updated' } : s)));

    expect(useWorkflowStore.getState().steps[0]!.url).toBe('/api/updated');
    expect(useWorkflowStore.getState().steps[1]!.url).toBe('/api/b');
  });

  test('setActiveWorkflowId changes current workflow', () => {
    useWorkflowStore.getState().setActiveWorkflowId('wf-abc');
    expect(useWorkflowStore.getState().activeWorkflowId).toBe('wf-abc');
  });

  test('setActiveWorkflowId clears to null', () => {
    useWorkflowStore.getState().setActiveWorkflowId('wf-abc');
    useWorkflowStore.getState().setActiveWorkflowId(null);
    expect(useWorkflowStore.getState().activeWorkflowId).toBeNull();
  });

  test('setRunState changes execution state', () => {
    useWorkflowStore.getState().setRunState({ status: 'running' });
    expect(useWorkflowStore.getState().runState.status).toBe('running');

    useWorkflowStore.getState().setRunState({ status: 'completed', result: 'passed' });
    expect(useWorkflowStore.getState().runState.status).toBe('completed');
    expect(useWorkflowStore.getState().runState.result).toBe('passed');
  });

  test('clear steps by setting empty array', () => {
    useWorkflowStore.getState().setSteps([makeWfStep()]);
    expect(useWorkflowStore.getState().steps).toHaveLength(1);

    useWorkflowStore.getState().setSteps([]);
    expect(useWorkflowStore.getState().steps).toHaveLength(0);
  });
});
