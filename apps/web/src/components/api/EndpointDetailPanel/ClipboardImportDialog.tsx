import { Check, Lightning, Trash, Warning, X } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApiParameter } from '../../../types';

interface ClipboardImportDialogProps {
  open: boolean;
  /** Target parameter location — for bulk header imports this is 'header'. */
  targetLocation: ApiParameter['in'];
  onImport: (params: Omit<ApiParameter, 'id' | 'deprecated'>[]) => void;
  onClose: () => void;
}

interface ParsedParam {
  name: string;
  value: string;
  type: string;
  required: boolean;
  description: string;
}

/**
 * Parse a header line in various formats:
 * - "Content-Type: application/json" (key: value)
 * - "Content-Type:application/json" (no space after colon)
 * - '-H "Content-Type: application/json"' (cURL flag)
 * - "Content-Type=application/json" (key=value)
 */
function parseHeaderLine(line: string): ParsedParam | null {
  let trimmed = line.trim();
  if (!trimmed) return null;

  // Strip leading -H or --header flag from cURL
  trimmed = trimmed.replace(/^(-H|--header)\s+/, '');

  // Strip surrounding quotes
  trimmed = trimmed.replace(/^["']/, '').replace(/["']$/, '');

  // Try "Key: Value" format
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx > 0) {
    const name = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    if (name) {
      return { name, value, type: inferType(value), required: false, description: '' };
    }
  }

  // Try "Key=Value" format
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx > 0) {
    const name = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (name) {
      return { name, value, type: inferType(value), required: false, description: '' };
    }
  }

  // If it's just a single word (no delimiter), treat as header name with empty value
  if (/^[A-Za-z][\w-]*$/.test(trimmed)) {
    return { name: trimmed, value: '', type: 'string', required: false, description: '' };
  }

  return null;
}

/**
 * Parse a JSON object where keys are header names and values are header values.
 * Example: {"Content-Type": "application/json", "Authorization": "Bearer xxx"}
 */
function parseJsonHeaders(text: string): ParsedParam[] {
  try {
    const obj = JSON.parse(text);
    if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
      return Object.entries(obj).map(([name, value]) => ({
        name,
        value: String(value),
        type: inferType(String(value)),
        required: false,
        description: '',
      }));
    }
  } catch {
    // Not valid JSON
  }
  return [];
}

function inferType(value: string): string {
  if (!value) return 'string';
  if (/^\d+$/.test(value)) return 'integer';
  if (/^\d+\.\d+$/.test(value)) return 'number';
  if (/^(true|false)$/i.test(value)) return 'boolean';
  if (value.startsWith('Bearer ') || value.startsWith('Basic ')) return 'string';
  return 'string';
}

/**
 * Parse multi-line clipboard text into header/parameter entries.
 * Supports:
 * - key: value (one per line)
 * - -H "key: value" (cURL style)
 * - key=value (query-param style)
 * - JSON object {"key": "value", ...}
 */
export function parseBulkParams(raw: string): ParsedParam[] {
  // Try JSON first
  const jsonResult = parseJsonHeaders(raw);
  if (jsonResult.length > 0) return jsonResult;

  // Line-by-line parsing
  const results: ParsedParam[] = [];
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const parsed = parseHeaderLine(line);
    if (parsed) {
      // Deduplicate: if same name exists, skip
      if (!results.some((r) => r.name.toLowerCase() === parsed.name.toLowerCase())) {
        results.push(parsed);
      }
    }
  }

  return results;
}

/**
 * A dialog that allows users to paste headers or parameters from their clipboard,
 * preview the parsed results, and import them into the parameter editor.
 *
 * Design follows Postman's "Bulk Edit" pattern:
 * 1. Paste raw text in a monospace textarea
 * 2. See a live preview table of parsed entries
 * 3. Confirm to apply
 */
export function ClipboardImportDialog({
  open,
  targetLocation,
  onImport,
  onClose,
}: ClipboardImportDialogProps) {
  const [raw, setRaw] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const parsed = useMemo(() => parseBulkParams(raw), [raw]);

  useEffect(() => {
    if (open) {
      setRaw('');
      // Auto-focus textarea after render
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open]);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setRaw(text);
      }
    } catch {
      // Clipboard API not available — user can paste manually
    }
  };

  const handleImport = () => {
    if (parsed.length === 0) return;
    const params = parsed.map((p) => ({
      name: p.name,
      in: targetLocation,
      type: p.type,
      required: p.required,
      description: p.description || '',
      example: p.value || undefined,
    }));
    onImport(params);
    onClose();
  };

  if (!open) return null;

  const hasContent = raw.trim().length > 0;
  const hasParsed = parsed.length > 0;
  const showError = hasContent && !hasParsed;

  return (
    <div
      className="endpoint-detail-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog dialog--clipboard" role="dialog" aria-label="从剪贴板导入">
        {/* Header */}
        <div className="dialog-header">
          <div className="dialog-header-left">
            <Lightning size={20} weight="fill" />
            <h3>批量导入{targetLocation === 'header' ? 'Header' : '参数'}</h3>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="dialog-body">
          <p className="dialog-desc">
            从剪贴板粘贴或直接输入{targetLocation === 'header' ? 'Header' : '参数'}文本。 支持{' '}
            <code>Key: Value</code>、<code>-H "Key: Value"</code> (cURL)、<code>Key=Value</code> 和{' '}
            <code>{'{"Key": "Value"}'}</code> (JSON) 格式。
          </p>

          {/* Textarea */}
          <div className="clipboard-input-wrapper">
            <textarea
              ref={textareaRef}
              className="input clipboard-textarea"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={
                targetLocation === 'header'
                  ? `Content-Type: application/json\nAuthorization: Bearer eyJhbGci...\nX-Request-Id: {{$guid}}`
                  : `page: 1\nsize: 20\nsort: createdAt`
              }
              rows={8}
              aria-label="粘贴文本区域"
              spellCheck={false}
            />
            <button
              className="button button--ghost button--sm clipboard-paste-btn"
              type="button"
              onClick={handlePaste}
              title="从剪贴板读取"
            >
              从剪贴板读取
            </button>
          </div>

          {/* Error state */}
          {showError ? (
            <div className="clipboard-error">
              <Warning size={16} />
              <span>无法解析输入内容。请检查格式是否正确。</span>
            </div>
          ) : null}

          {/* Preview table */}
          {hasParsed ? (
            <div className="clipboard-preview">
              <div className="clipboard-preview-header">
                <span className="clipboard-preview-title">
                  预览 <span className="badge">{parsed.length}</span>
                </span>
                <button
                  className="button button--ghost button--xs"
                  type="button"
                  onClick={() => setRaw('')}
                >
                  <Trash size={12} />
                  清除
                </button>
              </div>
              <div className="clipboard-preview-table-wrapper">
                <table className="clipboard-preview-table">
                  <thead>
                    <tr>
                      <th>位置</th>
                      <th>名称</th>
                      <th>类型</th>
                      <th>示例值</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.map((p, i) => (
                      <tr key={`${p.name}-${i}`}>
                        <td>
                          <span className="param-location-badge">{targetLocation}</span>
                        </td>
                        <td>
                          <strong>{p.name}</strong>
                        </td>
                        <td>
                          <code>{p.type}</code>
                        </td>
                        <td className="clipboard-example-cell">{p.value || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
            disabled={!hasParsed}
            onClick={handleImport}
          >
            <Check size={16} />
            导入 {hasParsed ? `${parsed.length} 个参数` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
