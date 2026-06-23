import { FloppyDisk, Plus, ShieldCheck, Tag, Trash, Warning, X } from '@phosphor-icons/react';
import type { HttpMethod } from '@sketch-test/contracts-common';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EndpointDetail, SchemaDisplayNode } from '../../../types';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import { MethodBadge } from '../../shared/MethodBadge';
import { ParameterEditor } from './ParameterEditor';
import { ParameterTable } from './ParameterTable';
import { RequestBodyEditor } from './RequestBodyEditor';
import { RequestBodyView } from './RequestBodyView';
import { ResponseEditor } from './ResponseEditor';
import { ResponseList } from './ResponseList';
import { SchemaTab } from './SchemaTab';
import { TagInput } from './TagInput';

export type PanelMode = 'view' | 'edit' | 'create';

interface EndpointDetailPanelProps {
  /** The endpoint detail to display. For create mode, this is a partial template. */
  detail: EndpointDetail;
  mode: PanelMode;
  /** Schema registry for resolving schemaRefs. */
  schemas: Record<string, SchemaDisplayNode>;
  /** All existing endpoint IDs (for validating uniqueness in create mode). */
  existingIds?: string[];
  /** Called when user saves edits (edit mode) or creates a new endpoint (create mode). */
  onSave: (detail: EndpointDetail) => void;
  /** Called when user deletes this endpoint (edit mode only). */
  onDelete?: (endpointId: string) => void;
  /** Called when user wants to add this endpoint to a workflow. */
  onAddToWorkflow?: (endpointId: string) => void;
  /** Called when user creates a new schema (e.g., from JSON body paste). */
  onCreateSchema?: (schema: SchemaDisplayNode) => void;
  onClose: () => void;
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

function isHttpMethod(value: string): value is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(value);
}

/**
 * Endpoint detail panel with three modes:
 * - view: read-only display of all endpoint information
 * - edit: inline editing of metadata, parameters, request bodies, responses
 * - create: same as edit but for a new endpoint
 *
 * Schemas remain read-only (they come from imported OpenAPI specs).
 */
