import { chromium } from '@playwright/test';

const requiredEnvironment = [
  'E2E_WEB_URL',
  'E2E_RUN_ID',
  'E2E_WORKSPACE_ID',
  'E2E_OWNER_EMAIL',
  'E2E_OWNER_PASSWORD',
  'E2E_FIXTURE_URL',
];
for (const name of requiredEnvironment) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const baseUrl = process.env['E2E_WEB_URL'];
const runId = process.env['E2E_RUN_ID'];
const screenshot = process.env['E2E_SCREENSHOT'] ?? '/tmp/sketchtest-web-e2e.png';
const consoleErrors = [];
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('Workspace ID').fill(process.env['E2E_WORKSPACE_ID']);
  await page.getByLabel('邮箱').fill(process.env['E2E_OWNER_EMAIL']);
  await page.getByLabel('密码').fill(process.env['E2E_OWNER_PASSWORD']);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL(`${baseUrl}/apis`);
  await page.getByRole('heading', { name: '接口资产' }).waitFor();
  await page.getByText('openapi.json', { exact: false }).waitFor();

  await page.goto(`${baseUrl}/runs`);
  await page.getByRole('heading', { name: '运行与报告' }).waitFor();
  await page.getByText(runId, { exact: true }).waitFor();
  await page.getByRole('button', { name: '查看报告' }).first().click();
  await page.getByLabel('运行报告').waitFor();
  await page.getByText('step.finished', { exact: true }).waitFor();

  await page.goto(`${baseUrl}/workflows`);
  await page.getByRole('heading', { name: '流程执行' }).waitFor();
  await page.getByLabel('流程名称').fill('Browser-published workflow');
  await page.getByLabel('WorkflowDefinition JSON').fill(
    JSON.stringify({
      schemaVersion: '1.0.0',
      name: 'Browser-published workflow',
      steps: [
        {
          id: 'health',
          name: 'Health',
          method: 'GET',
          url: `${process.env['E2E_FIXTURE_URL']}/health`,
          assertions: [{ target: 'status', operator: 'equals', expected: 200 }],
        },
      ],
      teardown: [],
    }),
  );
  await page.getByRole('button', { name: '发布并运行' }).click();
  await page.getByText('Plan SHA-256', { exact: true }).waitFor();
  await page.locator('.result-grid').getByText('run_', { exact: false }).waitFor();
  await page.screenshot({ path: screenshot, fullPage: true });

  if (consoleErrors.length > 0) {
    throw new Error(`Browser console errors: ${JSON.stringify(consoleErrors)}`);
  }
  console.log(JSON.stringify({ ok: true, mutatingWorkflowFlow: true, consoleErrors: 0 }));
} finally {
  await browser.close();
}
