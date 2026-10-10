# SketchTest Operations Runbook

This runbook covers the supported single-node Docker Compose deployment. Use
managed PostgreSQL and S3 services when high availability is required.

## Prerequisites

- Docker Engine with Compose v2
- `curl`; `jq` is recommended for provisioning commands
- DNS/TLS reverse proxy for externally reachable deployments
- Independent random values of at least 32 characters for every application secret

Copy `.env.example` to `.env`, replace every credential, and set browser-facing
origins and URLs. Generate independent values with `openssl rand -hex 32`.
Never reuse `JWT_SECRET`, `SECRET_KEY`, or `RUNNER_REGISTRATION_TOKEN`.
Production CORS requires exact `WEB_ORIGINS`.
Production API-description imports require an explicit comma-separated
`IMPORT_ALLOWED_HOSTS` list. Entries may be a hostname (all ports) or an exact
`host:port`; every redirect target is checked against the same list. Keep the
list narrow and prefer HTTPS sources controlled by your organization.

## Pre-release verification

Run the release gates from a clean checkout with Docker available:

```bash
pnpm install --frozen-lockfile
pnpm turbo run lint check test build --force
E2E_MANAGED_POSTGRES=1 pnpm e2e:product
pnpm e2e:compose
```

The product E2E starts a disposable PostgreSQL 18 container when
`E2E_MANAGED_POSTGRES=1`; without it, the command expects local PostgreSQL
client tools and a reachable local server. The Compose smoke uses a unique
project, ports, credentials, images, and volumes; it proves Control Plane and
Web health plus an independently authenticated Runner heartbeat, then removes
its disposable resources even on failure.

The product path imports OpenAPI 3.2 from an allowlisted URL, binds an Arazzo
1.1 workflow to that immutable `ApiVersion`, publishes its `WorkflowVersion`,
executes `QUERY` through an independent Runner, and verifies recovery of both
raw sources plus execution evidence. See
[`OPENAPI_COMPATIBILITY.md`](OPENAPI_COMPATIBILITY.md) for the exact supported
subset and fail-closed diagnostics.

## Deploy

```bash
docker compose config -q
docker compose up -d --build postgres minio minio-init control-plane web
curl --fail http://127.0.0.1:3802/ready
curl --fail http://127.0.0.1:8080/health/live
```

Create the first workspace with explicit owner credentials (this unauthenticated
bootstrap route closes after the first workspace exists):

```bash
curl --fail --request POST http://127.0.0.1:3802/api/workspaces \
  --header 'Content-Type: application/json' \
  --data '{"name":"Production","ownerEmail":"owner@example.com","ownerPassword":"replace-with-a-strong-password"}'
```

Put the returned ID in `.env` as `WORKSPACE_ID`. Log in with that workspace ID
and retain the JWT for operator API calls:

```bash
curl --fail --request POST http://127.0.0.1:3802/api/auth/login \
  --header 'Content-Type: application/json' \
  --data '{"workspaceId":"ws_REPLACE","email":"owner@example.com","password":"replace-with-a-strong-password"}'
```

Provision a stable Runner credential once, then put the returned `id` and
`token` in `.env` as `RUNNER_ID` and `RUNNER_TOKEN` before starting Runner:

```bash
curl --fail --request POST http://127.0.0.1:3802/api/runners/register \
  --header 'Content-Type: application/json' \
  --header "x-runner-registration-token: ${RUNNER_REGISTRATION_TOKEN}" \
  --data '{"workspaceId":"ws_REPLACE","name":"runner-production","version":"REPLACE"}'
```

```bash
docker compose --profile runner up -d --build runner
curl --fail "http://127.0.0.1:3802/api/runners?workspaceId=${WORKSPACE_ID}" \
  --header "Authorization: Bearer ${SKETCHTEST_TOKEN}"
```

Production registration requires `RUNNER_REGISTRATION_TOKEN`; its issued
Runner token is never written to logs. Rotate or remove the registration token
from the Runner environment after provisioning long-lived credentials and
restrict registration at the network layer where possible. Compose can use the
registration token directly for disposable runners, but each restart then
creates a new Runner identity.

## Verify and observe

```bash
curl --fail http://127.0.0.1:3802/health/live
curl --fail http://127.0.0.1:3802/ready
curl --fail http://127.0.0.1:3802/metrics
docker compose ps
docker compose logs --since 10m control-plane runner
```

