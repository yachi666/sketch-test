/** Live tenant isolation acceptance. Requires an owner session and report-e2e evidence. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const base = process.env.REPORT_CP_URL ?? 'http://127.0.0.1:3802';
const evidencePath = process.env.REPORT_EVIDENCE_PATH ?? '/tmp/sketchtest-report-evidence.json';
const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
const session = process.env.REPORT_TOKEN
  ? { token: process.env.REPORT_TOKEN }
  : await fetch(`${base}/api/auth/guest`, { method: 'POST' }).then((r) => r.json());
const email = `isolation-${Date.now()}@example.invalid`;
const password = randomUUID();
const createdResponse = await fetch(`${base}/api/workspaces`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: `隔离验收 ${Date.now()}`,
    ownerEmail: email,
    ownerPassword: password,
  }),
});
assert.equal(createdResponse.status, 201);
const created = await createdResponse.json();
const loginResponse = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ workspaceId: created.workspace.id, email, password }),
});
assert.equal(loginResponse.status, 200);
const login = await loginResponse.json();
const headers = { Authorization: `Bearer ${login.token}` };
const list = await fetch(`${base}/api/runs`, { headers }).then((r) => r.json());
assert.equal(list.total, 0);
assert.equal(list.summary.total, 0);
assert.equal(list.runs.length, 0);
const foreign = await fetch(`${base}/api/runs/${evidence.failedRun}/report`, { headers });
assert.equal(foreign.status, 404);
const invalid = await fetch(`${base}/api/runs`);
assert.equal(invalid.status, 401);
evidence.checks.push(
  'live cross-workspace list and summary isolation',
  'foreign report returns 404',
  'anonymous list returns 401',
);
evidence.checks = [...new Set(evidence.checks)];
await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
console.log(
  'PASS live PostgreSQL workspace isolation: empty list/counts, foreign report 404, anonymous 401',
);
