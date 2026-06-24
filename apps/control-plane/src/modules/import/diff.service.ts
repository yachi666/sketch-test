/**
 * API Version Diff Service — compares two CanonicalApiModel versions
 * and produces a structured change set.
 *
 * M1: Detects added, removed, and modified endpoints, parameters,
 * request bodies, and responses. Marks potentially breaking changes.
 */

import type { CanonicalApiModel } from '@sketch-test/canonical-api-model';
import { pool } from '../../db/db.js';

export interface DiffEntry {
  type: 'added' | 'removed' | 'modified';
  category:
    | 'endpoint'
    | 'parameter'
    | 'requestBody'
    | 'response'
    | 'schema'
    | 'server'
    | 'security';
  path: string;
  summary: string;
  breaking: boolean;
  details?: {
    before?: unknown;
    after?: unknown;
    field?: string;
    reason?: string;
  };
}

export interface ApiDiffResult {
  baseVersionId: string;
  targetVersionId: string;
  changes: DiffEntry[];
  summary: {
    added: number;
    removed: number;
    modified: number;
    breaking: number;
  };
}

/**
 * Compare two API versions and produce a diff.
 */
export async function diffApiVersions(
  baseVersionId: string,
  targetVersionId: string,
): Promise<ApiDiffResult> {
  const baseResult = await pool.query(`SELECT spec_json FROM api_versions WHERE id = $1`, [
    baseVersionId,
  ]);
  const targetResult = await pool.query(`SELECT spec_json FROM api_versions WHERE id = $1`, [
    targetVersionId,
  ]);

  if (baseResult.rows.length === 0) {
    throw new DiffError(`Base version ${baseVersionId} not found`);
  }
  if (targetResult.rows.length === 0) {
    throw new DiffError(`Target version ${targetVersionId} not found`);
  }

  const base = baseResult.rows[0].spec_json as CanonicalApiModel;
  const target = targetResult.rows[0].spec_json as CanonicalApiModel;

  const changes = computeDiff(base, target);

  return {
    baseVersionId,
    targetVersionId,
    changes,
    summary: {
      added: changes.filter((c) => c.type === 'added').length,
      removed: changes.filter((c) => c.type === 'removed').length,
      modified: changes.filter((c) => c.type === 'modified').length,
      breaking: changes.filter((c) => c.breaking).length,
    },
  };
}

/**
 * Core diff logic comparing two CanonicalApiModel instances.
 */