- `/health/live` proves only process liveness.
- `/ready` requires PostgreSQL and object storage.
- `/metrics` exposes Prometheus counters with normalized route labels.
- `x-request-id` is returned and persisted on sensitive audit events.
- Run evidence carries the W3C trace ID injected into the tested request.

Load [`../ops/prometheus/alerts.yml`](../ops/prometheus/alerts.yml) into a
Prometheus-compatible alert manager.

## Backup

```bash
mkdir -p backups
docker compose exec -T postgres pg_dump -U sketchtest -Fc sketchtest > backups/sketchtest.dump
```

Back up the S3 bucket with provider versioning/replication. For bundled MinIO,
use `mc mirror` to encrypted off-host storage. A database backup without the
matching object bucket is incomplete: raw sources, large events, and immutable
manifests are stored there. Record the image tag, PostgreSQL major version,
backup timestamp, and bucket checkpoint together.

## Restore drill

Stop writers and restore PostgreSQL into an empty database:

```bash
docker compose --profile runner stop runner control-plane
docker compose exec postgres dropdb -U sketchtest --if-exists sketchtest_restore
docker compose exec postgres createdb -U sketchtest sketchtest_restore
docker compose cp backups/sketchtest.dump postgres:/tmp/sketchtest.dump
docker compose exec postgres pg_restore -U sketchtest -d sketchtest_restore /tmp/sketchtest.dump
docker compose exec postgres psql -U sketchtest -d sketchtest_restore -c '\dt'
```

Restore the matching object checkpoint, point a disposable Control Plane at
both restored services, require `/ready`, retrieve a known manifest, and run
its integrity endpoint. `E2E_MANAGED_POSTGRES=1 pnpm e2e:product` automates a
local drill: it dumps the live test database into an empty database, verifies
the completed Run and `schema_migrations`, mirrors every evidence object into
a recovery bucket, and compares SHA-256 content.

## Upgrade and rollback

1. Back up PostgreSQL and object storage.
2. Set `SKETCHTEST_VERSION` to an immutable release tag.
3. Deploy Control Plane without Runner and wait for `/ready`.
4. Restart Runner and run `pnpm e2e:product` in staging.

Migrations are checksummed, serialized with a PostgreSQL advisory lock, and
applied transactionally before traffic is accepted. Applied identities are
immutable and a failed migration rolls back. Roll back application code by
setting the previous immutable image tag and redeploying; do not reverse schema
changes manually. For a documented non-additive migration, restore the paired
pre-upgrade database and object checkpoint.

## Shutdown

`docker compose --profile runner down` preserves data. Adding `--volumes`
permanently deletes local PostgreSQL and MinIO data and is only for disposable
environments.

## 本机观测栈与定时派发（2026-10-09）

使用 `compose.yaml` 加 `compose.observability.yaml` 可运行 Prometheus、Grafana、
Alertmanager 和本地通知接收器。端口默认仅绑定 loopback：9090、3000、9093，
可以用 `PROMETHEUS_PORT`、`GRAFANA_PORT`、`ALERTMANAGER_PORT` 覆盖。
Grafana 提供只读匿名本机看板 `sketchtest-operations`。此配置面向本机；
外部共享需另行配置鉴权、TLS 和通知收件方。

监控包含规范化路由的计数与耗时直方图、PostgreSQL/对象存储 readiness gauge。
依赖不可用 30 秒触发告警；CP 不可达 2 分钟触发告警。
通知与恢复消息写入 `alert-notifications` 卷的 `/data/notifications.jsonl`，
本机配置不会发送邮件、Slack 或其他外部消息。Prometheus 保留 30 天指标。
所有观测服务数据使用命名卷；验收后不要使用 `down --volumes`。

控制面每 5 秒检查当前 UTC 分钟。`schedule_dispatches` 以规则和分钟为唯一键，
派发标记与该次所有 Runs 在同一事务提交；多实例、重复轮询和重启不重复派发
已提交的同一分钟。停机期间不补跑。环境要求审批或 Runner 标签约束但调度无法
满足时拒绝派发；环境变量在创建 Run 时固定环境版本。应以运行报告确认结果，
启用规则本身不是执行成功证明。

新 RunEvent 使用 `canonical-json-v1` 递归排序对象键后哈希，数组顺序保持不变。
历史未标记编码的哈希与证据文件不回写；若旧 JSONB 已丢失原始键顺序，
校验结果包含 `unverifiableLegacyEventIds` 并维持 `valid:false`，不能据此声称篡改
或将历史记录强行标记为校验通过。需要可信新证据时重新运行已发布版本。
