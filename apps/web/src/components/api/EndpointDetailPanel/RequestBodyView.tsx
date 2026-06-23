import { BracketsCurly } from '@phosphor-icons/react';
import type { SchemaDisplayNode } from '../../../types';
import { SchemaViewer } from '../SchemaViewer';

interface RequestBodyViewProps {
  body?: {
    description?: string;
    required: boolean;
    contentTypes: string[];
    schemaRef?: string;
    exampleBody?: string;
  };
  schemas: Record<string, SchemaDisplayNode>;
}

/**
 * Read-only view of the request body definition.
 * Shows required/optional badge, content types, description, resolved schema,
 * and example body content if present.
 */
export function RequestBodyView({ body, schemas }: RequestBodyViewProps) {
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
      {body.exampleBody ? (
        <details className="schema-details" open>
          <summary>
            <BracketsCurly size={16} />
            请求体示例
          </summary>
          <pre className="request-body-example">
            <code>{body.exampleBody}</code>
          </pre>
        </details>
      ) : null}
    </div>
  );
}
