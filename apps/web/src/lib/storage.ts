/**
 * Versioned localStorage helpers.
 *
 * All SketchTest persisted data uses versioned keys (`:vN` suffix). When the
 * persisted schema changes, bump the suffix and add a migration entry in
 * LS_MIGRATION_MAP so previously stored data is carried forward on next read.
 */

/**
 * Versioned localStorage keys.
 * Bump the :vN suffix when the persisted schema changes.
 */
export const LS_ENVIRONMENTS_KEY = 'sketchtest.environments:v1';
export const LS_ACTIVE_ENV_KEY = 'sketchtest.activeEnvironmentId:v1';
export const LS_VARIABLES_KEY = 'sketchtest.variables:v1';
export const LS_WORKFLOW_KEY = 'sketchtest.workflow:v1';
export const LS_ACTIVE_WORKFLOW_KEY = 'sketchtest.activeWorkflow:v1';

/** Map from versioned key → old (unversioned) key, for one-time migration. */
const LS_MIGRATION_MAP: Record<string, string> = {
  [LS_ENVIRONMENTS_KEY]: 'sketchtest.environments',
  [LS_ACTIVE_ENV_KEY]: 'sketchtest.activeEnvironmentId',
  [LS_VARIABLES_KEY]: 'sketchtest.variables',
  [LS_WORKFLOW_KEY]: 'sketchtest.workflow',
  [LS_ACTIVE_WORKFLOW_KEY]: 'sketchtest.activeWorkflow',
};

/**
 * Safely read a value from localStorage, with automatic migration from old keys.
 * Always wrapped in try-catch — returns null on any error.
 */
export function lsGet(key: string): string | null {
  try {
    const value = localStorage.getItem(key);
    if (value !== null) return value;
    // One-time migration: check the old unversioned key
    const oldKey = LS_MIGRATION_MAP[key];
    if (oldKey) {
      const oldValue = localStorage.getItem(oldKey);
      if (oldValue !== null) {
        localStorage.setItem(key, oldValue);
        localStorage.removeItem(oldKey);
        return oldValue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Safely write a value to localStorage. Always wrapped in try-catch.
 */
export function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

/**
 * Safely read and parse a JSON value from localStorage.
 * Returns `defaultValue` on any error (missing, corrupt, invalid JSON).
 *
 * @param key     The localStorage key to read.
 * @param validate Optional validator. Return the parsed value if valid, or throw/return null to fall back.
 * @param defaultValue Fallback value when read/parse/validation fails.
 */
export function lsGetJSON<T>(
  key: string,
  defaultValue: T,
  validate?: (parsed: unknown) => T | null,
): T {
  try {
    const stored = lsGet(key);
    if (stored === null) return defaultValue;
    const parsed: unknown = JSON.parse(stored);
    if (validate) {
      const validated = validate(parsed);
      if (validated !== null) return validated;
      return defaultValue;
    }
    return parsed as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Safely write a JSON-serializable value to localStorage.
 */
export function lsSetJSON(key: string, value: unknown): void {
  try {
    lsSet(key, JSON.stringify(value));
  } catch {
    // Serialization failed or storage unavailable — silently ignore
  }
}

// ─── API Import persistence ───────────────────────────────────────

import type { CanonicalApiModel } from '@sketch-test/canonical-api-model';

const API_VERSIONS_KEY = 'sketchtest.api-versions:v1';
const API_ENDPOINTS_KEY = 'sketchtest.api-endpoints:v1';
const API_SOURCES_KEY = 'sketchtest.api-sources:v1';

export interface StoredApiSource {
  id: string;
  name: string;
  description?: string;
  sourceLabel: string;
  sourceType: string;
  defaultBaseUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredApiVersion {
  id: string;
  sourceId?: string;
  sourceType: string;
  sourceLabel: string;
  importedAt: string;
  endpointCount: number;
  fileName: string;
}

export interface StoredApiEndpoint {
  id: string;
  method: string;
  path: string;
  summary: string;
  deprecated: boolean;
  tags?: string[];
  versionId: string;
  sourceLabel: string;
}

/**
 * Persist a CanonicalApiModel to localStorage with versioned keys.
 * Creates a version entry and appends new endpoints (skipping duplicates by id).
 */
export function saveApiImport(
  model: CanonicalApiModel,
  sourceId?: string,
): {
  versionId: string;
  endpointCount: number;
} {
  const versions = loadApiVersions();
  const storedEndpoints = loadAllEndpoints();

  const versionId = `v-${Date.now()}`;
  const version: StoredApiVersion = {
    id: versionId,
    sourceId,
    sourceType: model.metadata.sourceType,
    sourceLabel: model.metadata.sourceLabel,
    importedAt: new Date().toISOString(),
    endpointCount: model.endpoints.length,
    fileName: model.metadata.sourceLabel,
  };

  versions.push(version);
  saveApiVersions(versions);

  for (const ep of model.endpoints) {
    const exists = storedEndpoints.find((e) => e.id === ep.id);
    if (!exists) {
      storedEndpoints.push({
        id: ep.id,
        method: ep.method,
        path: ep.path,
        summary: ep.summary || '',
        deprecated: ep.deprecated,
        tags: ep.tags,
        versionId,
        sourceLabel: model.metadata.sourceLabel,
      });
    }
  }

  saveAllEndpoints(storedEndpoints);

  return { versionId, endpointCount: model.endpoints.length };
}

export function loadApiSources(): StoredApiSource[] {
  try {
    const raw = localStorage.getItem(API_SOURCES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as StoredApiSource[];
    return [];
  } catch {
    return [];
  }
}

function saveApiSources(sources: StoredApiSource[]): void {
  try {
    localStorage.setItem(API_SOURCES_KEY, JSON.stringify(sources));
  } catch {
    // Storage full — silently ignore
  }
}

export function upsertApiSource(source: StoredApiSource): void {
  const sources = loadApiSources();
  const idx = sources.findIndex((s) => s.id === source.id);
  if (idx >= 0) {
    sources[idx] = source;
  } else {
    sources.push(source);
  }
  saveApiSources(sources);
}

export function deleteApiSource(sourceId: string): void {
  const sources = loadApiSources().filter((s) => s.id !== sourceId);
  saveApiSources(sources);
}

export function loadApiVersions(): StoredApiVersion[] {
  try {
    return JSON.parse(localStorage.getItem(API_VERSIONS_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveApiVersions(versions: StoredApiVersion[]): void {
  try {
    localStorage.setItem(API_VERSIONS_KEY, JSON.stringify(versions));
  } catch {
    // Storage full — silently ignore
  }
}

export function loadAllEndpoints(): StoredApiEndpoint[] {
  try {
    return JSON.parse(localStorage.getItem(API_ENDPOINTS_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveAllEndpoints(endpoints: StoredApiEndpoint[]): void {
  try {
    localStorage.setItem(API_ENDPOINTS_KEY, JSON.stringify(endpoints));
  } catch {
    // Storage full — silently ignore
  }
}
