/**
 * @sketch-test/adapter-postman — Postman variable resolution
 *
 * Resolves Postman collection and environment variables, then expands
 * {{varName}} template patterns with the resolved values.
 *
 * Schema version: 1.0.0
 * Specification: Postman Collection v2.1.0 variable resolution
 */

import type { PostmanVariable } from '../types.js';

/** Variable scope for resolution */
export interface VariableScope {
  variables: Map<string, string>; // key → resolved value
  dynamicVariables: string[]; // e.g., $randomInt, $guid
  unresolved: string[]; // vars referenced but not defined
}

/**
 * Dynamic variable patterns (Postman built-in).
 * All Postman dynamic variables start with a $ prefix.
 */
const DYNAMIC_VAR_PATTERN = /^\$/;

/**
 * Template variable pattern matching {{varName}}.
 */
const TEMPLATE_PATTERN = /\{\{([^}]+)\}\}/g;

/**
 * Merge collection + environment variables.
 *
 * Environment values override collection values for the same key.
 * Disabled variables are skipped entirely.
 *
 * @param collectionVars - Variables defined at the collection level
 * @param envVars - Variables defined at the environment level
 * @returns A VariableScope with merged, resolved variables
 */
export function resolveVariables(
  collectionVars?: PostmanVariable[],
  envVars?: PostmanVariable[],
): VariableScope {
  const variables = new Map<string, string>();
  const dynamicVariables: string[] = [];
  const unresolved: string[] = [];

  // Process collection variables first (lower priority)
  if (collectionVars) {
    for (const v of collectionVars) {
      if (v.disabled) {
        continue;
      }
      variables.set(v.key, v.value);
    }
  }

  // Process environment variables (higher priority, overrides collection)
  if (envVars) {
    for (const v of envVars) {
      if (v.disabled) {
        continue;
      }
      variables.set(v.key, v.value);
    }
  }

  return { variables, dynamicVariables, unresolved };
}

/**
 * Replace {{varName}} patterns with resolved values.
 *
 * - Known variables are replaced with their resolved value.
 * - Dynamic variables ($randomInt, $guid, etc.) are kept as-is and
 *   added to scope.dynamicVariables.
 * - Unknown variables are kept as-is ({{unknownVar}}) and added to
 *   scope.unresolved.
 *
 * @param template - A string potentially containing {{varName}} patterns
 * @param scope - The VariableScope with resolved variable values
 * @returns The expanded string with known variables replaced
 */
export function expandTemplate(template: string, scope: VariableScope): string {
  return template.replace(TEMPLATE_PATTERN, (match, varName: string) => {
    const trimmed = varName.trim();

    // Check for dynamic variables (Postman built-in, starts with $)
    if (DYNAMIC_VAR_PATTERN.test(trimmed)) {
      if (!scope.dynamicVariables.includes(trimmed)) {
        scope.dynamicVariables.push(trimmed);
      }
      return match; // Keep as-is, not resolved
    }

    // Check for a known resolved variable
    const resolved = scope.variables.get(trimmed);
    if (resolved !== undefined) {
      return resolved;
    }

    // Unknown variable — keep original pattern and record as unresolved
    if (!scope.unresolved.includes(trimmed)) {
      scope.unresolved.push(trimmed);
    }
    return match;
  });
}
