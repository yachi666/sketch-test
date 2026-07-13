# Project Status

> Evidence snapshot, last updated 2026-07-13. This reports the current local
> release-candidate branch and does not imply internet-scale production
> readiness. The durable
> acceptance contract is in [`CODEX_PRODUCT_GOAL.md`](CODEX_PRODUCT_GOAL.md).

## Current assessment

SketchTest is now a **single-node local release candidate**, beyond the prior
technical-alpha state. The primary path is implemented and executable across
independent processes: workspace bootstrap/login, OpenAPI import, workflow
publish, Runner lease/execution, durable evidence, CLI status, Web report, and
browser-driven workflow execution. Broad product scope outside that path is
still incomplete.

## Verified in the current worktree

| Gate or capability | Current evidence | Result |
|---|---|---|
| Authorization boundary | Default-deny route hook; JWT + current DB user role; resource workspace lookup; dedicated Runner token routes; 6 focused authorization tests | Pass |
| Workspace isolation | `api_versions` and `runs` own a workspace; foreign-resource references are checked atomically; cross-tenant resources return 404 | Pass at service and middleware level |
| Identity | Workspace-qualified login; async salted scrypt; legacy hash upgrade; hardened JWT parsing/signature/expiry; Web token persistence and 401 invalidation | Pass |
| Control Plane | 25 test files, 401 tests | Pass |
| Runner | 3 test files, 78 tests, including draft-07/2019-09/2020-12 JSON Schema assertions | Pass |
| Web | 3 test files, 17 tests plus mandatory live Chromium flow | Pass |
| CLI | Independent lint/check/build and 3 HTTP-client tests; real run status read in product E2E | Pass |
| Hermetic fixture | Independent lint/check/build and 2 determinism/server tests | Pass |
| Versioned migrations | `schema_migrations` checksum/identity, advisory lock, transaction rollback, legacy ownership fail-closed; 4 focused tests | Pass |
| Product E2E | `E2E_MANAGED_POSTGRES=1 pnpm e2e:product`: production CP/Runner/Web, managed disposable PostgreSQL 18, pinned MinIO, fixture, CLI and Chromium | Pass: 8 imported endpoints, 6 externalized events, report/trace/audit evidence |
| Recovery E2E | Same product run: `pg_dump` → empty restore DB plus complete S3 recovery-bucket mirror and per-object SHA-256 comparison | Pass: restored Run `passed`, migration count 1, 8/8 objects |
| Compose clean install | Isolated project name and new volumes; built production CP/Web/Runner; `/ready`, Web health, bootstrap/login and one Runner registration | Pass; temporary containers, images and volumes removed |
| Release CI | Forced lint/check/build/test plus product/recovery E2E and isolated Compose smoke are required before release | Workflow configured locally; GitHub-hosted execution still requires an authorized push |
| Configuration | Missing/insecure database, JWT, encryption, Runner and S3 settings fail production startup; `.env.example` passes `docker compose config -q` | Pass for supported single-node target |
| Observability | Readiness checks PostgreSQL/S3; normalized metrics; W3C trace and request ID correlated with events/audit | Pass at local runtime level |

## Supported release-candidate boundary

- One Control Plane, one PostgreSQL service, one S3-compatible object store,
  one Web service, and one or more independently authenticated Runners.
- JWT roles are `viewer`, `editor`, `maintainer`, and `owner`; authorization
  uses the current database role rather than trusting stale token role claims.
- The only Web surfaces declared ready are login, API import/catalog, workflow
  publication/execution, and runs/reports.
- Migration rollback means transaction rollback on migration failure and
  application-image rollback for additive schemas. Non-additive rollback
  requires the paired database/object backup.

## Remaining production work

The following work is explicitly outside the current single-node RC and is
tracked as independently verifiable backlog:

1. [#14 — Prove TLS ingress and external secret
   delivery](https://github.com/yachi666/sketch-test/issues/14)
2. [#15 — Run an encrypted off-host PostgreSQL and S3 recovery
   drill](https://github.com/yachi666/sketch-test/issues/15)
3. [#16 — Prove managed PostgreSQL failover
   behavior](https://github.com/yachi666/sketch-test/issues/16)
4. [#17 — Prove managed S3 failover
   behavior](https://github.com/yachi666/sketch-test/issues/17)
5. [#18 — Prove lease safety under multi-instance load and
   soak](https://github.com/yachi666/sketch-test/issues/18)
6. [#19 — Ship evidence-backed SLO dashboards and alert
   delivery](https://github.com/yachi666/sketch-test/issues/19)
7. [#20 — Cover the critical Web flow across browsers and
   accessibility](https://github.com/yachi666/sketch-test/issues/20)
8. [#21 — Protect workspace login from
   abuse](https://github.com/yachi666/sketch-test/issues/21)
9. [#22 — Choose and implement enterprise identity with session
   revocation](https://github.com/yachi666/sketch-test/issues/22)
10. [#23 — Restore one deferred product surface with live Control Plane
    data](https://github.com/yachi666/sketch-test/issues/23)

## Next verification sequence

1. Run `pnpm turbo run lint check test build --force` after every cross-package change.
2. Run `E2E_MANAGED_POSTGRES=1 pnpm e2e:product` for primary-path, browser, CLI and local recovery proof.
3. Run `pnpm e2e:compose` for every image/release change.
4. Perform a target-environment off-host restore and load/soak exercise before
   declaring a production release.
