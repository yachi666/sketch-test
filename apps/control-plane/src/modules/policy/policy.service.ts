/**
 * Policy Service — CRUD for access policies and rule-based decision evaluation.
 *
 * Policies define access control rules that govern whether an action is allowed,
 * denied, or requires approval. Rules are evaluated in priority order (descending)
 * and the first matching rule determines the decision.
 *
 * DB table: policies
 */

import { pool } from '../../db/db.js';
import { policyId } from '../../shared/id.js';

// ── Types ──────────────────────────────────────────────────────────────────────────

export interface PolicyRule {
  id: string;
  description?: string;
  condition: PolicyCondition;
  effect: 'allow' | 'deny' | 'require-approval';
  priority: number;
}

export interface PolicyCondition {
  environmentId?: string;
  sideEffect?: string[];
  methods?: string[];
  [key: string]: unknown;
}

export interface Policy {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  rules: PolicyRule[];
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PolicyDecision = 'allow' | 'deny' | 'require-approval';

export interface PolicyEvaluationResult {
  decision: PolicyDecision;
  matchedRules: string[];
  reason?: string;
}

export interface PolicyEvaluationContext {
  /** The principal (user, service account, etc.) */
  subject: {
    id: string;
    role?: string;
    [key: string]: unknown;
  };
  /** The action being performed (e.g., 'run:start', 'workflow:delete') */
  action: string;
  /** The target resource with properties */
  resource: {
    id?: string;
    type?: string;
    environmentId?: string;
    sideEffect?: string;
    method?: string;
    [key: string]: unknown;
  };
  /** Additional context (e.g., timestamp, source IP) */
  context?: Record<string, unknown>;
}

// ── Row mappers ────────────────────────────────────────────────────────────────────

function rowToPolicy(row: Record<string, unknown>): Policy {
  const rules = (row['rules_json'] as PolicyRule[]) ?? [];
  return {
    id: row['id'] as string,
    workspaceId: row['workspace_id'] as string,
    name: row['name'] as string,
    description: row['description'] as string,
    rules: sortRulesByPriority(rules),
    priority: row['priority'] as number,
    enabled: row['enabled'] as boolean,
    createdAt: formatTimestamp(row['created_at']),
    updatedAt: formatTimestamp(row['updated_at']),
  };
}

function formatTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? '');
}

