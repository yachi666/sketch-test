import { useEffect, useRef } from 'react';
import { useEnvironmentStore } from '../../stores/environmentStore';
import { useUIStore } from '../../stores/uiStore';
import type { Environment } from '../../types';

export function DeleteEnvironmentDialog({
  open,
  environment,
  onClose,
}: {
  open: boolean;
  environment: Environment | null;
  onClose: () => void;
}) {
  const deleteEnvironment = useEnvironmentStore((s) => s.deleteEnvironment);
  const notify = useUIStore((s) => s.notify);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open && cancelRef.current) cancelRef.current.focus();
  }, [open]);

  if (!open || !environment) return null;

  const handleConfirm = async () => {
    if (!(await deleteEnvironment(environment.id))) return;
    notify(`环境 "${environment.name}" 已删除`);
    onClose();
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-label="删除环境"
        style={{ maxWidth: '420px' }}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">DELETE ENVIRONMENT</span>
            <h2>删除环境</h2>
          </div>
        </div>
        <div className="modal-body">
          <p>
            确定要删除环境 <strong>{environment.name}</strong>{' '}
            吗？此操作不可撤销，关联的变量覆盖值也将被清除。
          </p>
        </div>
        <div className="modal-actions">
          <button ref={cancelRef} className="button button--ghost" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="button button--danger"
            type="button"
            onClick={() => void handleConfirm()}
          >
            确认删除
          </button>
        </div>
      </section>
    </div>
  );
}
