import { FileCode, FloppyDisk, Globe, Plus, Sparkle, Tag, Trash, X } from '@phosphor-icons/react';
import type { HttpMethod } from '@sketch-test/contracts-common';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EndpointDetail, SchemaDisplayNode, Variable } from '../../../types';
import { resolveVariableValue } from '../../../types';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import { MethodBadge } from '../../shared/MethodBadge';
import { EndpointDefinitionPanel } from './EndpointDefinitionDialog';
import { GenerateTestsDialog, type GenerationStrategy } from './GenerateTestsDialog';
import { ParameterEditor } from './ParameterEditor';
import { ParameterTable } from './ParameterTable';
import { PreviewView } from './PreviewView';
import { RequestBodyEditor } from './RequestBodyEditor';
import { RequestBodyView } from './RequestBodyView';
import { RequestSendPanel } from './RequestSendPanel';
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
  /** Called when user creates a new schema (e.g., from JSON body paste). */
  onCreateSchema?: (schema: SchemaDisplayNode) => void;
  /** Host-tagged variables available for selection as the endpoint's base URL. */
  hostVariables?: Variable[];
  /** Current active environment ID for resolving variable values. */
  activeEnvironmentId?: string;
  /** Called when user types a manual host URL — should create a new Host-tagged Variable and return it. */
  onCreateHostVariable?: (url: string) => Variable | Promise<Variable>;
  /** Open directly in the one-off request composer. */
  startRequestComposer?: boolean;
  /** Immutable API version that supplied this endpoint. */
  apiVersionId?: string;
  /** Create generated drafts for just this endpoint. */
  onGenerateTests?: (strategy: GenerationStrategy) => Promise<void>;
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
  onCreateSchema,
  hostVariables = [],
  activeEnvironmentId,
  onCreateHostVariable,
  startRequestComposer = false,
  apiVersionId,
  onGenerateTests,
  onClose,
}: EndpointDetailPanelProps) {
  const [tab, setTab] = useState<'params' | 'request' | 'responses' | 'schema'>('params');
  const [draft, setDraft] = useState<EndpointDetail>(structuredClone(initialDetail));
  const [hasChanges, setHasChanges] = useState(false);
  const [closing, setClosing] = useState(false);
  const [manualHostUrl, setManualHostUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [sendingRequest, setSendingRequest] = useState(false);
  const [definitionOpen, setDefinitionOpen] = useState(false);
  const [generationOpen, setGenerationOpen] = useState(false);
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

  // ── URL preview computation ──

  const previewUrl = useMemo(() => {
    // Resolve host URL
    let baseUrl = '';
    if (draft.hostVariableId) {
      const hv = hostVariables.find((v) => v.id === draft.hostVariableId);
      if (hv) {
        baseUrl = resolveVariableValue(hv, activeEnvironmentId ?? null).replace(/\/+$/, '');
      }
    } else if (manualHostUrl.trim()) {
      baseUrl = manualHostUrl.trim().replace(/\/+$/, '');
    }

    const path = draft.path || '';

    // Collect query parameters with their example values
    const queryEntries = draft.parameters
      .filter((p) => p.in === 'query')
      .map((p) => ({ name: p.name, example: p.example }));

    const queryString = queryEntries.map((p) => `${p.name}=${p.example ?? ''}`).join('&');

    const scheme = baseUrl.match(/^(https?:\/\/)/)?.[0] || '';
    const hostPart = baseUrl.replace(/^https?:\/\//, '');

    return {
      scheme,
      hostPart,
      path,
      queryString,
      queryEntries,
      hasBase: !!baseUrl,
      hasContent: !!(baseUrl || path),
    };
  }, [
    draft.hostVariableId,
    draft.path,
    draft.parameters,
    hostVariables,
    activeEnvironmentId,
    manualHostUrl,
  ]);

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

  useEffect(() => {
    setSendingRequest(startRequestComposer);
  }, [initialDetail.endpointId, startRequestComposer]);

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

  const handleSave = async () => {
    if (saving) return;

    // If user typed a manual host URL, create a Host variable first
    let hostVariableId = draft.hostVariableId;
    if (!hostVariableId && manualHostUrl.trim() && onCreateHostVariable) {
      try {
        setSaving(true);
        const newVar = await onCreateHostVariable(manualHostUrl.trim());
        hostVariableId = newVar.id;
        setDraft((prev) => ({ ...prev, hostVariableId: newVar.id }));
      } catch {
        // Variable creation failed — proceed without host
      }
    }

    const finalDraft = hostVariableId ? { ...draft, hostVariableId } : draft;
    onSave(finalDraft);
    setHasChanges(false);
    setSaving(false);
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

  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

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
          void handleSaveRef.current();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isEditing, hasChanges, confirmState]);

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

  // Resolved host for view mode preview
  const resolvedHost = useMemo(() => {
    if (!draft.hostVariableId) return null;
    const hv = hostVariables.find((v) => v.id === draft.hostVariableId);
    if (!hv) return null;
    return resolveVariableValue(hv, activeEnvironmentId ?? null);
  }, [draft.hostVariableId, hostVariables, activeEnvironmentId]);

  const titleText = mode === 'create' ? '新建接口' : mode === 'edit' ? '编辑接口' : '接口详情';
  const saveLabel = mode === 'create' ? '创建' : '保存';
  const directRequestUrl = useMemo(() => {
    const baseUrl = previewUrl.hasBase
      ? `${previewUrl.scheme}${previewUrl.hostPart}`
      : (resolvedHost?.replace(/\/+$/, '') ?? '');
    const replacePathParameter = (placeholder: string, name: string) => {
      const example = draft.parameters.find(
        (parameter) => parameter.in === 'path' && parameter.name === name,
      )?.example;
      return example ? encodeURIComponent(example) : placeholder;
    };
    const path = draft.path
      .replace(/\{([^}]+)\}/g, replacePathParameter)
      .replace(/:([A-Za-z0-9_-]+)/g, replacePathParameter);
    const query = draft.parameters
      .filter((parameter) => parameter.in === 'query' && parameter.example !== undefined)
      .map(
        (parameter) =>
          `${encodeURIComponent(parameter.name)}=${encodeURIComponent(parameter.example ?? '')}`,
      )
      .join('&');
    return `${baseUrl}${path}${query ? `?${query}` : ''}`;
  }, [
    draft.parameters,
    draft.path,
    previewUrl.hasBase,
    previewUrl.hostPart,
    previewUrl.scheme,
    resolvedHost,
  ]);

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
              {mode === 'view' ? (
                <div className="endpoint-dialog-titlebar-text">
                  <h2>{draft.summary || titleText}</h2>
                  {draft.description ? (
                    <p className="endpoint-dialog-titlebar-desc">{draft.description}</p>
                  ) : null}
                </div>
              ) : (
                <h2>{titleText}</h2>
              )}
            </div>
            <div className="endpoint-dialog-titlebar-right">
              {sendingRequest ? null : isEditing ? (
                <button
                  className="button button--primary button--sm"
                  type="button"
                  disabled={!draft.method || !draft.path || !draft.summary}
                  onClick={handleSave}
                >
                  <FloppyDisk size={15} />
                  {saveLabel}
                </button>
              ) : null}
              {mode === 'view' ? (
                <button
                  className="button button--outline button--sm"
                  type="button"
                  onClick={() => setDefinitionOpen((visible) => !visible)}
                >
                  <FileCode size={15} />
                  {definitionOpen ? '收起 YAML' : '展示 YAML'}
                </button>
              ) : null}
              {mode === 'view' && apiVersionId && onGenerateTests ? (
                <button
                  className="button button--primary button--sm"
                  type="button"
                  onClick={() => setGenerationOpen(true)}
                >
                  <Sparkle size={15} />
                  生成用例
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

          {/* ── View mode: URL preview bar (full-width, outside identity) ── */}
          {mode === 'view' && !sendingRequest ? (
            <div className="preview-url-bar">
              <MethodBadge method={draft.method} />
              {previewUrl.hasBase ? (
                <span className="preview-url-bar-url">
                  <span className="preview-url-scheme">{previewUrl.scheme}</span>
                  <span className="preview-url-host">{previewUrl.hostPart}</span>
                  <span className="preview-url-path">{previewUrl.path || '/'}</span>
                  {previewUrl.queryString ? (
                    <>
                      <span className="preview-url-qs-sep">?</span>
                      {previewUrl.queryEntries.map((entry, i) => (
                        <span key={entry.name}>
                          {i > 0 ? <span className="preview-url-qs-sep">&amp;</span> : null}
                          <span className="preview-url-param-name">{entry.name}</span>=
                          <span className="preview-url-param-value">{entry.example ?? '…'}</span>
                        </span>
                      ))}
                    </>
                  ) : null}
                </span>
              ) : resolvedHost ? (
                <span className="preview-url-bar-url">
                  <span className="preview-url-host">{resolvedHost}</span>
                  <span className="preview-url-path">{draft.path || '/'}</span>
                </span>
              ) : (
                <span className="preview-url-bar-url">
                  <span className="preview-url-path">{draft.path || '/'}</span>
                </span>
              )}
            </div>
          ) : null}

          {/* ── Identity section (edit/create only) ── */}
          {isEditing ? (
            <div className="endpoint-dialog-identity">
              {/* URL Builder: method + path */}
              <div className="endpoint-dialog-url-builder">
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
                <span className="url-builder-separator">/</span>
                <input
                  ref={firstInputRef}
                  className="input input--path"
                  value={draft.path}
                  onChange={(e) => updateDraft({ path: e.target.value })}
                  placeholder="/api/resource/{id}"
                  aria-label="接口路径"
                />
              </div>

              {/* Summary (inline) — edit/create only; view mode shows it in the title bar */}
              {isEditing ? (
                <div className="endpoint-dialog-summary-row">
                  <input
                    className="input input--summary"
                    value={draft.summary}
                    onChange={(e) => updateDraft({ summary: e.target.value })}
                    placeholder="接口摘要（如：获取用户列表）"
                    aria-label="接口摘要"
                  />
                </div>
              ) : null}

              {/* Host selector (compact inline) */}
              {isEditing && hostVariables.length > 0 ? (
                <div className="endpoint-dialog-host-row">
                  <Globe size={15} color="var(--brown)" style={{ flexShrink: 0 }} />
                  <select
                    className="endpoint-dialog-host-select"
                    value={draft.hostVariableId ?? (manualHostUrl ? '__manual__' : '')}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '__manual__') {
                        // Keep manual mode active
                      } else if (val === '') {
                        updateDraft({ hostVariableId: undefined });
                        setManualHostUrl('');
                      } else {
                        updateDraft({ hostVariableId: val });
                        setManualHostUrl('');
                      }
                    }}
                    aria-label="选择 Host 变量"
                  >
                    <option value="">不使用 Host 变量</option>
                    {hostVariables.map((v) => {
                      const resolved = activeEnvironmentId
                        ? resolveVariableValue(v, activeEnvironmentId)
                        : v.defaultValue;
                      return (
                        <option key={v.id} value={v.id}>
                          {v.name} → {resolved}
                        </option>
                      );
                    })}
                    {onCreateHostVariable ? (
                      <option value="__manual__">✎ 手动输入 URL（自动创建变量）...</option>
                    ) : null}
                  </select>
                  {!draft.hostVariableId && (
                    <input
                      className="endpoint-dialog-host-manual-input"
                      value={manualHostUrl}
                      onChange={(e) => {
                        setManualHostUrl(e.target.value);
                        setHasChanges(true);
                      }}
                      placeholder="https://your-service:4000"
                      aria-label="手动输入 Host URL"
                    />
                  )}
                </div>
              ) : null}
              {/* Host displayed in the URL bar inside PreviewView — skip here for view mode */}

              {/* ── URL Preview (thin dark strip) ── */}
              {isEditing ? (
                previewUrl.hasContent ? (
                  <div className="endpoint-dialog-url-preview">
                    <span className="endpoint-dialog-url-preview-label">预览</span>
                    <div className="endpoint-dialog-url-preview-content">
                      {previewUrl.hasBase ? (
                        <>
                          <span className="url-scheme">{previewUrl.scheme}</span>
                          <span className="url-host">{previewUrl.hostPart}</span>
                        </>
                      ) : (
                        <span className="url-no-host">未选择 Host</span>
                      )}
                      <span className="url-path">{previewUrl.path || '/'}</span>
                      {previewUrl.queryString ? (
                        <>
                          <span className="url-query-sep">?</span>
                          {previewUrl.queryEntries.map((p, i) => (
                            <span key={p.name}>
                              {i > 0 ? <span className="url-query-sep">&amp;</span> : null}
                              <span className="url-param-name">{p.name}</span>
                              <span className="url-param-eq">=</span>
                              <span className="url-param-value">{p.example ?? '…'}</span>
                            </span>
                          ))}
                        </>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="endpoint-dialog-url-preview endpoint-dialog-url-preview--empty">
                    <span className="endpoint-dialog-url-preview-label">预览</span>
                    <span className="endpoint-dialog-url-preview-hint">
                      选择 Host 并填写路径后预览完整 URL
                    </span>
                  </div>
                )
              ) : null}

              {/* Description — edit/create only; view mode shows it in PreviewView */}
              {isEditing ? (
                <textarea
                  className="input input--desc"
                  value={draft.description ?? ''}
                  onChange={(e) => updateDraft({ description: e.target.value || undefined })}
                  placeholder="接口描述（可选，支持 Markdown）"
                  rows={1}
                  aria-label="接口描述"
                />
              ) : null}

              {/* Security badge — view mode shows it in PreviewView meta row */}
            </div>
          ) : null}

          {/* ── View mode ── */}
          {sendingRequest ? (
            <RequestSendPanel
              detail={draft}
              defaultUrl={directRequestUrl}
              onBack={() => setSendingRequest(false)}
            />
          ) : mode === 'view' ? (
            definitionOpen ? (
              <EndpointDefinitionPanel
                apiVersionId={apiVersionId}
                endpointId={draft.endpointId}
                detail={draft}
              />
            ) : (
              <PreviewView
                deprecated={draft.deprecated}
                tags={draft.tags}
                security={draft.security}
                parameters={draft.parameters}
                requestBody={requestBody}
                responses={draft.responses}
                schemas={schemas}
                responseSchema={responseSchema}
              />
            )
          ) : (
            <>
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
                    {t === 'params' ? (
                      <span className="badge">{draft.parameters.length}</span>
                    ) : null}
                    {t === 'responses' ? (
                      <span className="badge">{draft.responses.length}</span>
                    ) : null}
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
            </>
          )}

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
      {generationOpen && onGenerateTests ? (
        <GenerateTestsDialog
          onGenerate={onGenerateTests}
          onClose={() => setGenerationOpen(false)}
        />
      ) : null}
    </>
  );
}
