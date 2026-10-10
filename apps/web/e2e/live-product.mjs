import { chromium, expect } from '@playwright/test';

const requiredEnvironment = [
  'E2E_WEB_URL',
  'E2E_CP_URL',
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
const controlPlaneUrl = process.env['E2E_CP_URL'];
const runId = process.env['E2E_RUN_ID'];
const consoleErrors = [];
const browser = await chromium.launch({ headless: true });

try {
  const loginResponse = await fetch(`${controlPlaneUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workspaceId: process.env['E2E_WORKSPACE_ID'],
      email: process.env['E2E_OWNER_EMAIL'],
      password: process.env['E2E_OWNER_PASSWORD'],
    }),
  });
  if (!loginResponse.ok) {
    throw new Error(
      `Could not provision the browser session: ${loginResponse.status} ${await loginResponse.text()}`,
    );
  }
  const session = await loginResponse.json();
  if (!session?.token || !session?.user?.workspaceId) {
    throw new Error(
      `Control Plane returned an invalid browser session: ${JSON.stringify(session)}`,
    );
  }

  // Persist the source through the real API so the variable drawer is verified against
  // workflow data, not an example row that only existed in the original prototype.
  const post = async (path, body) => {
    const response = await fetch(`${controlPlaneUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Browser setup ${path}: ${response.status} ${await response.text()}`);
    }
    return response.json();
  };
  const { workflow } = await post('/api/workflows', {
    workspaceId: session.user.workspaceId,
    name: '变量来源验收',
  });
  await post(`/api/workflows/${workflow.id}/versions`, {
    definition: {
      name: '变量来源验收',
      steps: [
        {
          id: 'health',
          name: '旧版健康检查',
          method: 'GET',
          url: `${process.env['E2E_FIXTURE_URL']}/health`,
          extract: [
            { name: 'obsolete_status', source: 'body', expression: '$.old', scope: 'workflow' },
          ],
        },
      ],
    },
  });
  const { version } = await post(`/api/workflows/${workflow.id}/versions`, {
    definition: {
      name: '变量来源验收',
      steps: [
        {
          id: 'health',
          name: '读取服务健康',
          method: 'GET',
          url: `${process.env['E2E_FIXTURE_URL']}/health`,
          extract: [
            { name: 'service_status', source: 'body', expression: '$.status', scope: 'workflow' },
          ],
          assertions: [{ target: 'status', operator: 'equals', expected: 200 }],
        },
      ],
    },
  });
  await post(`/api/workflow-versions/${version.id}/publish`, { publishedBy: 'browser-e2e' });

  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(
    ({ storageKey, value }) => {
      window.localStorage.setItem(storageKey, JSON.stringify(value));
    },
    { storageKey: 'sketchtest.auth.v1', value: session },
  );
  const waitForShellTitle = async (title, timeout = 60_000) => {
    await page.locator('.topbar-page-name').filter({ hasText: title }).waitFor({ timeout });
  };
  page.on('console', (message) => {
    // Optional Google Fonts are not part of the product runtime and may time out in isolated CI.
    // API and application errors still fail the evidence assertions below or are retained here.
    if (
      message.type() === 'error' &&
      !message.text().startsWith('Failed to load resource: net::ERR_TIMED_OUT')
    ) {
      consoleErrors.push(message.text());
    }
  });
  page.on('response', (response) => {
    if (response.url().endsWith('/api/auth/me')) {
      console.log(`auth-me ${response.status()}`);
    }
  });

  // Browser login has been removed. The legacy route must resolve to the product dashboard, while
  // the externally provisioned session keeps authenticated Control Plane requests working.
  console.log('browser-removed-login-route');
  await page.goto(`${baseUrl}/login`, { waitUntil: 'commit' });
  await waitForShellTitle('工作台');
  if (await page.getByRole('heading', { name: '登录工作区' }).count()) {
    throw new Error('The removed login form is still rendered');
  }

  await page.getByRole('button', { name: '接口管理', exact: true }).click();
  try {
    await waitForShellTitle('接口管理');
    await page.locator('.api-catalog-v2').waitFor({ timeout: 60_000 });
  } catch (reason) {
    const pageState = await page.evaluate(() => ({
      url: location.href,
      shellTitle: document.querySelector('.topbar-page-name')?.textContent?.trim(),
      headings: Array.from(document.querySelectorAll('h1, h2, h3')).map((heading) => ({
        text: heading.textContent?.trim(),
        display: getComputedStyle(heading).display,
        visibility: getComputedStyle(heading).visibility,
      })),
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((alert) =>
        alert.textContent?.trim(),
      ),
    }));
    throw new Error(`API catalog is not visible: ${JSON.stringify(pageState)}`, {
      cause: reason,
    });
  }

  // The catalog is a read-only projection of the persisted immutable API version.
  // Its import affordance must lead to the actual Control Plane import screen, not a browser-only
  // success simulation.
  console.log('browser-api-import-handoff');
  await page.getByRole('button', { name: '导入文档' }).click();
  await waitForShellTitle('导入中心');
  await page.getByRole('heading', { name: '从 URL 导入 OpenAPI' }).waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: '接口管理', exact: true }).click();
  await waitForShellTitle('接口管理');
  await page.locator('.api-catalog-v2').waitFor({ timeout: 60_000 });

  // A product session must also survive a full document reload, not merely in-app navigation.
  // This exercises the auth state restored from browser storage on a fresh application instance.
  console.log('browser-session-reload');
  await page.reload({ waitUntil: 'commit' });
  await waitForShellTitle('接口管理');
  await page.locator('.api-catalog-v2').waitFor({ timeout: 60_000 });

  // Route smoke checks run in the same authenticated browser session. They verify that a route
  // presents its own shell identity and core content rather than falling back to the dashboard.
  for (const [navigation, title, coreSelector] of [
    ['工作台', '工作台', 'section[aria-label="质量指标"]'],
    ['业务流程', '业务流程', 'section[aria-label="业务流程列表"]'],
    ['接口管理', '接口管理', '.api-catalog-v2'],
    ['导入中心', '导入中心', 'section[aria-labelledby="intake-source-title"]'],
    ['用例管理', '用例管理', 'main[aria-label="用例管理"]'],
    ['测试计划', '测试计划', 'section[aria-label="与 AI 调整计划"]'],
    ['环境管理', '环境管理', '.page-actions-row .button--primary'],
    ['变量管理', '变量管理', '[role="table"][aria-label="变量列表"]'],
    ['智能生成', '智能生成', 'section[aria-label="创建生成任务"]'],
  ]) {
    console.log(`browser-route-check ${navigation}`);
    await page.getByRole('button', { name: navigation, exact: true }).click();
    try {
      await waitForShellTitle(title, 20_000);
      await page.locator(coreSelector).waitFor({ timeout: 20_000 });
      if (navigation === '测试计划') {
        await page.getByRole('button', { name: '已发布计划', exact: true }).click();
        await page.getByRole('region', { name: '测试计划摘要' }).waitFor({ timeout: 20_000 });
      }
    } catch (reason) {
      const pageState = await page.evaluate(() => ({
        url: location.href,
        shellTitle: document.querySelector('.topbar-page-name')?.textContent?.trim(),
        headings: Array.from(document.querySelectorAll('h1, h2, h3')).map((item) =>
          item.textContent?.trim(),
        ),
        main: document.querySelector('main')?.textContent?.trim().slice(0, 500),
      }));
      throw new Error(`Route ${navigation} did not render ${title}: ${JSON.stringify(pageState)}`, {
        cause: reason,
      });
    }
  }

  console.log('browser-variable-interactions');
  await page.getByRole('button', { name: '变量管理', exact: true }).click();
  await page.getByRole('tab', { name: '接口取值' }).click();
  await page.getByRole('button', { name: '读取服务健康 · body' }).click();
  await page.getByRole('heading', { name: 'service_status' }).waitFor();
  await expect(page.getByRole('textbox', { name: '当前引用', exact: true })).toHaveValue(
    '$.status',
  );
  await expect(
    page.getByRole('table', { name: '变量列表' }).getByText('obsolete_status'),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '关闭详情' }).click();
  await page.getByRole('button', { name: '新增 Secret' }).click();
  await page.getByRole('heading', { name: '新增 Secret' }).waitFor();
  await page.getByRole('button', { name: '取消' }).click();

  // Workflow authoring obtains endpoint choices from the persisted API catalog as well.
  console.log('browser-workflow-catalog-picker');
  await page.getByRole('button', { name: '业务流程', exact: true }).click();
  await page.getByRole('button', { name: /Execute a structured search/ }).click();
  await page.getByRole('button', { name: '添加步骤' }).click();
  await page.getByRole('heading', { name: '选择接口' }).waitFor();
  await page.locator('.endpoint-picker-item').nth(1).waitFor();
  await page.getByRole('button', { name: '关闭' }).click();

  // The readiness checks below wait for actual application content. Do not couple them to the
  // Vite dev client's document lifecycle, which can remain pending while it reconnects HMR.
  await page.getByRole('button', { name: '报告中心', exact: true }).click();
  await waitForShellTitle('报告中心');
  await page.locator('section[aria-label="运行报告列表"]').waitFor({ timeout: 60_000 });
  await page.getByRole('textbox', { name: '搜索运行或业务名称' }).fill(runId);
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByText(runId, { exact: true }).waitFor();
  await page
    .getByRole('row')
    .filter({ hasText: runId })
    .getByRole('button', { name: /查看 .* 的证据/ })
    .click();
  await page.locator('.scenario-report-detail__header').getByText(runId, { exact: true }).waitFor();
  await page.getByRole('heading', { name: '执行过程' }).waitFor();

  if (consoleErrors.length > 0) {
    throw new Error(`Browser console errors: ${JSON.stringify(consoleErrors)}`);
  }
  console.log(JSON.stringify({ ok: true, reportEvidenceFlow: true, consoleErrors: 0 }));
} finally {
  await browser.close();
}