/** Sort rules by priority descending (highest first). */
function sortRulesByPriority(rules: PolicyRule[]): PolicyRule[] {
  return [...rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

// ── Errors ─────────────────────────────────────────────────────────────────────────

export class PolicyNotFoundError extends Error {
  constructor(id: string) {
    super(`Policy ${id} not found`);
    this.name = 'PolicyNotFoundError';
  }
}

// ── Policy CRUD ────────────────────────────────────────────────────────────────────

/** Create a policy within a workspace. */
export async function createPolicy(
  workspaceId: string,
  name: string,
  rules: PolicyRule[],
  description?: string,
  priority?: number,
): Promise<Policy> {
  const id = policyId();
  const now = new Date().toISOString();
  const desc = description ?? '';
  const prio = priority ?? 0;

  await pool.query(
    `INSERT INTO policies
      (id, workspace_id, name, description, rules_json, priority, enabled, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8)`,
    [id, workspaceId, name, desc, JSON.stringify(rules), prio, now, now],
  );

  return {
    id,
    workspaceId,
    name,
    description: desc,
    rules: sortRulesByPriority(rules),
    priority: prio,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

/** Get a policy by ID. */
export async function getPolicy(id: string): Promise<Policy | null> {
  const result = await pool.query('SELECT * FROM policies WHERE id = $1', [id]);
  if (result.rows.length === 0) return null;
  return rowToPolicy(result.rows[0]);
}

/** List all policies in a workspace, ordered by priority descending. */
export async function listPolicies(workspaceId: string): Promise<Policy[]> {
  const result = await pool.query(
    `SELECT * FROM policies
     WHERE workspace_id = $1
     ORDER BY priority DESC, created_at DESC`,
    [workspaceId],
  );
  return result.rows.map(rowToPolicy);
}

/** Update a policy. Only provided fields are changed. */
export async function updatePolicy(
  id: string,
  updates: {
    name?: string;
    rules?: PolicyRule[];
    description?: string;
    priority?: number;
    enabled?: boolean;
  },
): Promise<Policy> {
  const now = new Date().toISOString();

  // Build dynamic SET clause
  const sets: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (updates.name !== undefined) {
    sets.push(`name = $${paramIdx++}`);
    values.push(updates.name);
  }
  if (updates.rules !== undefined) {
    sets.push(`rules_json = $${paramIdx++}`);
    values.push(JSON.stringify(updates.rules));
  }
  if (updates.description !== undefined) {
    sets.push(`description = $${paramIdx++}`);
    values.push(updates.description);
  }
  if (updates.priority !== undefined) {
    sets.push(`priority = $${paramIdx++}`);
    values.push(updates.priority);
  }
  if (updates.enabled !== undefined) {
    sets.push(`enabled = $${paramIdx++}`);
    values.push(updates.enabled);
  }

  // Always update updated_at
  sets.push(`updated_at = $${paramIdx++}`);
  values.push(now);

  if (sets.length === 1) {
    // Nothing to update besides timestamp; return current state
    const current = await getPolicy(id);
    if (!current) throw new PolicyNotFoundError(id);
    return current;
  }

  values.push(id);

  const result = await pool.query(
    `UPDATE policies SET ${sets.join(', ')} WHERE id = $${paramIdx}
     RETURNING *`,
    values,
  );

  if (result.rows.length === 0) {
    throw new PolicyNotFoundError(id);
  }

  return rowToPolicy(result.rows[0]);
}

/** Delete a policy. */
export async function deletePolicy(id: string): Promise<void> {
  await pool.query('DELETE FROM policies WHERE id = $1', [id]);
}

// ── Policy Evaluation ──────────────────────────────────────────────────────────────

/**
 * Evaluate all enabled policies in a workspace against a subject, action,
 * resource, and context.
 *
 * Evaluation logic:
 * 1. Fetch all enabled policies for the workspace
 * 2. Collect all rules from all policies, sorted by priority descending
 * 3. For each rule, check if the condition matches the resource/context
 * 4. The first matching rule determines the decision
 * 5. If no rule matches: allow (default-deny can be achieved with a catch-all rule)
 */
export async function evaluatePolicies(
  workspaceId: string,
  subject: PolicyEvaluationContext['subject'],
  action: string,
  resource: PolicyEvaluationContext['resource'],
  context?: PolicyEvaluationContext['context'],
): Promise<PolicyEvaluationResult> {
  // Fetch all enabled policies, ordered by priority
  const result = await pool.query(
    `SELECT * FROM policies
     WHERE workspace_id = $1 AND enabled = true
     ORDER BY priority DESC`,
    [workspaceId],
  );

  // Collect and flatten all rules from all policies
  const allRules: Array<{ rule: PolicyRule; policyId: string; policyName: string }> = [];
  for (const row of result.rows) {
    const rules = (row['rules_json'] as PolicyRule[]) ?? [];
    for (const rule of rules) {
      allRules.push({
        rule,
        policyId: row['id'] as string,
        policyName: row['name'] as string,
      });
    }
  }

  // Sort all rules by priority descending
  allRules.sort((a, b) => (b.rule.priority ?? 0) - (a.rule.priority ?? 0));

  const matchedRuleIds: string[] = [];

  for (const { rule } of allRules) {
    if (ruleMatchesCondition(rule, subject, action, resource, context)) {
      matchedRuleIds.push(rule.id);
      // First matching rule determines the decision
      return {
        decision: rule.effect,
        matchedRules: matchedRuleIds,
        reason: rule.description,
      };
    }
  }

  // No rule matched: default allow
  return {
    decision: 'allow',
    matchedRules: [],
    reason: 'No matching policy rule found — default allow',
  };
}

/**
 * Check whether a policy rule's condition matches the given evaluation context.
 *
 * For each key in the rule's condition:
 * - If the condition value is an array, the corresponding resource/context
 *   value must be present in that array.
 * - If the condition value is a string/number/boolean, it must equal the
 *   corresponding resource/context value exactly.
 * - All conditions must match for the rule to apply (AND logic).
 *
 * Condition keys are looked up in the resource first, then in the context.
 */
function ruleMatchesCondition(
  rule: PolicyRule,
  _subject: PolicyEvaluationContext['subject'],
  _action: string,
  resource: PolicyEvaluationContext['resource'],
  context?: PolicyEvaluationContext['context'],
): boolean {
  const condition = rule.condition;

  // If the condition is empty, the rule matches everything
  const conditionKeys = Object.keys(condition);
  if (conditionKeys.length === 0) return true;

  for (const key of conditionKeys) {
    const conditionValue = condition[key];

    // Look up the actual value in resource first, then context
    const actualValue =
      key in resource ? resource[key] : context && key in context ? context[key] : undefined;

    // If the resource/context doesn't have this key, condition fails
    if (actualValue === undefined || actualValue === null) {
      return false;
    }

    // Array condition: actual value must be in the array
    if (Array.isArray(conditionValue)) {
      if (typeof actualValue === 'string') {
        if (!conditionValue.includes(actualValue)) {
          return false;
        }
      } else if (Array.isArray(actualValue)) {
        // If both are arrays, at least one element of actual must match
        const hasMatch = actualValue.some((v) => conditionValue.includes(String(v)));
        if (!hasMatch) return false;
      } else {
        return false;
      }
    }
    // Scalar condition: exact match
    else if (actualValue !== conditionValue) {
      return false;
    }
  }

  return true;
}
