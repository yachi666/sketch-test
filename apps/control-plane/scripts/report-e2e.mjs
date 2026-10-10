/** Live acceptance: CP + PostgreSQL + independent Runner must already be running.
 * Uses only read-only public HTTP calls and an explicitly configured local fixture.
 * REPORT_CP_URL defaults to localhost; REPORT_FIXTURE_URL defaults to local fixture.
 * Authenticate with REPORT_TOKEN or a locally configured QA guest session.
 */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const cp = process.env.REPORT_CP_URL ?? 'http://127.0.0.1:3802';
const fixture = process.env.REPORT_FIXTURE_URL ?? 'http://127.0.0.1:3800';
let token = process.env.REPORT_TOKEN;
async function api(path, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(`${cp}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  assert(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(result)}`);
  return result;
}
if (!token) token = (await api('/api/auth/guest', {})).token;
assert(token, 'Configure REPORT_TOKEN or a QA guest session');
const { user } = await api('/api/auth/me');
const stamp = new Date().toISOString();
const statusAssertion = {
  target: 'status',
  operator: 'equals',
  expected: 200,
  description: 'HTTP 状态为 200',
};
async function publish(name, steps, teardown) {
  const { workflow } = await api('/api/workflows', {
    workspaceId: user.workspaceId,
    name,
    description: `报告验收 ${stamp}`,
  });
  const { version } = await api(`/api/workflows/${workflow.id}/versions`, {
    definition: { name, steps, ...(teardown ? { teardown } : {}) },
  });
  const published = await api(`/api/workflow-versions/${version.id}/publish`, {});
  assert(published.published);
  return version.id;
}
async function start(workflowVersionId) {
  return (await api('/api/runs/from-workflow', { workflowVersionId })).runId;
}
async function finish(runId) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const report = await api(`/api/runs/${runId}/report`);
    if (!['pending', 'claimed', 'running', 'queued', 'leased'].includes(report.run.status))
      return report;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Runner did not finish ${runId}`);
}
const publicStep = {
  id: 'repository',
  name: '读取 Node.js 公开仓库',
  method: 'GET',
  url: 'https://api.github.com/repos/nodejs/node',
  headers: { Accept: 'application/vnd.github+json' },
  maxRetries: 0,
  timeoutMs: 20000,
  onFailure: 'stop',
  assertions: [
    statusAssertion,
    {
      target: 'jsonPath',
      path: '$.full_name',
      operator: 'equals',
      expected: 'nodejs/node',
      description: '仓库标识符合公开事实',
    },
  ],
};
const publicVersion = await publish('公开仓库 · 元数据回归', [publicStep]);
const publicRun = await start(publicVersion);
const publicReport = await finish(publicRun);
assert.equal(publicReport.run.status, 'passed', 'Real GitHub metadata request must pass');
assert(publicReport.steps[0].assertions.every((item) => item.passed));
console.log('PASS public read-only API:', publicRun);
const failVersion = await publish(
  '公开仓库 · 失败定位验收',
  [
    {
      ...publicStep,
      assertions: [
        statusAssertion,
        {
          target: 'jsonPath',
          path: '$.full_name',
          operator: 'equals',
          expected: 'intentionally-wrong',
          description: '故意设置错误预期，验证失败定位',
        },
      ],
    },
    {
      id: 'after',
      name: '失败后不再执行',
      method: 'GET',
      url: `${fixture}/health`,
      assertions: [statusAssertion],
    },
  ],
  [
    {
      id: 'cleanup',
      name: '清理阶段连通性检查',
      method: 'GET',
      url: `${fixture}/health`,
      maxRetries: 0,
    },
  ],
);
const failedRun = await start(failVersion);
const failedReport = await finish(failedRun);
assert.equal(failedReport.run.status, 'failed');
assert.equal(failedReport.steps[0].name, '读取 Node.js 公开仓库');
assert.equal(failedReport.steps[0].status, 'failed');
assert.equal(failedReport.steps[1].status, 'not_run');
assert.equal(failedReport.steps[2].status, 'passed');
assert.equal(failedReport.steps[2].phase, 'teardown');
assert(
  failedReport.steps[0].assertions.some(
    (item) => item.passed === false && item.actual.includes('nodejs/node'),
  ),
);
console.log('PASS failed assertion, stopped step, independent cleanup:', failedRun);
const batchVersion = await publish(`历史分页验收 ${stamp}`, [
  {
    id: 'health',
    name: '本地服务连通性',
    method: 'GET',
    url: `${fixture}/health`,
    assertions: [statusAssertion],
  },
]);
const batch = [];
for (let i = 0; i < 55; i++) batch.push(await start(batchVersion));
await finish(batch.at(-1));
const q = encodeURIComponent(`历史分页验收 ${stamp}`);
const first = await api(`/api/runs?q=${q}&pageSize=20`);
const third = await api(`/api/runs?q=${q}&pageSize=20&page=3`);
assert.equal(first.total, 55);
assert.equal(first.summary.passed, 55);
assert.equal(third.runs.length, 15);
assert(!third.runs.some((run) => first.runs.some((other) => other.id === run.id)));
const zero = await api(`/api/runs?q=${q}&page=99`);
assert.equal(zero.total, 55);
assert.equal(zero.runs.length, 0);
const attention = await api('/api/runs?status=attention');
assert(attention.runs.some((run) => run.id === failedRun));
const literal = await api('/api/runs?q=%25');
assert.equal(literal.total, 0, 'Search treats % literally');
for (const query of ['page=0', 'pageSize=101', 'days=-1', 'status=bogus']) {
  const response = await fetch(`${cp}/api/runs?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 400);
}
console.log('PASS 55 real Runner executions, pagination, totals, literal search, invalid filters');
const evidence = {
  verifiedAt: new Date().toISOString(),
  workspaceId: user.workspaceId,
  publicRun,
  failedRun,
  batchRuns: batch,
  summary: first.summary,
  checks: [
    'public GitHub HTTP + JSON assertion',
    'intentional failure with real response',
    'stop-on-failure evidence',
    'separate cleanup evidence',
    '55 real HTTP runs',
    'search and stable pagination',
    'empty page retains totals',
    'input validation',
  ],
};
const output = process.env.REPORT_EVIDENCE_PATH ?? '/tmp/sketchtest-report-evidence.json';
await writeFile(output, JSON.stringify(evidence, null, 2));
console.log(`Evidence saved: ${output}`);
