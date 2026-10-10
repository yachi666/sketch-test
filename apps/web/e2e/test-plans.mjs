/** Mock-backed browser regression for the Control Plane test-plan surface. */

import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const webUrl = process.env.WEB_URL ?? 'http://127.0.0.1:5173';
const outputDir = process.env.E2E_OUTPUT_DIR ?? '/tmp';

const suite = {
  id: 'suite-1',
  workspaceId: 'ws-1',
  name: '主干合并门禁',
  description: '保护下单、支付与履约主链路',
  createdAt: '2026-07-01T08:00:00.000Z',
  updatedAt: '2026-07-14T08:00:00.000Z',
};
const version = {
  id: 'suite-version-3',
  testSuiteId: suite.id,
  version: 3,
  members: [
    { type: 'workflow', id: 'workflow-1' },
    { type: 'test', id: 'test-1' },
  ],
  qualityGate: {
    requiredWorkflows: ['workflow-1'],
    noNewFailures: true,
    maxFlakyRetries: 2,
    minEndpointCoverage: 80,
    requiredTags: ['critical', 'smoke'],
    blockOnInfraError: true,
  },
  createdAt: '2026-07-14T08:00:00.000Z',
};

function payloadFor(url, method) {
  const path = new URL(url).pathname;
  if (path === '/api/plan-suggestions') return { jobs: [], settings: { enabled: false } };
  if (path === '/api/auth/me') return { user: session.user };
  if (path === '/api/test-suites' && method === 'GET') return { testSuites: [suite] };
  if (path === '/api/test-suites/suite-1/versions') return { versions: [version] };
  if (path === '/api/test-suites/suite-1') {
    return { testSuite: suite, latestVersion: version };
  }
  if (path === '/api/schedules') {
    return {
      schedules: [
        {
          id: 'schedule-1',
          workspaceId: 'ws-1',
          testSuiteId: suite.id,
          cronExpression: '0 9 * * 1-5',
          environmentId: null,
          enabled: true,
          createdAt: '2026-07-14T08:00:00.000Z',
        },
      ],
    };
  }
  if (path === '/api/test-cases') {
    return {
      testCases: [
        {
          id: 'test-1',
          workspaceId: 'ws-1',
          name: '支付金额边界',
          description: '验证金额边界与错误语义',
          apiVersionId: null,
          createdAt: '2026-07-01T08:00:00.000Z',
          updatedAt: '2026-07-14T08:00:00.000Z',
        },
      ],
    };
  }
  if (path === '/api/workflows') {
    return {
      workflows: [
        {
          id: 'workflow-1',
          workspaceId: 'ws-1',
          name: '支付成功链路',
          description: '下单、支付与确认',
          createdAt: '2026-07-01T08:00:00.000Z',
          updatedAt: '2026-07-14T08:00:00.000Z',
        },
      ],
    };
  }
  return null;
}

await mkdir(outputDir, { recursive: true });
const browserErrors = [];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const session = {
  token: 'browser-test-token',
  user: {
    id: 'user-1',
    email: 'owner@example.com',
    displayName: 'Owner',
    role: 'owner',
    workspaceId: 'ws-1',
  },
};
await context.addInitScript({
  content: `localStorage.setItem('sketchtest.auth.v1', ${JSON.stringify(JSON.stringify(session))});`,
});
await context.route('http://localhost:3802/api/**', async (route) => {
  const payload = payloadFor(route.request().url(), route.request().method());
  await route.fulfill({
    status: payload ? 200 : 404,
    contentType: 'application/json',
    body: JSON.stringify(payload ?? { message: 'not mocked' }),
  });
});

const page = await context.newPage();
page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error}`));
page.on('console', (message) => {
  if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
});

await page.goto(`${webUrl}/plans`);
await page.getByRole('button', { name: '已发布计划', exact: true }).click();
await page.waitForLoadState('networkidle');
try {
  await page.getByText('当前不可变版本', { exact: true }).waitFor({ timeout: 5000 });
} catch (error) {
  await page.screenshot({ path: `${outputDir}/test-plans-inspect.png`, fullPage: true });
  const headings = await page.getByRole('heading').allTextContents();
  const mainText = await page
    .locator('main')
    .innerText()
    .catch(() => 'main missing');
  throw new Error(
    `test-plan page did not hydrate: ${JSON.stringify({ headings, mainText, browserErrors })}`,
    { cause: error },
  );
}
if (!(await page.getByText('至少 80%', { exact: true }).isVisible())) {
  throw new Error('quality gate threshold is not visible');
}
if (!(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))) {
  throw new Error('desktop layout has horizontal overflow');
}
await page.screenshot({ path: `${outputDir}/test-plans-desktop.png`, fullPage: true });

await page.getByRole('button', { name: '新建测试计划' }).click();
await page.getByRole('dialog', { name: '创建测试计划' }).waitFor();
if (!(await page.getByRole('checkbox', { name: /支付成功链路/ }).isVisible())) {
  throw new Error('workflow member selector is not visible');
}
await page.screenshot({ path: `${outputDir}/test-plans-editor.png`, fullPage: true });
await page.getByRole('button', { name: '关闭计划编辑器' }).click();

await page.setViewportSize({ width: 390, height: 844 });
await page.reload();
await page.waitForLoadState('networkidle');
await page.getByText('当前不可变版本', { exact: true }).waitFor();
if (!(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))) {
  throw new Error('mobile layout has horizontal overflow');
}
await page.screenshot({ path: `${outputDir}/test-plans-mobile.png`, fullPage: true });
await browser.close();

if (browserErrors.length > 0) throw new Error(browserErrors.join('\n'));
console.log('PASS: desktop, editor, and mobile test-plan states verified');
console.log(`SCREENSHOTS: ${outputDir}/test-plans-*.png`);
