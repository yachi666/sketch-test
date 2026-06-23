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
