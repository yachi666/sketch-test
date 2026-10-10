import { BracketsCurly, Check, Warning, X } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SchemaDisplayNode } from '../../../types';

interface SchemaGeneratorDialogProps {
  open: boolean;
  /** Existing schemas — used to check for ID conflicts. */
  schemas: Record<string, SchemaDisplayNode>;
  onCreate: (schema: SchemaDisplayNode) => void;
  onClose: () => void;
}

/**
 * Infer JSON Schema type from a JavaScript value.
 */
function inferJsonType(value: unknown) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'string') return 'string';
  if (t === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (t === 'boolean') return 'boolean';
  if (t === 'object') return 'object';
  return 'string';
}

/**
 * Recursively generate a SchemaDisplayNode tree from a JavaScript value.
 */
function generateSchemaFromValue(
  value: unknown,
  displayName: string,
  schemaId: string,
  depth: number,
): SchemaDisplayNode {
  const type = inferJsonType(value);

  const base: SchemaDisplayNode = {
    id: schemaId,
    displayName,
    type,
  };

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const properties: Record<string, SchemaDisplayNode> = {};
    const required: string[] = [];

    for (const [key, val] of Object.entries(record)) {
      properties[key] = generateSchemaFromValue(val, key, `${schemaId}/${key}`, depth + 1);
      // Non-null, non-optional fields are marked required by default
      if (val !== null && val !== undefined) {
        required.push(key);
      }
    }

    base.properties = properties;
    base.required = required;
  } else if (Array.isArray(value)) {
    if (value.length > 0) {
      base.items = generateSchemaFromValue(
        value[0],
        `${displayName}Item`,
        `${schemaId}/items`,
        depth + 1,
      );
    } else {
      base.items = { id: `${schemaId}/items`, displayName: `${displayName}Item`, type: 'string' };
    }
  }

  // Add example for leaf types
  if (type !== 'object' && type !== 'array') {
    base.example = value;
  }

  return base;
}

/**
 * Dialog for creating a new Schema by pasting a JSON sample.
 *
 * Users paste a JSON payload (e.g., request body, response body), and the dialog
 * automatically infers the schema structure — field names, types, nested objects,
 * arrays, and required fields.
 *
 * Follows the "Generate from JSON" pattern used by Postman, Insomnia, and Stoplight.
 */