export function EndpointDetailPanel({
  detail: initialDetail,
  mode,
  schemas,
  existingIds: _existingIds,
  onSave,
  onDelete,
  onAddToWorkflow,
  onCreateSchema,
  onClose,
}: EndpointDetailPanelProps) {
  const [tab, setTab] = useState<'params' | 'request' | 'responses' | 'schema'>('params');
  const [draft, setDraft] = useState<EndpointDetail>(structuredClone(initialDetail));
  const [hasChanges, setHasChanges] = useState(false);
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    variant: 'default' | 'danger';
    onConfirm: () => void;
  } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  const isEditing = mode === 'edit' || mode === 'create';

  // Reset draft when detail changes
  useEffect(() => {
    setDraft(structuredClone(initialDetail));
    setHasChanges(false);
  }, [initialDetail]);

  // Auto-focus first input in edit/create mode
  useEffect(() => {
    if (isEditing && firstInputRef.current) {
      firstInputRef.current.focus();
    }
  }, [isEditing, mode]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when confirm dialog is open
      if (confirmState) return;

      if (e.key === 'Escape') {
        if (isEditing && hasChanges) {
          setConfirmState({
            title: '放弃更改',
            message: '有未保存的更改，确定要关闭吗？',
            variant: 'danger',
            onConfirm: () => {
              setConfirmState(null);
              onClose();
            },
          });
          return;
        }
        onClose();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (isEditing && hasChanges) {
          onSave(draft);
          setHasChanges(false);
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, onSave, isEditing, hasChanges, draft, confirmState]);

  const updateDraft = useCallback((patch: Partial<EndpointDetail>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setHasChanges(true);
  }, []);

  const handleSave = () => {
    onSave(draft);
    setHasChanges(false);
  };

  const handleDeleteRequest = () => {
    setConfirmState({
      title: '删除接口',
      message: `确定要删除接口 ${draft.method} ${draft.path} 吗？此操作不可撤销。`,
      variant: 'danger',
      onConfirm: () => {
        setConfirmState(null);
        onDelete?.(draft.endpointId);
        onClose();
      },
    });
  };

  const responseSchema = draft.responses.find((r) => r.statusCode >= 200 && r.statusCode < 300);
  const requestBody = draft.requestBodies[0];

  const titleText = mode === 'create' ? '新建接口' : mode === 'edit' ? '编辑接口' : '接口详情';
  const saveLabel = mode === 'create' ? '创建' : '保存';

  return (
    <>
      <div
        className="endpoint-detail-overlay"
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && !hasChanges) onClose();
        }}
      >
        <aside
          ref={panelRef}
          className={`endpoint-detail-panel${isEditing ? ' endpoint-detail-panel--editing' : ''}`}
          aria-label={titleText}
        >
          {/* Header */}
          <div className="endpoint-detail-header">
            <div className="endpoint-detail-header-main">
              {/* Method + Path row */}
              <div className="endpoint-detail-method">
                {isEditing ? (
                  <>
                    <select
                      className="input input--method"
                      value={draft.method}
                      onChange={(e) =>
                        updateDraft({
                          method: isHttpMethod(e.target.value) ? e.target.value : 'GET',
                        })
                      }
                      aria-label="HTTP 方法"
                    >
                      {HTTP_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <span className="detail-separator">/</span>
                    <input
                      ref={firstInputRef}
                      className="input input--path"
                      value={draft.path}
                      onChange={(e) => updateDraft({ path: e.target.value })}
                      placeholder="/api/resource/{id}"
                      aria-label="接口路径"
                    />
                  </>
                ) : (
                  <>
                    <MethodBadge method={draft.method} />
                    {draft.deprecated ? (
                      <span className="tag tag--warning">
                        <Warning size={12} />
                        已弃用
                      </span>
                    ) : null}
                  </>
                )}
              </div>

              {/* Path display (view mode) */}
              {!isEditing ? <code className="endpoint-detail-path">{draft.path}</code> : null}

              {/* Summary */}
              {isEditing ? (
                <input
                  className="input input--summary"
                  value={draft.summary}
                  onChange={(e) => updateDraft({ summary: e.target.value })}
                  placeholder="接口摘要（如：创建用户）"
                  aria-label="接口摘要"
                />
              ) : (
                <h3>{draft.summary}</h3>
              )}

              {/* Description */}
              {isEditing ? (
                <textarea
                  className="input input--desc"
                  value={draft.description ?? ''}
                  onChange={(e) => updateDraft({ description: e.target.value || undefined })}
                  placeholder="接口描述（可选）"
                  rows={2}
                  aria-label="接口描述"
                />
              ) : draft.description ? (
                <p>{draft.description}</p>
              ) : null}

              {/* Tags */}
              <div className="endpoint-detail-tags">
                {draft.tags.map((tag) => (
                  <span key={tag} className="tag">
                    <Tag size={12} />
                    {tag}
                    {isEditing ? (
                      <button
                        className="tag-remove"
                        type="button"
                        onClick={() => updateDraft({ tags: draft.tags.filter((t) => t !== tag) })}
                        aria-label={`移除标签 ${tag}`}
                      >
                        <X size={10} weight="bold" />
                      </button>
                    ) : null}
                  </span>
                ))}
                {isEditing ? (
                  <TagInput
                    existing={draft.tags}
                    onAdd={(tag) => updateDraft({ tags: [...draft.tags, tag] })}
                  />
                ) : null}
                {draft.security?.length && !isEditing ? (
                  <span className="tag tag--secure">
                    <ShieldCheck size={12} />
                    需认证
                  </span>
                ) : null}
              </div>

              {/* Deprecated toggle (edit mode) */}
              {isEditing ? (
                <label className="detail-checkbox">
                  <input
                    type="checkbox"
                    checked={draft.deprecated}
                    onChange={(e) => updateDraft({ deprecated: e.target.checked })}
                  />
                  标记为已弃用
                </label>
              ) : null}
            </div>

            {/* Header actions */}
            <div className="endpoint-detail-header-actions">
              {mode === 'view' ? (
                onAddToWorkflow ? (
                  <button
                    className="button button--primary button--sm"
                    type="button"
                    onClick={() => onAddToWorkflow(draft.endpointId)}
                  >
                    <Plus size={16} />
                    加入流程
                  </button>
                ) : null
              ) : (
                <button
                  className="button button--primary button--sm"
                  type="button"
                  disabled={!draft.method || !draft.path || !draft.summary}
                  onClick={handleSave}
                >
                  <FloppyDisk size={16} />
                  {saveLabel}
                </button>
              )}
              <button className="icon-button" type="button" onClick={onClose} aria-label="关闭面板">
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="endpoint-detail-tabs">
            {(['params', 'request', 'responses', 'schema'] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={`endpoint-detail-tab${tab === t ? ' active' : ''}`}
                onClick={() => setTab(t)}
              >
                {t === 'params'
                  ? '参数'
                  : t === 'request'
                    ? '请求体'
                    : t === 'responses'
                      ? '响应'
                      : 'Schema'}
                {t === 'params' ? <span className="badge">{draft.parameters.length}</span> : null}
                {t === 'responses' ? <span className="badge">{draft.responses.length}</span> : null}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="endpoint-detail-body">
            {tab === 'params' ? (
              isEditing ? (
                <ParameterEditor
                  parameters={draft.parameters}
                  onChange={(params) => updateDraft({ parameters: params })}
                />
              ) : (
                <ParameterTable parameters={draft.parameters} />
              )
            ) : tab === 'request' ? (
              isEditing ? (
                <RequestBodyEditor
                  body={requestBody}
                  schemas={schemas}
                  onChange={(bodies) => updateDraft({ requestBodies: bodies })}
                  onCreateSchema={onCreateSchema}
                />
              ) : (
                <RequestBodyView body={requestBody} schemas={schemas} />
              )
            ) : tab === 'responses' ? (
              isEditing ? (
                <ResponseEditor
                  responses={draft.responses}
                  schemas={schemas}
                  onChange={(responses) => updateDraft({ responses })}
                  onCreateSchema={onCreateSchema}
                />
              ) : (
                <ResponseList responses={draft.responses} schemas={schemas} />
              )
            ) : (
              <SchemaTab
                responseSchema={responseSchema}
                requestSchema={requestBody}
                schemas={schemas}
              />
            )}
          </div>

          {/* Footer: Delete button (edit mode only) */}
          {mode === 'edit' && onDelete ? (
            <div className="endpoint-detail-footer">
              <button
                className="button button--danger button--sm"
                type="button"
                onClick={handleDeleteRequest}
              >
                <Trash size={16} />
                删除此接口
              </button>
            </div>
          ) : null}
        </aside>
      </div>

      {/* Confirm dialog */}
      {confirmState ? (
        <ConfirmDialog
          open
          title={confirmState.title}
          message={confirmState.message}
          variant={confirmState.variant}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      ) : null}
    </>
  );
}
