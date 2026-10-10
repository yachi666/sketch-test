import { BracketsCurly, TreeStructure } from '@phosphor-icons/react';
import { useState } from 'react';
import type { EndpointDetail, SchemaDisplayNode } from '../../../types';
import { SchemaViewer } from '../SchemaViewer';

interface SchemaTabProps {
  responseSchema?: EndpointDetail['responses'][number];
  requestSchema?: { schemaRef?: string };
  schemas: Record<string, SchemaDisplayNode>;
}

type SchemaViewMode = 'tree' | 'json';

/** Recursively convert a SchemaDisplayNode to a representative JSON example. */
function schemaToExample(node: SchemaDisplayNode): unknown {
  if (node.example !== undefined && node.example !== null) return node.example;

  switch (node.type) {
    case 'object': {
      const obj: Record<string, unknown> = {};
      if (node.properties) {
        for (const [key, prop] of Object.entries(node.properties)) {
          obj[key] = schemaToExample(prop);
        }
      }
      return obj;
    }
    case 'array':
      return node.items ? [schemaToExample(node.items)] : [];
    case 'string':
      return node.enum?.[0] ?? 'string';
    case 'integer':
      return node.minimum ?? 0;
    case 'number':
      return node.minimum ?? 0.0;
    case 'boolean':
      return false;
    case 'null':
      return null;
    default:
      return '';
  }
}

/** JSON syntax highlighting via HTML spans. */
function highlightJson(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  const padInner = '  '.repeat(indent + 1);

  if (value === null) return '<span class="json-null">null</span>';
  if (typeof value === 'boolean') return `<span class="json-boolean">${value}</span>`;
  if (typeof value === 'number') return `<span class="json-number">${value}</span>`;
  if (typeof value === 'string') return `<span class="json-string">"${escapeHtml(value)}"</span>`;

  if (Array.isArray(value)) {
    if (value.length === 0) return '<span class="json-punct">[]</span>';
    const items = value
      .map((v) => `${padInner}${highlightJson(v, indent + 1)}`)
      .join('<span class="json-punct">,</span>\n');
    return `<span class="json-punct">[</span>\n${items}\n${pad}<span class="json-punct">]</span>`;
  }

  // object
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return '<span class="json-punct">{}</span>';
  const pairs = entries
    .map(
      ([k, v]) =>
        `${padInner}<span class="json-key">"${escapeHtml(k)}"</span><span class="json-punct">:</span> ${highlightJson(v, indent + 1)}`,
    )
    .join('<span class="json-punct">,</span>\n');
  return `<span class="json-punct">{</span>\n${pairs}\n${pad}<span class="json-punct">}</span>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function JsonView({ schema }: { schema: SchemaDisplayNode }) {
  const example = schemaToExample(schema);
  return (
    <pre className="schema-json">
      <code dangerouslySetInnerHTML={{ __html: highlightJson(example) }} />
    </pre>
  );
}

function SchemaBlock({ schema, label }: { schema: SchemaDisplayNode; label: string }) {
  const [viewMode, setViewMode] = useState<SchemaViewMode>('tree');

  return (
    <details open className="schema-details">
      <summary>
        <BracketsCurly size={16} />
        {label} — {schema.displayName}
        <span className="schema-view-toggle">
          <button
            type="button"
            className={`schema-view-toggle-btn${viewMode === 'tree' ? ' active' : ''}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setViewMode('tree');
            }}
            title="树形视图"
          >
            <TreeStructure size={13} />
          </button>
          <button
            type="button"
            className={`schema-view-toggle-btn${viewMode === 'json' ? ' active' : ''}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setViewMode('json');
            }}
            title="JSON 视图"
          >
            {'{ }'}
          </button>
        </span>
      </summary>
      {viewMode === 'tree' ? (
        <SchemaViewer schema={schema} initialDepth={3} />
      ) : (
        <JsonView schema={schema} />
      )}
    </details>
  );
}

/**
 * Displays the request and response schemas side-by-side.
 * Each schema supports Tree and JSON view modes via a toggle.
 */
export function SchemaTab({ responseSchema, requestSchema, schemas }: SchemaTabProps) {
  const resSchema = responseSchema?.schemaRef ? schemas[responseSchema.schemaRef] : undefined;
  const reqSchema = requestSchema?.schemaRef ? schemas[requestSchema.schemaRef] : undefined;

  return (
    <div className="schema-tab">
      {reqSchema ? (
        <SchemaBlock schema={reqSchema} label="请求 Schema" />
      ) : (
        <div className="empty-state">无请求 Schema。</div>
      )}
      {resSchema ? (
        <SchemaBlock schema={resSchema} label="响应 Schema" />
      ) : (
        <div className="empty-state">无响应 Schema。</div>
      )}
    </div>
  );
}
