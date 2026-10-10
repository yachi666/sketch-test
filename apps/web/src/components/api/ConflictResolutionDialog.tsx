import { useCallback, useEffect, useRef, useState } from 'react';

export interface EndpointConflict {
  endpointId: string; // e.g. 'GET-/api/users'
  existing: {
    summary: string;
    sourceType: string; // e.g. 'openapi'
    versionLabel: string;
  };
  incoming: {
    summary: string;
    sourceLabel: string; // e.g. 'postman-collection.json'
  };
}

export type ConflictResolution = 'skip' | 'replace' | 'keep-both' | 'merge';

interface ConflictResolutionDialogProps {
  open: boolean;
  conflicts: EndpointConflict[];
  onResolve: (resolutions: Map<string, ConflictResolution>) => void;
  onClose: () => void;
}

const RESOLUTION_OPTIONS: { value: ConflictResolution; label: string }[] = [
  { value: 'skip', label: '跳过' },
  { value: 'replace', label: '覆盖' },
  { value: 'keep-both', label: '保留两者' },
  { value: 'merge', label: '合并' },
];

const BULK_ACTIONS: { label: string; value: ConflictResolution }[] = [
  { label: '跳过所有', value: 'skip' },
  { label: '覆盖所有', value: 'replace' },
  { label: '保留所有', value: 'keep-both' },
];

/**
 * Modal dialog that displays endpoint conflicts detected during import.
 * Each conflict row shows a checkbox, endpoint identifier, existing summary,
 * and incoming summary with a per-row resolution dropdown.
 * Bulk action buttons let the user apply the same resolution to all rows.
 */
export function ConflictResolutionDialog({
  open,
  conflicts,
  onResolve,
  onClose,
}: ConflictResolutionDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // Map<endpointId, ConflictResolution> — initialised with 'skip' for all
  const [resolutions, setResolutions] = useState<Map<string, ConflictResolution>>(
    () => new Map(conflicts.map((c) => [c.endpointId, 'skip'])),
  );
  // Track which rows are selected (for visual confirmation)
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(conflicts.map((c) => c.endpointId)),
  );

  useEffect(() => {
    if (open) {
      closeButtonRef.current?.focus();
      setResolutions(new Map(conflicts.map((c) => [c.endpointId, 'skip'])));
      setSelected(new Set(conflicts.map((c) => c.endpointId)));
    }
  }, [open, conflicts]);

  const handleBulkAction = useCallback(
    (resolution: ConflictResolution) => {
      const next = new Map(resolutions);
      for (const conflict of conflicts) {
        next.set(conflict.endpointId, resolution);
      }
      setResolutions(next);
    },
    [conflicts, resolutions],
  );

  const handleRowResolutionChange = useCallback(
    (endpointId: string, resolution: ConflictResolution) => {
      setResolutions((prev) => {
        const next = new Map(prev);
        next.set(endpointId, resolution);
        return next;
      });
    },
    [],
  );

  const toggleSelected = useCallback((endpointId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(endpointId)) {
        next.delete(endpointId);
      } else {
        next.add(endpointId);
      }
      return next;
    });
  }, []);

  const handleSubmit = useCallback(() => {
    onResolve(resolutions);
    onClose();
  }, [resolutions, onResolve, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="modal modal--wide conflict-resolution-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-title"
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">CONFLICT DETECTION</span>
            <h2 id="conflict-title">检测到 {conflicts.length} 个端点冲突</h2>
          </div>
          <button
            className="icon-button"
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {/* Bulk action buttons */}
        <div className="conflict-bulk-actions">
          {BULK_ACTIONS.map((action) => (
            <button
              key={action.value}
              type="button"
              className="button button--sm button--outline"
              onClick={() => handleBulkAction(action.value)}
            >
              {action.label}
            </button>
          ))}
        </div>

        {/* Conflict table */}
        <div className="conflict-table-wrap">
          <table className="conflict-table">
            <thead>
              <tr>
                <th className="conflict-col-check" />
                <th className="conflict-col-endpoint">接口</th>
                <th className="conflict-col-existing">已有</th>
                <th className="conflict-col-incoming">导入</th>
                <th className="conflict-col-action">操作</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map((conflict) => {
                const resolution = resolutions.get(conflict.endpointId) ?? 'skip';
                const isSelected = selected.has(conflict.endpointId);
                return (
                  <tr
                    key={conflict.endpointId}
                    className={`conflict-row${isSelected ? ' conflict-row--selected' : ''}`}
                  >
                    <td className="conflict-col-check">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelected(conflict.endpointId)}
                        aria-label={`选择 ${conflict.endpointId}`}
                      />
                    </td>
                    <td className="conflict-col-endpoint">
                      <code>{conflict.endpointId}</code>
                    </td>
                    <td className="conflict-col-existing">
                      <span className="conflict-summary">{conflict.existing.summary}</span>
                      <span className="conflict-source">
                        {conflict.existing.sourceType} · {conflict.existing.versionLabel}
                      </span>
                    </td>
                    <td className="conflict-col-incoming">
                      <span className="conflict-summary">{conflict.incoming.summary}</span>
                      <span className="conflict-source">{conflict.incoming.sourceLabel}</span>
                    </td>
                    <td className="conflict-col-action">
                      <select
                        className="conflict-select"
                        value={resolution}
                        onChange={(e) =>
                          handleRowResolutionChange(
                            conflict.endpointId,
                            e.target.value as ConflictResolution,
                          )
                        }
                        aria-label={`冲突处理方式: ${conflict.endpointId}`}
                      >
                        {RESOLUTION_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="modal-actions">
          <button className="button button--ghost" type="button" onClick={onClose}>
            取消
          </button>
          <button className="button button--primary" type="button" onClick={handleSubmit}>
            应用选择
          </button>
        </div>
      </section>
    </div>
  );
}
