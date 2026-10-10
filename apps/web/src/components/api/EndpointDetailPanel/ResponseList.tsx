import { CaretDown, CaretRight } from '@phosphor-icons/react';
import { useState } from 'react';
import type { EndpointDetail, SchemaDisplayNode } from '../../../types';
import { SchemaViewer } from '../SchemaViewer';

interface ResponseListProps {
  responses: EndpointDetail['responses'];
  schemas: Record<string, SchemaDisplayNode>;
}

/**
 * Read-only list of HTTP responses with expandable schema previews.
 * Successful (2xx) and error (4xx+) responses get color-coded status badges.
 */
export function ResponseList({ responses, schemas }: ResponseListProps) {
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