export function computeDiff(base: CanonicalApiModel, target: CanonicalApiModel): DiffEntry[] {
  const changes: DiffEntry[] = [];

  // ── Endpoints ──
  const baseEndpointMap = new Map(base.endpoints.map((e) => [e.id, e]));
  const targetEndpointMap = new Map(target.endpoints.map((e) => [e.id, e]));

  // Added endpoints
  for (const [id, ep] of targetEndpointMap) {
    if (!baseEndpointMap.has(id)) {
      changes.push({
        type: 'added',
        category: 'endpoint',
        path: `${ep.method} ${ep.path}`,
        summary: `Added endpoint ${ep.method} ${ep.path}`,
        breaking: false,
      });
    }
  }

  // Removed endpoints (breaking)
  for (const [id, ep] of baseEndpointMap) {
    if (!targetEndpointMap.has(id)) {
      changes.push({
        type: 'removed',
        category: 'endpoint',
        path: `${ep.method} ${ep.path}`,
        summary: `Removed endpoint ${ep.method} ${ep.path}`,
        breaking: true,
      });
    }
  }

  // Modified endpoints
  for (const [id, targetEp] of targetEndpointMap) {
    const baseEp = baseEndpointMap.get(id);
    if (!baseEp) continue;

    // Check parameters
    const baseParamMap = new Map((baseEp.parameters ?? []).map((p) => [p.name, p]));
    const targetParamMap = new Map((targetEp.parameters ?? []).map((p) => [p.name, p]));

    for (const [name, tp] of targetParamMap) {
      if (!baseParamMap.has(name)) {
        changes.push({
          type: 'added',
          category: 'parameter',
          path: `${targetEp.method} ${targetEp.path}#params/${name}`,
          summary: `Added parameter "${name}" to ${targetEp.method} ${targetEp.path}`,
          breaking: tp.required === true,
        });
      } else {
        const bp = baseParamMap.get(name)!;
        if (bp.required !== tp.required) {
          changes.push({
            type: 'modified',
            category: 'parameter',
            path: `${targetEp.method} ${targetEp.path}#params/${name}`,
            summary: `Parameter "${name}" required changed: ${bp.required} → ${tp.required}`,
            breaking: bp.required === false && tp.required === true,
            details: { before: bp.required, after: tp.required, field: 'required' },
          });
        }
        if (JSON.stringify(bp.schema) !== JSON.stringify(tp.schema)) {
          changes.push({
            type: 'modified',
            category: 'parameter',
            path: `${targetEp.method} ${targetEp.path}#params/${name}`,
            summary: `Parameter "${name}" schema changed`,
            breaking: isSchemaBreakingChange(bp.schema, tp.schema),
            details: { before: bp.schema, after: tp.schema, field: 'schema' },
          });
        }
      }
    }

    for (const [name] of baseParamMap) {
      if (!targetParamMap.has(name)) {
        changes.push({
          type: 'removed',
          category: 'parameter',
          path: `${targetEp.method} ${targetEp.path}#params/${name}`,
          summary: `Removed parameter "${name}" from ${targetEp.method} ${targetEp.path}`,
          breaking: true,
        });
      }
    }

    // Check request bodies
    const baseBodies = baseEp.requestBodies ?? [];
    const targetBodies = targetEp.requestBodies ?? [];
    if (baseBodies.length === 0 && targetBodies.length > 0) {
      changes.push({
        type: 'added',
        category: 'requestBody',
        path: `${targetEp.method} ${targetEp.path}#body`,
        summary: `Added request body to ${targetEp.method} ${targetEp.path}`,
        breaking: false,
      });
    }
    if (baseBodies.length > 0 && targetBodies.length === 0) {
      changes.push({
        type: 'removed',
        category: 'requestBody',
        path: `${targetEp.method} ${targetEp.path}#body`,
        summary: `Removed request body from ${targetEp.method} ${targetEp.path}`,
        breaking: true,
      });
    }

    // Check responses
    const baseStatuses = new Set((baseEp.responses ?? []).map((r) => r.statusCode));
    const targetStatuses = new Set((targetEp.responses ?? []).map((r) => r.statusCode));

    for (const status of targetStatuses) {
      if (!baseStatuses.has(status)) {
        changes.push({
          type: 'added',
          category: 'response',
          path: `${targetEp.method} ${targetEp.path}#responses/${status}`,
          summary: `Added ${status} response to ${targetEp.method} ${targetEp.path}`,
          breaking: false,
        });
      }
    }

    for (const status of baseStatuses) {
      if (!targetStatuses.has(status)) {
        changes.push({
          type: 'removed',
          category: 'response',
          path: `${targetEp.method} ${targetEp.path}#responses/${status}`,
          summary: `Removed ${status} response from ${targetEp.method} ${targetEp.path}`,
          breaking: true,
        });
      }
    }
  }

  // ── Servers ──
  const baseServers = new Set((base.servers ?? []).map((s) => s.url));
  const targetServers = new Set((target.servers ?? []).map((s) => s.url));

  for (const url of targetServers) {
    if (!baseServers.has(url)) {
      changes.push({
        type: 'added',
        category: 'server',
        path: `#servers/${url}`,
        summary: `Added server: ${url}`,
        breaking: false,
      });
    }
  }
  for (const url of baseServers) {
    if (!targetServers.has(url)) {
      changes.push({
        type: 'removed',
        category: 'server',
        path: `#servers/${url}`,
        summary: `Removed server: ${url}`,
        breaking: true,
      });
    }
  }

  return changes;
}

/**
 * Heuristic: determine if a schema change is potentially breaking.
 * Breaking changes include:
 * - Removing a required field
 * - Tightening a type (e.g., string → integer)
 * - Narrowing enum values
 * - Removing properties
 */
export function isSchemaBreakingChange(before: unknown, after: unknown): boolean {
  if (typeof before !== 'object' || typeof after !== 'object' || !before || !after) {
    return true; // Structural change — assume breaking
  }

  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;

  // Required fields added
  const bRequired: string[] = Array.isArray(b['required']) ? (b['required'] as string[]) : [];
  const aRequired: string[] = Array.isArray(a['required']) ? (a['required'] as string[]) : [];
  if (aRequired.some((f) => !bRequired.includes(f))) return true;

  // Properties removed
  const bProps = (b['properties'] as Record<string, unknown>) ?? {};
  const aProps = (a['properties'] as Record<string, unknown>) ?? {};
  for (const key of Object.keys(bProps)) {
    if (!(key in aProps)) return true;
  }

  // Enum narrowed
  const bEnum: unknown[] = Array.isArray(b['enum']) ? (b['enum'] as unknown[]) : [];
  const aEnum: unknown[] = Array.isArray(a['enum']) ? (a['enum'] as unknown[]) : [];
  if (aEnum.length > 0 && bEnum.length > 0 && aEnum.length < bEnum.length) return true;

  // Type changed (e.g., string → integer)
  if (b['type'] && a['type'] && b['type'] !== a['type']) return true;

  return false;
}

export class DiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiffError';
  }
}
