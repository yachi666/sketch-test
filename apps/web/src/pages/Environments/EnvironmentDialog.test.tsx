import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { cpClient } from '../../lib/cp-client';
import { useAuthStore } from '../../stores/authStore';
import { useEnvironmentStore } from '../../stores/environmentStore';
import { EnvironmentDialog } from './EnvironmentDialog';

vi.mock('../../lib/cp-client', () => ({
  cpClient: { createEnvironmentVersion: vi.fn() },
}));

vi.mock('../../stores/uiStore', () => ({
  useUIStore: () => vi.fn(),
}));

describe('EnvironmentDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEnvironmentStore.setState({
      versions: {},
      createEnvironment: vi.fn(),
      updateEnvironment: vi.fn(),
      fetchFromServer: vi.fn().mockResolvedValue(undefined),
    });
    useAuthStore.setState({
      token: 'test-token',
      hydrated: true,
      user: {
        id: 'usr-owner',
        email: 'owner@example.test',
        displayName: 'Owner',
        role: 'owner',
        workspaceId: 'ws-primary',
      },
    });
  });

  test('only exposes fields persisted by the Control Plane contract', () => {
    render(<EnvironmentDialog open mode="create" environment={null} onClose={vi.fn()} />);

    expect(screen.getByRole('textbox', { name: '环境名称 *' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '描述' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '环境基础地址' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '环境变量' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '标签（逗号分隔）' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: '生产环境' })).not.toBeInTheDocument();
  });

  test('saves a new version while preserving approval and Runner restrictions', async () => {
    const environment = {
      id: 'env-a',
      name: 'Staging',
      description: '',
      tags: [],
      isProduction: false,
      updatedAt: '',
      updatedBy: '',
    };
    const version = {
      id: 'envv-a',
      environmentId: 'env-a',
      version: 1,
      baseUrl: 'https://old.example.test',
      variables: { region: 'cn' },
      runnerLabels: ['private-network'],
      requireApproval: true,
      createdAt: '',
      createdBy: 'usr-owner',
    };
    useEnvironmentStore.setState({
      versions: { 'env-a': [version] },
      updateEnvironment: vi.fn().mockResolvedValue(environment),
    });
    const onClose = vi.fn();
    render(<EnvironmentDialog open mode="edit" environment={environment} onClose={onClose} />);
    fireEvent.change(screen.getByRole('textbox', { name: '环境基础地址' }), {
      target: { value: 'https://new.example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存更改' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(cpClient.createEnvironmentVersion).toHaveBeenCalledWith('env-a', {
      baseUrl: 'https://new.example.test',
      variables: { region: 'cn' },
      runnerLabels: ['private-network'],
      requireApproval: true,
    });
    expect(version.baseUrl).toBe('https://old.example.test');
  });
});
