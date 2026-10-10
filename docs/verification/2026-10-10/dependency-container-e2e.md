# Dependency upgrade: container and product E2E

Date: 2026-10-10 (Asia/Shanghai)

## Result

All validation below passed after updating two stale browser route checks and
fixing test-process cleanup for pnpm 12. No application behavior needed changing.

| Check | Result |
| --- | --- |
| `pnpm e2e:compose` | Passed; clean frozen-lockfile image builds, PostgreSQL/MinIO/Control Plane/Web/Runner startup, readiness, authentication, Runner registration and heartbeat |
| `E2E_MANAGED_POSTGRES=1 pnpm e2e:product` | Passed; containerized PostgreSQL/MinIO, production Node services and Web build, real Runner, CLI and Chromium browser acceptance |
| AI Worker production image | Built successfully using its Dockerfile and pnpm 12.10.1 |
| AI Worker inside its production image | Passed actual Pi 1.1.0 draft and plan loops with a deterministic provider stream, pending-only output and turn limits; read-only filesystem, 1 GiB memory limit, network disabled |
| Modified E2E scripts | Biome check passed |

The product E2E uses PostgreSQL and MinIO in Docker, with Control Plane, Runner,
fixture server and Web preview as local production processes. The separate
Compose check validates the packaged application services in Docker. AI model
transport was simulated; no external model requests or charges were incurred.

## Evidence

Compose created an isolated project and reported all five runtime services online:
`control-plane`, `minio`, `postgres`, `runner`, `web`. Runner heartbeat was persisted.

Product acceptance reported:

- 9 imported endpoints.
- Run `run_7cf6ba49` passed.
- 6 execution events, all 6 externalized to S3.
- PostgreSQL backup/restore retained the passed run and all 4 migrations.
- All 9 source, event and manifest objects restored with matching SHA-256 hashes.
- Browser import handoff, session reload, nine navigation routes, AI/published
  plan views, variable-source interactions, workflow endpoint picker and report
  evidence flow passed.
- Browser console errors: **0**.

AI Worker container used Node 24.16.0 and Pi 1.1.0. The official DeepSeek provider
catalog resolved `deepseek-flash`. Deterministic streams exercised the real Pi
agent loop and tool validation without outbound network access.

## Fixes made during verification

1. Import Center now identifies its source panel using `aria-labelledby`; its
   old `aria-label="导入 OpenAPI"` selector was stale. Updated the E2E locator to
   the actual panel.
2. Test Plans opens the AI workbench by default. The E2E now verifies this view,
   then explicitly opens “已发布计划” and verifies the published-plan summary.
3. pnpm 12's wrapper processes left Vite and fixture descendants running after
   their immediate parent was stopped. The E2E now starts the compiled fixture
   and Vite entry point with Node directly, allowing existing cleanup to terminate
   the actual services. The successful rerun exited normally.

Temporary test containers, volumes, images and leaked processes from the failed
attempts were cleaned up. Existing user containers were retained. The local Web
build was restored without the temporary E2E Control Plane URL.