export function SchemaGeneratorDialog({
  open,
  schemas,
  onCreate,
  onClose,
}: SchemaGeneratorDialogProps) {
  const [name, setName] = useState('');
  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Parse and preview the generated schema
  const generated = useMemo(() => {
    if (!raw.trim()) return null;
    try {
      const parsed = JSON.parse(raw);
      const schemaName = name.trim() || `GeneratedSchema_${Date.now().toString(36)}`;
      const schemaId = `/schemas/${schemaName}`;
      return generateSchemaFromValue(parsed, schemaName, schemaId, 0);
    } catch {
      return null;
    }
  }, [raw, name]);

  // Detect schema ID conflict
  const idConflict = useMemo(() => {
    if (!generated) return false;
    return generated.id in schemas;
  }, [generated, schemas]);

  // Reset on open
  useEffect(() => {
    if (open) {
      setName('');
      setRaw('');
      setError(null);
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [open]);

  // Validate JSON on change
  useEffect(() => {
    if (!raw.trim()) {
      setError(null);
      return;
    }
    try {
      JSON.parse(raw);
      setError(null);
    } catch (e) {
      setError(`JSON 格式错误: ${(e as Error).message}`);
    }
  }, [raw]);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setRaw(text);
        // Auto-focus name if body is filled
        if (text.trim()) {
          setTimeout(() => nameRef.current?.focus(), 100);
        }
      }
    } catch {
      // Clipboard API not available
    }
  };

  const handleCreate = () => {
    if (!generated) return;
    const finalName = name.trim() || `GeneratedSchema_${Date.now().toString(36)}`;
    const finalId = `/schemas/${finalName}`;
    const schema: SchemaDisplayNode = {
      ...generated,
      id: finalId,
      displayName: finalName,
    };
    onCreate(schema);
  };

  const canCreate = generated !== null && !error && !idConflict;

  if (!open) return null;

  return (
    <div
      className="endpoint-detail-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog dialog--clipboard" role="dialog" aria-label="从 JSON 创建 Schema">
        {/* Header */}
        <div className="dialog-header">
          <div className="dialog-header-left">
            <BracketsCurly size={20} weight="fill" />
            <h3>从 JSON 创建 Schema</h3>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="dialog-body">
          <p className="dialog-desc">
            粘贴 JSON 示例，自动推断 Schema 结构（字段名、类型、嵌套对象、数组、必填字段等）。
          </p>

          {/* Schema name */}
          <div className="schema-gen-field">
            <label className="schema-gen-label" htmlFor="schema-gen-name">
              Schema 名称
            </label>
            <input
              ref={nameRef}
              id="schema-gen-name"
              className="input input--cell schema-gen-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：CreateUserRequest"
              aria-label="Schema 名称"
            />
            {idConflict ? (
              <div className="schema-gen-warning">
                <Warning size={14} />
                <span>
                  Schema <code>{generated?.id}</code> 已存在，请修改名称。
                </span>
              </div>
            ) : null}
          </div>

          {/* JSON input */}
          <div className="schema-gen-field">
            <div className="schema-gen-field-header">
              <label className="schema-gen-label" htmlFor="schema-gen-json">
                JSON 示例
              </label>
              <button
                className="button button--ghost button--xs"
                type="button"
                onClick={handlePaste}
              >
                从剪贴板读取
              </button>
            </div>
            <textarea
              ref={textareaRef}
              id="schema-gen-json"
              className={`input clipboard-textarea schema-gen-textarea${error ? ' editor-body-textarea--error' : ''}`}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={`{\n  "name": "张三",\n  "email": "zhangsan@example.com",\n  "age": 28\n}`}
              rows={8}
              aria-label="JSON 示例"
              spellCheck={false}
            />
            {error ? <div className="editor-body-error">{error}</div> : null}
          </div>

          {/* Preview */}
          {generated && !error ? (
            <div className="schema-gen-preview">
              <div className="schema-gen-preview-header">
                <BracketsCurly size={14} />
                <span>
                  预览：<strong>{generated.displayName}</strong>
                </span>
                <span className="schema-gen-preview-type">{generated.type ?? 'object'}</span>
                {generated.properties ? (
                  <span className="schema-gen-preview-count">
                    {Object.keys(generated.properties).length} 个字段
                    {generated.required?.length ? `（${generated.required.length} 个必填）` : ''}
                  </span>
                ) : null}
              </div>
              <table className="schema-gen-preview-table">
                <thead>
                  <tr>
                    <th>字段名</th>
                    <th>类型</th>
                    <th>必填</th>
                    <th>示例值</th>
                  </tr>
                </thead>
                <tbody>
                  {generated.properties ? (
                    Object.entries(generated.properties).map(([key, prop]) => (
                      <tr key={key}>
                        <td>
                          <strong>{key}</strong>
                        </td>
                        <td>
                          <code>{prop.type}</code>
                          {prop.type === 'array' && prop.items ? (
                            <span className="schema-gen-item-type">
                              {' '}
                              → <code>{prop.items.type}</code>
                            </span>
                          ) : null}
                        </td>
                        <td>
                          {generated.required?.includes(key) ? (
                            <span className="schema-gen-required">✓</span>
                          ) : (
                            <span className="schema-gen-optional">—</span>
                          )}
                        </td>
                        <td className="schema-gen-example-cell">
                          {prop.example !== undefined ? JSON.stringify(prop.example) : '—'}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="schema-gen-empty">
                        叶节点类型：<code>{generated.type}</code>
                        {generated.example !== undefined
                          ? ` — 示例：${JSON.stringify(generated.example)}`
                          : ''}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="dialog-footer">
          <button className="button button--outline button--sm" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="button button--primary button--sm"
            type="button"
            disabled={!canCreate}
            onClick={handleCreate}
          >
            <Check size={16} />
            创建 Schema
          </button>
        </div>
      </div>
    </div>
  );
}
