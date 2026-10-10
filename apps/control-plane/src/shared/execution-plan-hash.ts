/**
 * Deterministic hashing for immutable ExecutionPlan content.
 *
 * Volatile envelope fields such as planId and compiledAt are intentionally not
 * part of the digest. The hash identifies executable behavior, so recompiling
 * the same frozen steps produces the same SHA-256 value.
 */
import { createHash } from 'node:crypto';
import type { FrozenStep, FrozenTeardownStep } from '@sketch-test/runner-protocol';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function executionPlanContentHash(
  steps: FrozenStep[],
  teardown?: FrozenTeardownStep[],
): string {
  const canonical = JSON.stringify(canonicalize({ steps, teardown }));
  return createHash('sha256').update(canonical).digest('hex');
}
