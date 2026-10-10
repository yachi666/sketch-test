import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { useAuthStore } from '../../stores/authStore';
import { WorkflowListView } from './WorkflowListView';

const { createWorkflow, fetchWorkflowsFromServer } = vi.hoisted(() => ({
  createWorkflow: vi.fn(),
  fetchWorkflowsFromServer: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../stores/workflowStore', () => ({
  useWorkflowStore: (selector: (state: unknown) => unknown) =>
    selector({
      cpWorkflows: [],
      loading: false,
      saving: false,
      error: null,
      fetchWorkflowsFromServer,
      createWorkflow,
    }),
}));

describe('WorkflowListView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  test('opens an in-product form instead of relying on a browser prompt', () => {
    render(<WorkflowListView />);

    fireEvent.click(screen.getByRole('button', { name: '新建流程' }));

    expect(screen.getByRole('dialog', { name: '新建流程' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '流程名称 *' })).toBeInTheDocument();
  });
});
