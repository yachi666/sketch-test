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

const EXIT_ANIMATION_MS = 120;

/**
 * Endpoint detail dialog with three modes:
 * - view: read-only display of all endpoint information
 * - edit: inline editing of metadata, parameters, request bodies, responses
 * - create: same as edit but for a new endpoint
 *
 * Presented as a centered modal dialog (not a slide-over drawer),
 * following modal best practices: body scroll lock, focus trap,
 * click-outside-to-dismiss, keyboard shortcuts.
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
  const [closing, setClosing] = useState(false);
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    variant: 'default' | 'danger';
    onConfirm: () => void;
  } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const isEditing = mode === 'edit' || mode === 'create';

  // ── Body scroll lock ──

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    document.body.classList.add('body--modal-open');
    return () => {
      document.body.classList.remove('body--modal-open');
      // Restore focus to the element that triggered the dialog
      previousFocusRef.current?.focus();
    };
  }, []);

  // ── Reset draft when detail changes ──

  useEffect(() => {
    setDraft(structuredClone(initialDetail));
    setHasChanges(false);
  }, [initialDetail]);

  // ── Auto-focus first input in edit/create mode ──

  useEffect(() => {
    if (isEditing && firstInputRef.current) {
      // Small delay to allow entry animation to start
      const timer = setTimeout(() => firstInputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [isEditing, mode]);

  // ── Draft management ──

  const updateDraft = useCallback((patch: Partial<EndpointDetail>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setHasChanges(true);
  }, []);

  const handleSave = () => {
    onSave(draft);
    setHasChanges(false);
  };

  // ── Close with exit animation ──

  const triggerClose = useCallback(() => {
    if (isEditing && hasChanges) {
      setConfirmState({
        title: '放弃更改',
        message: '有未保存的更改，确定要关闭吗？',
        variant: 'danger',
        onConfirm: () => {
          setConfirmState(null);
          setClosing(true);
          setTimeout(() => onClose(), EXIT_ANIMATION_MS);
        },
      });
      return;
    }
    setClosing(true);
    setTimeout(() => onClose(), EXIT_ANIMATION_MS);
  }, [isEditing, hasChanges, onClose]);

  // ── Keyboard shortcuts ──

  const triggerCloseRef = useRef(triggerClose);
  triggerCloseRef.current = triggerClose;

  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when confirm dialog is open
      if (confirmState) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        triggerCloseRef.current();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (isEditing && hasChanges) {
          onSaveRef.current(draft);
          setHasChanges(false);
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isEditing, hasChanges, draft, confirmState]);

  // ── Focus trap ──

  useEffect(() => {
    if (!dialogRef.current) return;

    const dialog = dialogRef.current;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || confirmState) return;

      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [confirmState]);

  const handleDeleteRequest = () => {
    setConfirmState({
      title: '删除接口',
      message: `确定要删除接口 ${draft.method} ${draft.path} 吗？此操作不可撤销。`,
      variant: 'danger',
      onConfirm: () => {
        setConfirmState(null);
        onDelete?.(draft.endpointId);
        setClosing(true);
        setTimeout(() => onClose(), EXIT_ANIMATION_MS);
      },
    });
  };

  const responseSchema = draft.responses.find((r) => r.statusCode >= 200 && r.statusCode < 300);
  const requestBody = draft.requestBodies[0];

  const titleText = mode === 'create' ? '新建接口' : mode === 'edit' ? '编辑接口' : '接口详情';
  const saveLabel = mode === 'create' ? '创建' : '保存';

  // ── Render ──

  return (
    <>
      {/* Overlay */}
      <div
        className={`endpoint-dialog-overlay${closing ? ' endpoint-dialog-overlay--closing' : ''}`}
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && !hasChanges) triggerClose();
        }}
      >
        {/* Dialog card */}
        <div
          ref={dialogRef}
          className={`endpoint-dialog${closing ? ' endpoint-dialog--closing' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={titleText}
        >
          {/* ── Title bar ── */}
          <div className="endpoint-dialog-titlebar">
            <div className="endpoint-dialog-titlebar-left">
              <span className="endpoint-dialog-titlebar-icon">
                {mode === 'create' ? <Plus size={16} weight="bold" /> : null}
                {mode === 'edit' ? (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <title>编辑</title>
                    <path d="M11.5 1.5L14.5 4.5L5 14H2V11L11.5 1.5Z" />
                  </svg>
                ) : null}
                {mode === 'view' ? (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <title>查看</title>
                    <circle cx="8" cy="8" r="3" />
                    <path d="M1 8C2.5 4 5.5 2 8 2C10.5 2 13.5 4 15 8C13.5 12 10.5 14 8 14C5.5 14 2.5 12 1 8Z" />
                  </svg>
                ) : null}
              </span>
              <h2>{titleText}</h2>
            </div>
            <div className="endpoint-dialog-titlebar-right">
              {isEditing ? (
                <button
                  className="button button--primary button--sm"
                  type="button"
                  disabled={!draft.method || !draft.path || !draft.summary}
                  onClick={handleSave}
                >
                  <FloppyDisk size={15} />
                  {saveLabel}
                </button>
              ) : onAddToWorkflow ? (
                <button
                  className="button button--primary button--sm"
                  type="button"
                  onClick={() => onAddToWorkflow(draft.endpointId)}
                >
                  <Plus size={15} />
                  加入流程
                </button>
              ) : null}
              <button
                className="icon-button"
                type="button"
                onClick={triggerClose}
                aria-label="关闭对话框"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* ── Identity section (method + path + summary + description) ── */}
          <div className="endpoint-dialog-identity">
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
                  <code className="endpoint-detail-path">{draft.path}</code>
                </>
              )}
            </div>

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
                placeholder="接口描述（可选，支持 Markdown）"
                rows={2}
                aria-label="接口描述"
              />
            ) : draft.description ? (
              <p>{draft.description}</p>
            ) : null}

            {/* Security badge (view mode only) */}
            {draft.security?.length && !isEditing ? (
              <span className="tag tag--secure" style={{ marginTop: 4 }}>
                <ShieldCheck size={12} />
                需认证
              </span>
            ) : null}
          </div>

          {/* ── Tabs ── */}
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

          {/* ── Tab content ── */}
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

          {/* ── Footer: tags + deprecated + actions ── */}
          {isEditing ? (
            <div className="endpoint-dialog-footer">
              <div className="endpoint-dialog-footer-left">
                {/* Tags */}
                {draft.tags.map((tag) => (
                  <span key={tag} className="tag">
                    <Tag size={11} />
                    {tag}
                    <button
                      className="tag-remove"
                      type="button"
                      onClick={() => updateDraft({ tags: draft.tags.filter((t) => t !== tag) })}
                      aria-label={`移除标签 ${tag}`}
                    >
                      <X size={10} weight="bold" />
                    </button>
                  </span>
                ))}
                <TagInput
                  existing={draft.tags}
                  onAdd={(tag) => updateDraft({ tags: [...draft.tags, tag] })}
                />

                {/* Deprecated toggle */}
                <label className="detail-checkbox">
                  <input
                    type="checkbox"
                    checked={draft.deprecated}
                    onChange={(e) => updateDraft({ deprecated: e.target.checked })}
                  />
                  已弃用
                </label>
              </div>

              <div className="endpoint-dialog-footer-right">
                {mode === 'edit' && onDelete ? (
                  <button
                    className="button button--danger button--sm"
                    type="button"
                    onClick={handleDeleteRequest}
                  >
                    <Trash size={14} />
                    删除此接口
                  </button>
                ) : null}
                {mode === 'create' ? (
                  <button
                    className="button button--primary button--sm"
                    type="button"
                    disabled={!draft.method || !draft.path || !draft.summary}
                    onClick={handleSave}
                  >
                    <FloppyDisk size={15} />
                    创建
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
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
