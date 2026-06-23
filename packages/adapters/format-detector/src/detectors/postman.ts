import type { DetectionResult } from '../index.js';

function hasPostmanSchemaV2(content: Record<string, unknown>): string | null {
  const info = content['info'];
  if (!info || typeof info !== 'object') return null;
  const schema = (info as Record<string, unknown>)['schema'];
  if (typeof schema === 'string' && schema.includes('getpostman.com')) {
    // Extract version from schema URL like …/v2.1.0/…
    const match = schema.match(/v(\d+\.\d+)/);
    return match ? (match[1] ?? null) : '2';
  }
  return null;
}

function isPostmanEnvironment(content: Record<string, unknown>): boolean {
  return Array.isArray(content['values']) && '_postman_variable_scope' in content;
}

function isPostmanV1(content: Record<string, unknown>): boolean {
  return (
    Array.isArray(content['requests']) && Array.isArray(content['folders']) && !content['info']
  );
}

/**
 * Recursively count request items in nested Postman folders/items.
 */
export function countEndpoints(items: unknown[]): number {
  let count = 0;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    // Direct request
    if (obj['request']) {
      count++;
    }
    // Nested folder/items
    if (Array.isArray(obj['item'])) {
      count += countEndpoints(obj['item']);
    }
    if (Array.isArray(obj['items'])) {
      count += countEndpoints(obj['items']);
    }
  }
  return count;
}

export function detectPostman(content: unknown): DetectionResult | null {
  if (!content || typeof content !== 'object') return null;

  const obj = content as Record<string, unknown>;

  // Postman v2.x — info.schema contains getpostman.com
  const v2Version = hasPostmanSchemaV2(obj);
  if (v2Version) {
    return {
      format: 'postman-collection',
      confidence: 0.98,
      version: v2Version,
      label: `Postman Collection v${v2Version}`,
      details: {
        endpointCount: Array.isArray(obj['item']) ? countEndpoints(obj['item']) : 0,
        hasVariables: Array.isArray(obj['variable']) && obj['variable'].length > 0,
        hasAuth: obj['auth'] != null,
      },
    };
  }

  // Postman Environment
  if (isPostmanEnvironment(obj)) {
    return {
      format: 'postman-environment',
      confidence: 0.85,
      label: 'Postman Environment',
      details: {
        hasVariables: true,
        endpointCount: 0,
      },
    };
  }

  // Postman v1
  if (isPostmanV1(obj)) {
    const requests = obj['requests'] as unknown[];
    return {
      format: 'postman-collection',
      confidence: 0.75,
      version: '1',
      label: 'Postman Collection v1',
      details: {
        endpointCount: requests.length,
        hasVariables: Array.isArray(obj['variables']) && obj['variables'].length > 0,
      },
    };
  }

  return null;
}
