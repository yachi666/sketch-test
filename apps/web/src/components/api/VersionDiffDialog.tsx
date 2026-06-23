import {
  ArrowsClockwise,
  CaretDown,
  Check,
  Warning,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import { useState, useRef, useEffect } from 'react';
import type { ApiVersionDiff } from '../../types';

interface VersionDiffDialogProps {
  open: boolean;
  diff: ApiVersionDiff | null;
  onClose: () => void;
}

/**
 * Modal dialog for comparing two API versions and reviewing changes.
 * Shows breaking changes prominently with affected workflows/test cases.
 */
export function VersionDiffDialog({ open, diff, onClose }: VersionDiffDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [filter, setFilter] = useState<'all' | 'breaking' | 'added' | 'removed' | 'modified'>(
    'all',
  );

  useEffect(() => {
    if (open) closeButtonRef.current?.focus();
  }, [open]);

  if (!open || !diff) return null;

  const filtered = diff.changes.filter((c) => {
    if (filter === 'all') return true;
    if (filter === 'breaking') return c.breaking;
    return c.changeType === filter;
  });

  const changeLabel = (type: string) => {
    switch (type) {
      case 'added':
        return '新增';
      case 'removed':
        return '删除';
      case 'modified':
        return '修改';
      case 'deprecated':
        return '弃用';
      default:
        return type;
    }
  };

  const changeClass = (type: string) => {
    switch (type) {
      case 'added':
        return 'change--added';
      case 'removed':
        return 'change--removed';
      case 'modified':
        return 'change--modified';
      case 'deprecated':
        return 'change--deprecated';
      default:
        return '';
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="diff-title"
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">VERSION DIFF</span>
            <h2 id="diff-title">比较版本</h2>
          </div>
          <button
            className="icon-button"
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={20} />
          </button>
        </div>

        {/* Version selector display */}
        <div className="diff-version-row">
          <span className="diff-version-tag">{diff.baseVersionLabel}</span>
          <ArrowsClockwise size={20} />
          <span className="diff-version-tag diff-version-tag--target">
            {diff.targetVersionLabel}
          </span>
        </div>

        {/* Summary cards */}
        <div className="diff-summary-cards">
          <div className="diff-stat">
            <strong>{diff.summary.addedEndpoints}</strong>
            <span>新增接口</span>
          </div>
          <div className="diff-stat">
            <strong>{diff.summary.removedEndpoints}</strong>
            <span>删除接口</span>
          </div>
          <div className="diff-stat">
            <strong>{diff.summary.modifiedEndpoints}</strong>
            <span>修改接口</span>
          </div>
          <div
            className={`diff-stat${diff.summary.breakingChanges > 0 ? ' diff-stat--danger' : ''}`}
          >
            <strong>{diff.summary.breakingChanges}</strong>
            <span>破坏性变更</span>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="diff-filters">
          {(['all', 'breaking', 'added', 'modified', 'removed'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`filter-chip${filter === f ? ' active' : ''}${f === 'breaking' && diff.summary.breakingChanges > 0 ? ' filter-chip--danger' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all'
                ? '全部'
                : f === 'breaking'
                  ? '破坏性'
                  : f === 'added'
                    ? '新增'
                    : f === 'modified'
                      ? '修改'
                      : '删除'}
              {f === 'breaking' ? (
                <span className="chip-count">{diff.summary.breakingChanges}</span>
              ) : null}
            </button>
          ))}
        </div>

        {/* Change list */}
        <div className="diff-change-list">
          {filtered.length === 0 ? (
            <div className="empty-state">无匹配的变更项。</div>
          ) : (
            filtered.map((change, idx) => (
              <div
                key={`${change.endpointId}-${idx}`}
                className={`diff-change-item${change.breaking ? ' diff-change-item--breaking' : ''}`}
              >
                <div className="diff-change-header">
                  <span className={`change-badge ${changeClass(change.changeType)}`}>
                    {changeLabel(change.changeType)}
                  </span>
                  <code>{change.path}</code>
                  {change.breaking ? (
                    <span className="tag tag--danger">
                      <Warning size={12} weight="fill" />
                      破坏性变更
                    </span>
                  ) : null}
                </div>
                <p>{change.description}</p>
                <div className="diff-change-impact">
                  {change.affectedTestCases > 0 ? (
                    <span>
                      影响 <strong>{change.affectedTestCases}</strong> 个测试用例
                    </span>
                  ) : null}
                  {change.affectedWorkflows > 0 ? (
                    <span>
                      影响 <strong>{change.affectedWorkflows}</strong> 个业务流程
                    </span>
                  ) : null}
                  {change.affectedTestCases === 0 && change.affectedWorkflows === 0 ? (
                    <span className="no-impact">无影响</span>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="modal-actions">
          <button className="button button--ghost" type="button" onClick={onClose}>
            关闭
          </button>
        </div>
      </section>
    </div>
  );
}
