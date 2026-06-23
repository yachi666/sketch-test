import { ClipboardText, Plus, Trash } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import type { ApiRequestBody, SchemaDisplayNode } from '../../../types';
import { SchemaRefInput } from './SchemaRefInput';

interface RequestBodyEditorProps {
  body?: {
    id: string;
    description?: string;
    required: boolean;
    contentTypes: string[];
    schemaRef?: string;
    exampleBody?: string;
  };
  /** Available schemas for the SchemaRefInput combobox. */
  schemas: Record<string, SchemaDisplayNode>;
  onChange: (bodies: ApiRequestBody[]) => void;
  /** Called when user creates a new schema. */
  onCreateSchema?: (schema: SchemaDisplayNode) => void;
}

/**
 * Inline editor for the request body in edit/create mode.
 * Supports toggling required, editing content types, description, and schema ref.
 * Allows removing the request body entirely.
 *
 * Also supports pasting request body content from clipboard via a textarea,
 * with auto-detection of content type from the pasted data.
 */
export function RequestBodyEditor({
  body,
  schemas,
  onChange,
  onCreateSchema,
}: RequestBodyEditorProps) {
  const [showBodyTextarea, setShowBodyTextarea] = useState(false);
  const [localBodyText, setLocalBodyText] = useState(body?.exampleBody ?? '');
  const [bodyError, setBodyError] = useState<string | null>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);

  const current = body ?? {
    id: `body-${Date.now()}`,
    description: '',
    required: false,
    contentTypes: ['application/json'],
    exampleBody: '',
  };

  const update = (patch: Partial<ApiRequestBody>) => {
    onChange([{ ...current, ...patch }]);
  };

  const remove = () => {
    onChange([]);
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setLocalBodyText(text);
        setBodyError(null);
        setShowBodyTextarea(true);
        setTimeout(() => bodyTextareaRef.current?.focus(), 50);

        // Auto-detect content type only when user hasn't explicitly changed it
        const ct = detectContentType(text);
        const isDefaultCT =
          current.contentTypes.length === 1 && current.contentTypes[0] === 'application/json';
        if (ct !== current.contentTypes[0] && isDefaultCT) {
          update({ contentTypes: [ct], exampleBody: text });
        } else if (ct !== current.contentTypes[0]) {
          // User has set a non-default Content-Type — preserve it, just update body
          update({ exampleBody: text });
        } else {
          update({ exampleBody: text });
        }
      }
    } catch {
      // Clipboard API not available — open textarea for manual paste
      setShowBodyTextarea(true);
      setTimeout(() => bodyTextareaRef.current?.focus(), 50);
    }
  };

  const handleBodyTextChange = (text: string) => {
    setLocalBodyText(text);
    setBodyError(null);

    // Validate JSON if content type is application/json
    if (current.contentTypes[0]?.includes('json') && text.trim()) {
      try {
        JSON.parse(text);
        setBodyError(null);
      } catch (e) {
        setBodyError(`JSON 格式错误: ${(e as Error).message}`);
      }
    }

    update({ exampleBody: text });
  };

  const handleClearBody = () => {
    setLocalBodyText('');
    setBodyError(null);
    setShowBodyTextarea(false);
    update({ exampleBody: undefined });
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
      {/* Metadata row */}
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
      </div>
      <div className="editor-row">
        <SchemaRefInput
          value={current.schemaRef}
          schemas={schemas}
          onChange={(ref) => update({ schemaRef: ref })}
          onCreateSchema={onCreateSchema}
          placeholder="选择或搜索 Schema…"
          ariaLabel="请求体 Schema 引用"
        />
      </div>

      {/* Body content section */}
      <div className="editor-body-section">
        <div className="editor-body-header">
          <span className="editor-body-label">请求体示例</span>
          <div className="editor-body-actions">
            <button
              className="button button--ghost button--sm"
              type="button"
              onClick={handlePasteFromClipboard}
              title="从剪贴板粘贴请求体"
            >
              <ClipboardText size={14} />
              从剪贴板粘贴
            </button>
            {current.exampleBody ? (
              <button
                className="button button--ghost button--sm"
                type="button"
                onClick={handleClearBody}
                title="清除请求体内容"
              >
                <Trash size={14} />
                清除
              </button>
            ) : null}
            <button
              className="button button--ghost button--sm"
              type="button"
              onClick={() => {
                setShowBodyTextarea(!showBodyTextarea);
                if (!showBodyTextarea) {
                  setLocalBodyText(current.exampleBody ?? '');
                  setTimeout(() => bodyTextareaRef.current?.focus(), 50);
                }
              }}
            >
              {showBodyTextarea ? '收起' : '展开编辑'}
            </button>
          </div>
        </div>

        {showBodyTextarea ? (
          <div className="editor-body-textarea-wrapper">
            <textarea
              ref={bodyTextareaRef}
              className={`input editor-body-textarea${bodyError ? ' editor-body-textarea--error' : ''}`}
              value={localBodyText}
              onChange={(e) => handleBodyTextChange(e.target.value)}
              placeholder={`粘贴请求体内容，例如:\n{\n  "name": "张三",\n  "email": "zhangsan@example.com"\n}`}
              rows={10}
              aria-label="请求体内容"
              spellCheck={false}
            />
            {bodyError ? <div className="editor-body-error">{bodyError}</div> : null}
            <div className="editor-body-hint">
              {current.contentTypes[0]?.includes('json')
                ? '输入 JSON 格式的请求体示例。'
                : '输入请求体内容。'}{' '}
              支持 <kbd>Ctrl+V</kbd> 粘贴。
            </div>
          </div>
        ) : current.exampleBody ? (
          <pre className="editor-body-preview">
            <code>{truncate(current.exampleBody, 500)}</code>
          </pre>
        ) : (
          <div className="empty-state empty-state--small">
            尚未设置请求体示例。点击"从剪贴板粘贴"或"展开编辑"添加。
          </div>
        )}
      </div>

      <button className="button button--ghost button--sm" type="button" onClick={remove}>
        <Trash size={14} />
        移除请求体
      </button>
    </div>
  );
}

/** Detect content type from body text. */
function detectContentType(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'application/json';
  if (trimmed.startsWith('<')) return 'application/xml';
  // Test form-urlencoded BEFORE the loose '=' check below
  if (/^[\w.-]+=/.test(trimmed)) return 'application/x-www-form-urlencoded';
  if (trimmed.startsWith('#')) return 'text/plain';
  return 'application/json'; // default
}

/** Truncate text to maxLen characters, adding ellipsis if truncated. */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}…`;
}
