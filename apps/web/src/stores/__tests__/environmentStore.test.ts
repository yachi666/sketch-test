import { beforeEach, describe, expect, test, vi } from 'vitest';
import { cpClient } from '../../lib/cp-client';
import type { Environment } from '../../types';
import { useEnvironmentStore } from '../environmentStore';

vi.mock('../../lib/cp-client', () => ({
  cpClient: {
    createEnvironment: vi.fn(),
    updateEnvironment: vi.fn(),
    deleteEnvironment: vi.fn(),
    listEnvironments: vi.fn(),
    listEnvironmentVersions: vi.fn(),
  },
}));

const serverEnvironment = {
  id: 'env-1',
  workspaceId: 'ws-1',
  name: 'Test',
  description: 'Test environment',
  createdAt: '2026-09-23T00:00:00Z',
  updatedAt: '2026-09-23T00:00:00Z',
};
function environment(id = 'env-1'): Environment {
  return {
    id,
    name: 'Test',
    description: '',
    tags: [],
    isProduction: false,
    updatedAt: '',
    updatedBy: 'Control Plane',
  };
}

describe('environmentStore', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useEnvironmentStore.setState({
      environments: [],
      activeEnvironmentId: '',
      versions: {},
      loading: false,
      error: null,
    });
  });

  test('selects an active environment', () => {
    useEnvironmentStore.getState().setActiveEnvironmentId('env-1');
    expect(useEnvironmentStore.getState().activeEnvironmentId).toBe('env-1');
  });

  test('creates through CP and prepends the persisted environment', async () => {
    useEnvironmentStore.setState({ environments: [environment('env-existing')] });
    vi.mocked(cpClient.createEnvironment).mockResolvedValue(serverEnvironment);
    const result = await useEnvironmentStore
      .getState()
      .createEnvironment('ws-1', 'Test', 'Test environment');
    expect(cpClient.createEnvironment).toHaveBeenCalledWith('ws-1', 'Test', 'Test environment');
    expect(result?.id).toBe('env-1');
    expect(useEnvironmentStore.getState().environments.map((e) => e.id)).toEqual([
      'env-1',
      'env-existing',
    ]);
    expect(useEnvironmentStore.getState().activeEnvironmentId).toBe('env-1');
  });

  test('does not create a local-only environment when CP rejects it', async () => {
    vi.mocked(cpClient.createEnvironment).mockRejectedValue(new Error('Forbidden'));
    expect(await useEnvironmentStore.getState().createEnvironment('ws-1', 'Test')).toBeNull();
    expect(useEnvironmentStore.getState().environments).toEqual([]);
    expect(useEnvironmentStore.getState().error).toBe('Forbidden');
  });

  test('updates through CP without changing other environments', async () => {
    useEnvironmentStore.setState({ environments: [environment(), environment('env-2')] });
    vi.mocked(cpClient.updateEnvironment).mockResolvedValue({
      ...serverEnvironment,
      name: 'Staging',
    });
    await useEnvironmentStore.getState().updateEnvironment('env-1', 'Staging', 'Updated');
    expect(cpClient.updateEnvironment).toHaveBeenCalledWith('env-1', {
      name: 'Staging',
      description: 'Updated',
    });
    expect(useEnvironmentStore.getState().environments.map((e) => e.name)).toEqual([
      'Staging',
      'Test',
    ]);
  });

  test('does not update locally when CP rejects the change', async () => {
    useEnvironmentStore.setState({ environments: [environment()] });
    vi.mocked(cpClient.updateEnvironment).mockRejectedValue(new Error('Forbidden'));
    expect(await useEnvironmentStore.getState().updateEnvironment('env-1', 'Changed')).toBeNull();
    expect(useEnvironmentStore.getState().environments[0]?.name).toBe('Test');
  });

  test('deletes through CP and selects the next environment', async () => {
    useEnvironmentStore.setState({
      environments: [environment(), environment('env-2')],
      activeEnvironmentId: 'env-1',
    });
    vi.mocked(cpClient.deleteEnvironment).mockResolvedValue(undefined);
    expect(await useEnvironmentStore.getState().deleteEnvironment('env-1')).toBe(true);
    expect(cpClient.deleteEnvironment).toHaveBeenCalledWith('env-1');
    expect(useEnvironmentStore.getState().environments.map((e) => e.id)).toEqual(['env-2']);
    expect(useEnvironmentStore.getState().activeEnvironmentId).toBe('env-2');
  });

  test('restores both list and active selection when deletion fails', async () => {
    useEnvironmentStore.setState({
      environments: [environment(), environment('env-2')],
      activeEnvironmentId: 'env-1',
    });
    vi.mocked(cpClient.deleteEnvironment).mockRejectedValue(new Error('Environment is in use'));
    expect(await useEnvironmentStore.getState().deleteEnvironment('env-1')).toBe(false);
    expect(useEnvironmentStore.getState().environments.map((e) => e.id)).toEqual([
      'env-1',
      'env-2',
    ]);
    expect(useEnvironmentStore.getState().activeEnvironmentId).toBe('env-1');
    expect(useEnvironmentStore.getState().error).toBe('Environment is in use');
  });

  test('clears active selection after deleting the last environment', async () => {
    useEnvironmentStore.setState({ environments: [environment()], activeEnvironmentId: 'env-1' });
    vi.mocked(cpClient.deleteEnvironment).mockResolvedValue(undefined);
    await useEnvironmentStore.getState().deleteEnvironment('env-1');
    expect(useEnvironmentStore.getState().environments).toEqual([]);
    expect(useEnvironmentStore.getState().activeEnvironmentId).toBe('');
  });

  test('loads environments and immutable versions from CP', async () => {
    const version = {
      id: 'envv-1',
      environmentId: 'env-1',
      version: 1,
      baseUrl: 'https://test.example',
      variables: { region: 'cn' },
      runnerLabels: [],
      requireApproval: false,
      createdAt: serverEnvironment.createdAt,
    };
    vi.mocked(cpClient.listEnvironments).mockResolvedValue({ environments: [serverEnvironment] });
    vi.mocked(cpClient.listEnvironmentVersions).mockResolvedValue({ versions: [version] });
    await useEnvironmentStore.getState().fetchFromServer('ws-1');
    expect(cpClient.listEnvironments).toHaveBeenCalledWith('ws-1');
    expect(useEnvironmentStore.getState().versions['env-1']).toEqual([version]);
    expect(useEnvironmentStore.getState().activeEnvironmentId).toBe('env-1');
    expect(useEnvironmentStore.getState().loading).toBe(false);
  });

  test('reports fetch errors', async () => {
    vi.mocked(cpClient.listEnvironments).mockRejectedValue(new Error('Network error'));
    await useEnvironmentStore.getState().fetchFromServer('ws-1');
    expect(useEnvironmentStore.getState().error).toBe('Network error');
    expect(useEnvironmentStore.getState().loading).toBe(false);
  });
});
