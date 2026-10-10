import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useWorkflowStore } from '../../stores/workflowStore';
import { WorkflowListView } from './WorkflowListView';
import { WorkflowWorkspace } from './WorkflowWorkspace';

export default function WorkflowsPage() {
  const { id } = useParams<{ id?: string }>();
  const activeWorkflowId = useWorkflowStore((s) => s.activeWorkflowId);
  const openWorkflow = useWorkflowStore((s) => s.openWorkflow);
  const backToList = useWorkflowStore((s) => s.backToList);

  useEffect(() => {
    if (id) {
      openWorkflow(id);
    } else {
      backToList();
    }
  }, [id, openWorkflow, backToList]);

  if (activeWorkflowId) {
    return <WorkflowWorkspace />;
  }

  return <WorkflowListView />;
}
