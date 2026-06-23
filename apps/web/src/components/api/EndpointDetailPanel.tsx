import {
  BracketsCurly,
  CaretDown,
  CaretRight,
  Check,
  FloppyDisk,
  PencilSimple,
  Plus,
  ShieldCheck,
  Tag,
  Trash,
  Warning,
  X,
} from '@phosphor-icons/react';
import { useState, useRef, useEffect, useCallback } from 'react';
import type {
  ApiParameter,
  ApiRequestBody,
  ApiResponseDef,
  EndpointDetail,
  SchemaDisplayNode,
} from '../../types';
import type { HttpMethod } from '@sketch-test/contracts-common';
import { MethodBadge } from '../shared/MethodBadge';
import { SchemaViewer } from './SchemaViewer';

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
  onClose: () => void;
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
  existingIds,
  onSave,
  onDelete,
  onAddToWorkflow,
  onClose,
}: EndpointDetailPanelProps) {
  const [tab, setTab] = useState<'params' | 'request' | 'responses' | 'schema'>('params');
  const [draft, setDraft] = useState<EndpointDetail>(structuredClone(initialDetail));
  const [hasChanges, setHasChanges] = useState(false);
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
      if (e.key === 'Escape') {
        if (isEditing && hasChanges) {
          // First Escape: discard changes warning, or if no changes, close
          if (!window.confirm('有未保存的更改，确定要关闭吗？')) return;
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
  }, [onClose, onSave, isEditing, hasChanges, draft]);

  const updateDraft = useCallback((patch: Partial<EndpointDetail>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setHasChanges(true);
  }, []);

  const handleSave = () => {
    onSave(draft);
    setHasChanges(false);
  };

  const responseSchema = draft.responses.find((r) => r.statusCode >= 200 && r.statusCode < 300);
  const requestBody = draft.requestBodies[0];

  const titleText = mode === 'create' ? '新建接口' : mode === 'edit' ? '编辑接口' : '接口详情';
  const saveLabel = mode === 'create' ? '创建' : '保存';

  return (
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
        role="complementary"
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
                    onChange={(e) => updateDraft({ method: e.target.value as HttpMethod })}
                    aria-label="HTTP 方法"
                  >
                    {(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const).map(
                      (m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ),
                    )}
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
              <>
                {onAddToWorkflow ? (
                  <button
                    className="button button--primary button--sm"
                    type="button"
                    onClick={() => onAddToWorkflow(draft.endpointId)}
                  >
                    <Plus size={16} />
                    加入流程
                  </button>
                ) : null}
              </>
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
                onChange={(bodies) => updateDraft({ requestBodies: bodies })}
              />
            ) : (
              <RequestBodyView body={requestBody} schemas={schemas} />
            )
          ) : tab === 'responses' ? (
            isEditing ? (
              <ResponseEditor
                responses={draft.responses}
                onChange={(responses) => updateDraft({ responses })}
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
              onClick={() => {
                if (
                  window.confirm(
                    `确定要删除接口 ${draft.method} ${draft.path} 吗？此操作不可撤销。`,
                  )
                ) {
                  onDelete(draft.endpointId);
                  onClose();
                }
              }}
            >
              <Trash size={16} />
              删除此接口
            </button>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

// ─── Tag Input ──────────────────────────────────────────────────

function TagInput({ existing, onAdd }: { existing: string[]; onAdd: (tag: string) => void }) {
  const [value, setValue] = useState('');
  const handleSubmit = () => {
    const trimmed = value.trim();
    if (trimmed && !existing.includes(trimmed)) {
      onAdd(trimmed);
      setValue('');
    }
  };
  return (
    <span className="tag-input-wrap">
      <input
        className="tag-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleSubmit();
          }
        }}
        placeholder="+ 标签"
        size={8}
        aria-label="添加标签"
      />
    </span>
  );
}

// ─── Parameter Table (read-only) ────────────────────────────────

