import type { DetectionResult } from '../index.js';

export function detectOpenApi(content: unknown): DetectionResult | null {
  if (!content || typeof content !== 'object') return null;

  const obj = content as Record<string, unknown>;

  // OpenAPI 3.x — "openapi" is a string field
  if (typeof obj['openapi'] === 'string') {
    const fullVersion = obj['openapi'] as string;
    const version = fullVersion.match(/^(\d+\.\d+)/)?.[1] ?? fullVersion;
    return {
      format: 'openapi',
      confidence: 0.98,
      version,
      label: `OpenAPI ${fullVersion}`,
      details: {
        endpointCount: countPaths(obj['paths']),
      },
    };
  }

  // Swagger 2.0 — "swagger === '2.0'"
  if (obj['swagger'] === '2.0') {
    return {
      format: 'openapi',
      confidence: 0.98,
      version: '2.0',
      label: 'Swagger 2.0',
      details: {
        endpointCount: countPaths(obj['paths']),
      },
    };
  }

  return null;
}

function countPaths(paths: unknown): number | undefined {
  if (!paths || typeof paths !== 'object') return undefined;
  let count = 0;
  for (const pathItem of Object.values(paths as Record<string, unknown>)) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const [key, val] of Object.entries(pathItem as Record<string, unknown>)) {
      if (
        ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(key) &&
        val &&
        typeof val === 'object'
      ) {
        count++;
      }
    }
  }
  return count;
}
