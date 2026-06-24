import crypto from 'node:crypto';

/**
 * Generate a typed EntityId with prefix for readability.
 * Format: {prefix}_{8 random hex chars}
 */
export function generateId(prefix: string): string {
  const hex = crypto.randomBytes(4).toString('hex');
  return `${prefix}_${hex}`;
}

// ── API & Import ──
export function apiVersionId(): string {
  return generateId('av');
}

// ── IAM ──
export function workspaceId(): string {
  return generateId('ws');
}
export function userId(): string {
  return generateId('usr');
}
export function serviceAccountId(): string {
  return generateId('sa');
}
export function roleId(): string {
  return generateId('role');
}

// ── Environment & Secret ──
export function environmentId(): string {
  return generateId('env');
}
export function environmentVersionId(): string {
  return generateId('envv');
}
export function secretId(): string {
  return generateId('sec');
}

// ── Test Cases ──
export function testCaseId(): string {
  return generateId('tc');
}
export function testCaseVersionId(): string {
  return generateId('tcv');
}

// ── Workflows ──
export function workflowId(): string {
  return generateId('wf');
}
export function workflowVersionId(): string {
  return generateId('wfv');
}

// ── Test Suites ──
export function testSuiteId(): string {
  return generateId('ts');
}
export function testSuiteVersionId(): string {
  return generateId('tsv');
}

// ── Datasets ──
export function datasetId(): string {
  return generateId('ds');
}
export function datasetVersionId(): string {
  return generateId('dsv');
}

// ── Generation ──
export function generationJobId(): string {
  return generateId('gj');
}
export function draftId(): string {
  return generateId('draft');
}

// ── Execution ──
export function runId(): string {
  return generateId('run');
}
export function eventId(): string {
  return generateId('evt');
}

// ── Runner ──
export function runnerId(): string {
  return generateId('rnr');
}

// ── Policy ──
export function policyId(): string {
  return generateId('pol');
}
