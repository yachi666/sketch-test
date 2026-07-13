import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


base_url = os.environ["E2E_WEB_URL"]
run_id = os.environ["E2E_RUN_ID"]
workspace_id = os.environ["E2E_WORKSPACE_ID"]
owner_email = os.environ["E2E_OWNER_EMAIL"]
owner_password = os.environ["E2E_OWNER_PASSWORD"]
fixture_url = os.environ["E2E_FIXTURE_URL"]
errors: list[str] = []
screenshot = Path(os.environ.get("E2E_SCREENSHOT", "/tmp/sketchtest-web-e2e.png"))

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)

    page.goto(f"{base_url}/login")
    page.get_by_label("Workspace ID").fill(workspace_id)
    page.get_by_label("邮箱").fill(owner_email)
    page.get_by_label("密码").fill(owner_password)
    page.get_by_role("button", name="登录").click()
    page.wait_for_url(f"{base_url}/apis")
    page.wait_for_load_state("networkidle")
    page.get_by_role("heading", name="接口资产").wait_for()
    page.get_by_text("openapi.json", exact=False).wait_for()

    page.goto(f"{base_url}/runs")
    page.wait_for_load_state("networkidle")
    page.get_by_role("heading", name="运行与报告").wait_for()
    page.get_by_text(run_id, exact=True).wait_for()
    page.get_by_role("button", name="查看报告").first.click()
    page.get_by_label("运行报告").wait_for()
    page.get_by_text("step.finished", exact=True).wait_for()

    page.goto(f"{base_url}/workflows")
    page.wait_for_load_state("networkidle")
    page.get_by_role("heading", name="流程执行").wait_for()
    page.get_by_label("流程名称").fill("Browser-published workflow")
    page.get_by_label("WorkflowDefinition JSON").fill(
        json.dumps(
            {
                "schemaVersion": "1.0.0",
                "name": "Browser-published workflow",
                "steps": [
                    {
                        "id": "health",
                        "name": "Health",
                        "method": "GET",
                        "url": f"{fixture_url}/health",
                        "assertions": [{"target": "status", "operator": "equals", "expected": 200}],
                    }
                ],
                "teardown": [],
            }
        )
    )
    page.get_by_role("button", name="发布并运行").click()
    page.get_by_text("Plan SHA-256", exact=True).wait_for()
    page.locator(".result-grid").get_by_text("run_", exact=False).wait_for()
    page.screenshot(path=str(screenshot), full_page=True)
    browser.close()

if errors:
    raise RuntimeError(f"Browser console errors: {errors}")

print(
    json.dumps(
        {
            "ok": True,
            "mutatingWorkflowFlow": True,
            "screenshot": str(screenshot),
            "consoleErrors": 0,
        }
    )
)