function ParameterTable({ parameters }: { parameters: ApiParameter[] }) {
  if (parameters.length === 0) {
    return <div className="empty-state">此接口无参数。</div>;
  }

  const locationLabel = (loc: string) => {
    switch (loc) {
      case 'path':
        return 'Path';
      case 'query':
        return 'Query';
      case 'header':
        return 'Header';
      case 'cookie':
        return 'Cookie';
      default:
        return loc;
    }
  };

  return (
    <div className="params-table-wrap">
      <table className="params-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>位置</th>
            <th>类型</th>
            <th>必填</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          {parameters.map((p) => (
            <tr key={p.id} className={p.deprecated ? 'row--deprecated' : ''}>
              <td>
                <code>{p.name}</code>
                {p.deprecated ? <span className="tag tag--warning">已弃用</span> : null}
              </td>
              <td>
                <span className={`param-loc param-loc--${p.in}`}>{locationLabel(p.in)}</span>
              </td>
              <td>
                <code className="type-text">{p.type ?? '—'}</code>
              </td>
              <td>
                {p.required ? (
                  <span className="required-mark">必需</span>
                ) : (
                  <span className="optional-mark">可选</span>
                )}
              </td>
              <td className="param-desc">
                {p.description ?? '—'}
                {p.example ? (
                  <span className="param-example">
                    示例: <code>{p.example}</code>
                  </span>
                ) : null}
                {p.enum?.length ? (
                  <span className="param-enum">
                    {p.enum.map((v) => (
                      <code key={v}>{v}</code>
                    ))}
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Parameter Editor ────────────────────────────────────────────

function ParameterEditor({
  parameters,
  onChange,
}: {
  parameters: ApiParameter[];
  onChange: (params: ApiParameter[]) => void;
}) {
  const addParam = () => {
    const newParam: ApiParameter = {
      id: `param-${Date.now()}`,
      name: '',
      in: 'query',
      description: '',
      required: false,
      deprecated: false,
      type: 'string',
    };
    onChange([...parameters, newParam]);
  };

  const updateParam = (idx: number, patch: Partial<ApiParameter>) => {
    const next = [...parameters];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const removeParam = (idx: number) => {
    onChange(parameters.filter((_, i) => i !== idx));
  };

  return (
    <div className="editor-section">
      {parameters.length === 0 ? (
        <div className="empty-state">此接口无参数。</div>
      ) : (
        <div className="editor-list">
          {parameters.map((p, idx) => (
            <div key={p.id} className="editor-row">
              <input
                className="input input--cell"
                value={p.name}
                onChange={(e) => updateParam(idx, { name: e.target.value })}
                placeholder="参数名"
                aria-label="参数名称"
              />
              <select
                className="input input--cell"
                value={p.in}
                onChange={(e) => updateParam(idx, { in: e.target.value as ApiParameter['in'] })}
                aria-label="参数位置"
              >
                <option value="path">Path</option>
                <option value="query">Query</option>
                <option value="header">Header</option>
                <option value="cookie">Cookie</option>
              </select>
              <input
                className="input input--cell input--narrow"
                value={p.type ?? ''}
                onChange={(e) => updateParam(idx, { type: e.target.value || undefined })}
                placeholder="类型"
                aria-label="参数类型"
              />
              <label className="editor-checkbox">
                <input
                  type="checkbox"
                  checked={p.required}
                  onChange={(e) => updateParam(idx, { required: e.target.checked })}
                />
                必填
              </label>
              <input
                className="input input--cell input--wide"
                value={p.description ?? ''}
                onChange={(e) => updateParam(idx, { description: e.target.value || undefined })}
                placeholder="说明（可选）"
                aria-label="参数说明"
              />
              <button
                className="icon-button icon-button--sm"
                type="button"
                onClick={() => removeParam(idx)}
                aria-label="删除参数"
              >
                <Trash size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        className="button button--ghost button--sm editor-add"
        type="button"
        onClick={addParam}
      >
        <Plus size={14} />
        添加参数
      </button>
    </div>
  );
}

// ─── Request Body View (read-only) ──────────────────────────────

function RequestBodyView({
  body,
  schemas,
}: {
  body?: { description?: string; required: boolean; contentTypes: string[]; schemaRef?: string };
  schemas: Record<string, SchemaDisplayNode>;
}) {
  if (!body) {
    return <div className="empty-state">此接口无请求体。</div>;
  }

  const resolved = body.schemaRef ? schemas[body.schemaRef] : undefined;

  return (
    <div className="request-body-view">
      <div className="request-body-meta">
        <span className={`required-mark${body.required ? '' : ' optional-mark'}`}>
          {body.required ? '必需' : '可选'}
        </span>
        <span className="content-type-badge">{body.contentTypes.join(', ')}</span>
      </div>
      {body.description ? <p>{body.description}</p> : null}
      {resolved ? (
        <details open className="schema-details">
          <summary>
            <BracketsCurly size={16} />
            {resolved.displayName}
          </summary>
          <SchemaViewer schema={resolved} initialDepth={3} />
        </details>
      ) : body.schemaRef ? (
        <div className="notice notice--warning">
          Schema <code>{body.schemaRef}</code> 未找到。
        </div>
      ) : null}
    </div>
  );
}

// ─── Request Body Editor ────────────────────────────────────────

function RequestBodyEditor({
  body,
  onChange,
}: {
  body?: {
    id: string;
    description?: string;
    required: boolean;
    contentTypes: string[];
    schemaRef?: string;
  };
  onChange: (bodies: ApiRequestBody[]) => void;
}) {
  const current = body ?? {
    id: `body-${Date.now()}`,
    description: '',
    required: false,
    contentTypes: ['application/json'],
  };

  const update = (patch: Partial<ApiRequestBody>) => {
    onChange([{ ...current, ...patch }]);
  };

  const remove = () => {
    onChange([]);
  };

  if (!body) {
    return (
      <div className="editor-section">
        <div className="empty-state">此接口无请求体。</div>
        <button
          className="button button--ghost button--sm editor-add"
          type="button"
          onClick={() => onChange([current])}
        >
          <Plus size={14} />
          添加请求体
        </button>
      </div>
    );
  }

  return (
    <div className="editor-section">
      <div className="editor-row">
        <label className="editor-checkbox">
          <input
            type="checkbox"
            checked={current.required}
            onChange={(e) => update({ required: e.target.checked })}
          />
          必需
        </label>
        <input
          className="input input--cell"
          value={current.contentTypes.join(', ')}
          onChange={(e) =>
            update({
              contentTypes: e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          placeholder="Content-Type，如 application/json"
          aria-label="Content-Type"
        />
      </div>
      <div className="editor-row">
        <input
          className="input input--cell input--wide"
          value={current.description ?? ''}
          onChange={(e) => update({ description: e.target.value || undefined })}
          placeholder="请求体描述（可选）"
          aria-label="请求体描述"
        />
        <input
          className="input input--cell"
          value={current.schemaRef ?? ''}
          onChange={(e) => update({ schemaRef: e.target.value || undefined })}
          placeholder="Schema 引用，如 /schemas/CreateUserRequest"
          aria-label="Schema 引用"
        />
      </div>
      <button className="button button--ghost button--sm" type="button" onClick={remove}>
        <Trash size={14} />
        移除请求体
      </button>
    </div>
  );
}

// ─── Response List (read-only) ──────────────────────────────────

function ResponseList({
  responses,
  schemas,
}: {
  responses: EndpointDetail['responses'];
  schemas: Record<string, SchemaDisplayNode>;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (responses.length === 0) {
    return <div className="empty-state">无响应定义。</div>;
  }

  return (
    <div className="response-list">
      {responses.map((resp) => {
        const isOpen = expanded[resp.id] ?? (resp.statusCode === 200 || resp.statusCode === 201);
        const resolved = resp.schemaRef ? schemas[resp.schemaRef] : undefined;
        const isSuccess = resp.statusCode >= 200 && resp.statusCode < 300;
        const isError = resp.statusCode >= 400;

        return (
          <div key={resp.id} className={`response-item${isOpen ? ' response-item--open' : ''}`}>
            <button
              type="button"
              className="response-item-header"
              onClick={() => setExpanded((prev) => ({ ...prev, [resp.id]: !prev[resp.id] }))}
            >
              {isOpen ? (
                <CaretDown size={14} weight="fill" />
              ) : (
                <CaretRight size={14} weight="fill" />
              )}
              <span
                className={`status-code status-code--${isSuccess ? 'success' : isError ? 'error' : 'neutral'}`}
              >
                {resp.statusCode}
              </span>
              <span className="response-item-desc">{resp.description}</span>
              <span className="content-type-badge">{resp.contentTypes.join(', ')}</span>
            </button>
            {isOpen && resolved ? (
              <div className="response-item-body">
                <SchemaViewer schema={resolved} initialDepth={2} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ─── Response Editor ────────────────────────────────────────────

function ResponseEditor({
  responses,
  onChange,
}: {
  responses: ApiResponseDef[];
  onChange: (responses: ApiResponseDef[]) => void;
}) {
  const addResponse = () => {
    const newResp: ApiResponseDef = {
      id: `resp-${Date.now()}`,
      statusCode: 200,
      description: '',
      contentTypes: ['application/json'],
    };
    onChange([...responses, newResp]);
  };

  const updateResponse = (idx: number, patch: Partial<ApiResponseDef>) => {
    const next = [...responses];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const removeResponse = (idx: number) => {
    onChange(responses.filter((_, i) => i !== idx));
  };

  return (
    <div className="editor-section">
      {responses.length === 0 ? (
        <div className="empty-state">无响应定义。</div>
      ) : (
        <div className="editor-list">
          {responses.map((resp, idx) => (
            <div key={resp.id} className="editor-card">
              <div className="editor-row">
                <input
                  className="input input--cell input--narrow"
                  type="number"
                  value={resp.statusCode}
                  onChange={(e) => updateResponse(idx, { statusCode: Number(e.target.value) })}
                  min={100}
                  max={599}
                  aria-label="HTTP 状态码"
                />
                <input
                  className="input input--cell input--wide"
                  value={resp.description}
                  onChange={(e) => updateResponse(idx, { description: e.target.value })}
                  placeholder="响应描述"
                  aria-label="响应描述"
                />
                <button
                  className="icon-button icon-button--sm"
                  type="button"
                  onClick={() => removeResponse(idx)}
                  aria-label="删除响应"
                >
                  <Trash size={14} />
                </button>
              </div>
              <div className="editor-row">
                <input
                  className="input input--cell"
                  value={resp.contentTypes.join(', ')}
                  onChange={(e) =>
                    updateResponse(idx, {
                      contentTypes: e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="Content-Type"
                  aria-label="响应 Content-Type"
                />
                <input
                  className="input input--cell"
                  value={resp.schemaRef ?? ''}
                  onChange={(e) => updateResponse(idx, { schemaRef: e.target.value || undefined })}
                  placeholder="Schema 引用（可选）"
                  aria-label="响应 Schema 引用"
                />
              </div>
            </div>
          ))}
        </div>
      )}
      <button
        className="button button--ghost button--sm editor-add"
        type="button"
        onClick={addResponse}
      >
        <Plus size={14} />
        添加响应
      </button>
    </div>
  );
}

// ─── Schema Tab ─────────────────────────────────────────────────

function SchemaTab({
  responseSchema,
  requestSchema,
  schemas,
}: {
  responseSchema?: EndpointDetail['responses'][number];
  requestSchema?: { schemaRef?: string };
  schemas: Record<string, SchemaDisplayNode>;
}) {
  const resSchema = responseSchema?.schemaRef ? schemas[responseSchema.schemaRef] : undefined;
  const reqSchema = requestSchema?.schemaRef ? schemas[requestSchema.schemaRef] : undefined;

  return (
    <div className="schema-tab">
      {reqSchema ? (
        <details open className="schema-details">
          <summary>
            <BracketsCurly size={16} />
            请求 Schema — {reqSchema.displayName}
          </summary>
          <SchemaViewer schema={reqSchema} initialDepth={3} />
        </details>
      ) : (
        <div className="empty-state">无请求 Schema。</div>
      )}
      {resSchema ? (
        <details open className="schema-details">
          <summary>
            <BracketsCurly size={16} />
            响应 Schema — {resSchema.displayName}
          </summary>
          <SchemaViewer schema={resSchema} initialDepth={3} />
        </details>
      ) : (
        <div className="empty-state">无响应 Schema。</div>
      )}
    </div>
  );
}
