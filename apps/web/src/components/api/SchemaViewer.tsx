import { CaretDown, CaretRight } from '@phosphor-icons/react';
import { useState } from 'react';
import type { SchemaDisplayNode } from '../../types';

interface SchemaViewerProps {
  schema: SchemaDisplayNode;
  /** Initial expansion depth. Defaults to 1 (root + direct properties). */
  initialDepth?: number;
}

/**
 * Recursive schema viewer that renders a JSON Schema subset as an expandable
 * tree. Matches the craft paper design system — warm, muted tones, with
 * monospace for type information.
 */
export function SchemaViewer({ schema, initialDepth = 1 }: SchemaViewerProps) {
  return (
    <div className="schema-viewer">
      <SchemaNode node={schema} depth={0} initialDepth={initialDepth} isRoot />
    </div>
  );
}

function SchemaNode({
  node,
  depth,
  initialDepth,
  isRoot = false,
}: {
  node: SchemaDisplayNode;
  depth: number;
  initialDepth: number;
  isRoot?: boolean;
}) {
  const [expanded, setExpanded] = useState(depth < initialDepth);
  const hasChildren = node.type === 'object' || node.type === 'array' || !!node.enum;

  return (
    <div className={`schema-node${isRoot ? ' schema-node--root' : ''}`}>
      {/* Header row */}
      <button
        type="button"
        className="schema-node-header"
        onClick={() => hasChildren && setExpanded(!expanded)}
        aria-expanded={hasChildren ? expanded : undefined}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {hasChildren ? (
          expanded ? (
            <CaretDown size={14} weight="fill" />
          ) : (
            <CaretRight size={14} weight="fill" />
          )
        ) : (
          <span className="schema-node-indent" />
        )}
        <strong className="schema-node-name">{node.displayName}</strong>
        <span className="schema-node-type">{node.type ?? 'unknown'}</span>
        {node.format ? <span className="schema-node-format">{node.format}</span> : null}
        {node.nullable ? <span className="schema-node-tag">nullable</span> : null}
        {node.deprecated ? (
          <span className="schema-node-tag schema-node-tag--deprecated">deprecated</span>
        ) : null}
      </button>

      {/* Constraints summary (always visible) */}
      <div className="schema-node-constraints" style={{ paddingLeft: `${depth * 16 + 32}px` }}>
        {node.description ? <span className="schema-node-desc">{node.description}</span> : null}
        {node.minLength !== undefined || node.maxLength !== undefined ? (
          <span className="schema-node-constraint">
            长度: {node.minLength ?? 0}–{node.maxLength ?? '∞'}
          </span>
        ) : null}
        {node.pattern ? (
          <span className="schema-node-constraint">
            pattern: <code>{node.pattern}</code>
          </span>
        ) : null}
        {node.minimum !== undefined ? (
          <span className="schema-node-constraint">≥ {node.minimum}</span>
        ) : null}
        {node.maximum !== undefined ? (
          <span className="schema-node-constraint">≤ {node.maximum}</span>
        ) : null}
        {node.example !== undefined ? (
          <span className="schema-node-example">
            示例:{' '}
            <code>
              {typeof node.example === 'string' ? node.example : JSON.stringify(node.example)}
            </code>
          </span>
        ) : null}
      </div>

      {/* Enum values */}
      {expanded && node.enum ? (
        <div className="schema-node-enum" style={{ paddingLeft: `${depth * 16 + 40}px` }}>
          <span className="schema-enum-label">允许值:</span>
          {node.enum.map((v, i) => (
            <code key={i} className="schema-enum-value">
              {typeof v === 'string' ? v : JSON.stringify(v)}
            </code>
          ))}
        </div>
      ) : null}

      {/* Object properties */}
      {expanded && node.properties ? (
        <div className="schema-node-properties">
          {Object.entries(node.properties).map(([key, prop]) => (
            <div key={key}>
              <SchemaNode node={prop} depth={depth + 1} initialDepth={initialDepth} />
              {/* Required marker */}
              {node.required?.includes(key) ? (
                <span className="schema-required-mark">必需</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* Array items */}
      {expanded && node.items ? (
        <div className="schema-node-properties">
          <div className="schema-array-marker" style={{ paddingLeft: `${depth * 16 + 40}px` }}>
            <span className="schema-node-constraint">items [ ]</span>
          </div>
          <SchemaNode node={node.items} depth={depth + 1} initialDepth={initialDepth} />
        </div>
      ) : null}
    </div>
  );
}
