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

## 提交与云端冷启动复验

首次 GitHub CI 冷启动发现 Docker Hub 的 `minio/minio`、`minio/mc` 原镜像已无法公开拉取；Quay 的原 client 镜像同样返回未授权。本机之前的镜像缓存没有暴露此问题。

`ops/minio/Dockerfile` 现从官方源码构建相同版本，使用 SHA-256 校验下载的源码归档，并保留上游许可证及来源/提交标签。Compose 与产品 E2E 使用该构建。产品 E2E 的镜像构建在主流程执行，对托管和外部 PostgreSQL 两种模式均生效。

- 本地两个镜像源码构建成功。
- 本地 Compose 复验：`sketchtest-smoke-27187-1791612610820`，5 个服务运行，Runner `rnr_bf37587b` 心跳通过；临时服务/卷已清理。
- 本地产品复验：Run `run_2bb7b8d1`，9 个接口、6/6 事件外置、4 个迁移、9/9 对象恢复校验通过；浏览器报告证据链通过，console errors = 0。
- GitHub 运行 [38029864232](https://github.com/yachi666/sketch-test/actions/runs/38029864232) 的源码镜像 Compose 冷启动已通过。该轮产品脚本的变量作用域问题随后修正，并以上述本地产品复验确认；最终提交仍须以对应 GitHub CI 为准。

上游构建说明：[MinIO source build](https://github.com/minio/minio#build-docker-image)。
