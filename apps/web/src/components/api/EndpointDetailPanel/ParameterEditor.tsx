import { Lightning, Plus, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import type { ApiParameter } from '../../../types';
import { ClipboardImportDialog } from './ClipboardImportDialog';

interface ParameterEditorProps {
  parameters: ApiParameter[];
  onChange: (params: ApiParameter[]) => void;
}

/**
 * Inline parameter editor used in edit/create mode.
 * Supports add, update, and remove of parameters with name, location, type,
 * required status, and description fields.
 *
 * Also supports bulk import from clipboard via the "批量导入" button,
 * which opens a dialog where users can paste Key:Value pairs, cURL -H flags,
 * or JSON objects.
 */
export function ParameterEditor({ parameters, onChange }: ParameterEditorProps) {
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkTarget, setBulkTarget] = useState<ApiParameter['in']>('header');

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

  const handleBulkImport = (imported: Omit<ApiParameter, 'id' | 'deprecated'>[]) => {
    const newParams = imported.map((p) => ({
      ...p,
      id: `param-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      deprecated: false as const,
    }));

    // Merge: update existing params with same (name + location), append new ones
    const existing = [...parameters];
    for (const np of newParams) {
      const existingIdx = existing.findIndex((ep) => ep.name === np.name && ep.in === np.in);
      if (existingIdx >= 0) {
        // Update existing: preserve id but update type, example, description
        existing[existingIdx] = {
          ...existing[existingIdx],
          type: np.type || existing[existingIdx].type,
          example: np.example || existing[existingIdx].example,
          description: np.description || existing[existingIdx].description,
        };
      } else {
        existing.push(np);
      }
    }
    onChange(existing);
  };

  const openBulkFor = (location: ApiParameter['in']) => {
    setBulkTarget(location);
    setBulkOpen(true);
  };

  return (
    <div className="editor-section">
      {/* Bulk import toolbar */}
      <div className="editor-toolbar">
        <div className="editor-toolbar-actions">
          <button
            className="button button--ghost button--sm"
            type="button"
            onClick={() => openBulkFor('header')}
            title="从剪贴板批量导入 Header 参数"
          >
            <Lightning size={14} />
            批量导入 Header
          </button>
          <button
            className="button button--ghost button--sm"
            type="button"
            onClick={() => openBulkFor('query')}
            title="从剪贴板批量导入 Query 参数"
          >
            <Lightning size={14} />
            批量导入 Query
          </button>
        </div>
      </div>

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

      {/* Bulk import dialog */}
      <ClipboardImportDialog
        open={bulkOpen}
        targetLocation={bulkTarget}
        onImport={handleBulkImport}
        onClose={() => setBulkOpen(false)}
      />
    </div>
  );
}
