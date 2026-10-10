import { Warning } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  /** Variant for destructive actions. Shows warning icon and danger-styled buttons. */
  variant?: 'default' | 'danger';
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Reusable confirmation dialog that replaces window.confirm.
 * Supports danger variant for destructive actions, traps focus, and closes on Escape.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  variant = 'default',
  confirmLabel = '确认',
  cancelLabel = '取消',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      // Focus confirm button after a tick for animation
      const id = setTimeout(() => confirmRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open) return null;

  const isDanger = variant === 'danger';

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <section
        className="modal modal--sm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
      >
        <div className="confirm-body">
          {isDanger ? (
            <span className="confirm-icon confirm-icon--danger">
              <Warning size={28} weight="fill" />
            </span>
          ) : null}
          <h3 id="confirm-title">{title}</h3>
          <p id="confirm-message">{message}</p>
        </div>
        <div className="modal-actions">
          <button className="button button--ghost" type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            className={`button${isDanger ? ' button--danger' : ' button--primary'}`}
            type="button"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
