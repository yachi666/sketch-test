# Project Status

> Current implementation: [Pi integration evidence](design/2026-09-12-pi-integration.md).
> Repository maintenance: [2026-09-23 cleanup review](maintenance/2026-09-23-cleanup.md).
> Dated checks below are historical snapshots, not a claim that deployment checks were rerun today.
> The acceptance contract is in [`CODEX_PRODUCT_GOAL.md`](CODEX_PRODUCT_GOAL.md).

## 2026-07-13 — Release-candidate assessment

SketchTest is now a **single-node local release candidate**, beyond the prior
technical-alpha state. The primary path is implemented and executable across
independent processes: workspace bootstrap/login, OpenAPI 3.2 import, Arazzo
1.1 workflow import, workflow publish, Runner lease/execution, durable
evidence, CLI status, Web report, and browser-driven workflow execution. Broad
product scope outside that path is still incomplete.

## Checks recorded on 2026-07-13

| Gate or capability | Current evidence | Result |
|---|---|---|
| Authorization boundary | Default-deny route hook; JWT + current DB user role; resource workspace lookup; dedicated Runner token routes; 6 focused authorization tests | Pass |
| Workspace isolation | `api_versions` and `runs` own a workspace; foreign-resource references are checked atomically; cross-tenant resources return 404 | Pass at service and middleware level |
| Identity | Workspace-qualified login; async salted scrypt; legacy hash upgrade; hardened JWT parsing/signature/expiry; Web token persistence and 401 invalidation | Pass |
| Control Plane | 27 test files, 419 tests, including Arazzo import transaction, cross-workspace source isolation, published-member enforcement, and atomic test-suite deletion protection | Pass |
| Runner | 3 test files, 79 tests, including OpenAPI 3.2 `QUERY` and draft-07/2019-09/2020-12 JSON Schema assertions | Pass |
| Web | 11 test files, 137 tests plus mandatory live Chromium flow and a focused desktop/editor/mobile test-plan regression | Pass |
| CLI | Independent lint/check/build and 3 HTTP-client tests; real run status read in product E2E | Pass |
| Hermetic fixture | Independent lint/check/build and 3 determinism/server tests, including `QUERY` with a body | Pass |
| Versioned migrations | `schema_migrations` checksum/identity, advisory lock, transaction rollback, legacy ownership fail-closed; 4 focused tests | Pass |
| OpenAPI ecosystem | OpenAPI adapter 40 tests; Arazzo adapter 7 tests; exact 3.0.4/3.1.2/3.2.0 baselines; compatibility matrix and Overlay ADR | Pass for the documented executable subset |
| Product E2E | `E2E_MANAGED_POSTGRES=1 pnpm e2e:product`: production CP/Runner/Web, managed disposable PostgreSQL 18, pinned MinIO, fixture, CLI and Chromium | Pass: OpenAPI 3.2 → Arazzo 1.1 → published plan, 9 imported endpoints, 6 externalized events, report/trace/audit evidence |
| Recovery E2E | Same product run: `pg_dump` → empty restore DB plus complete S3 recovery-bucket mirror and per-object SHA-256 comparison | Pass: restored Run `passed`, migration count 1, 9/9 objects including raw OpenAPI and Arazzo sources |
| Compose clean install | Isolated project name and new volumes; built production CP/Web/Runner; `/ready`, Web health, bootstrap/login and one Runner registration | Pass; temporary containers, images and volumes removed |
| Release CI | Forced lint/check/build/test plus product/recovery E2E and isolated Compose smoke are required before release | Pass on [PR #24](https://github.com/yachi666/sketch-test/pull/24): all six required GitHub-hosted jobs passed; release correctly skipped for the PR |
| Configuration | Missing/insecure database, JWT, encryption, Runner and S3 settings fail production startup; `.env.example` passes `docker compose config -q` | Pass for supported single-node target |
| Observability | Readiness checks PostgreSQL/S3; normalized metrics; W3C trace and request ID correlated with events/audit | Pass at local runtime level |

## Release-candidate boundary recorded on 2026-07-13

- One Control Plane, one PostgreSQL service, one S3-compatible object store,
  one Web service, and one or more independently authenticated Runners.
- JWT roles are `viewer`, `editor`, `maintainer`, and `owner`; authorization
  uses the current database role rather than trusting stale token role claims.
- The Web surfaces declared ready are login, API import/catalog, workflow
  publication/execution, versioned test-plan and schedule management, and
  runs/reports.
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

## 2026-09-12 — Pi generation and regression product iteration

Current working-tree validation: Web → independent Pi 0.85.1 Worker → live DeepSeek → human review → explicit publication → frozen environment → independent Runner → passed evidence report. Full forced lint/check/test/build: 72 tasks and 1,011 tests passed; real PostgreSQL generation integration: 7 groups passed; AI Compose profile configuration valid.

See [current integration evidence and limitations](design/2026-09-12-pi-integration.md), [product review](design/2026-09-12-product-review.md), and [ADR 0002](adr/0002-pi-generation-harness.md). Earlier tables are historical release evidence. Docker was unavailable in this iteration, so the new AI image and Docker-dependent release/recovery acceptance remain unverified. No production deployment is claimed.

## 2026-09-23 — Regression investigation iteration

Implemented server-side run search, pagination and scoped totals; redesigned report investigation and responsive evidence comparison; aligned persisted run statuses; retained unexecuted steps and separated Runner cleanup evidence. Dashboard counts now use the whole seven-day window, with independently queried attention items.

Current forced lint/check/test/build: **72/72 tasks, 979 tests passed**. Live PostgreSQL + independent CP/Runner/Web verified two GitHub public-data scenarios and 55 local HTTP runs, including failure evidence, pagination, and cross-workspace isolation. Desktop/mobile and keyboard flows verified in the in-app browser. Same-day Docker follow-up below closes the initial product/recovery/Compose verification gap. See [design and acceptance evidence](design/2026-09-23-regression-evidence.md).

### Same-day Docker follow-up

Docker Desktop was installed but its engine was stopped; starting Desktop restored access (Engine 29.5.3, Compose v5.1.4). Fixed clean-install script approvals, skipped Git hooks during image dependency installation, updated stale browser acceptance selectors, and fixed the workflow list's missing latest-version projection used by variable sources.

- Full lint/check/test/build rerun: **72 tasks, 979 tests passed**.
- Managed PostgreSQL/MinIO product E2E and Chromium: **passed**, 9 imported endpoints, 6 externalized events, zero browser console errors.
- Local recovery: **passed**, restored Run `run_2fa9527d`, 2 migrations, 9 objects with matching SHA-256 digests.
- Isolated Compose clean install with current CP/Web/Runner images: **passed**, including readiness, bootstrap/login and Runner heartbeat; temporary resources cleaned.
- AI Worker image: **build and non-root production module imports passed**; no new live model-generation run in this check.

Machine-readable [product/recovery evidence](design/evidence/2026-09-23/product-docker-e2e.json), [Compose evidence](design/evidence/2026-09-23/compose-docker-e2e.json), and [AI image evidence](design/evidence/2026-09-23/ai-image-check.json). Existing preview remains reachable. These are local acceptance checks, not a production deployment.

## 2026-09-23 — GitHub repository generation restored

Restored the GitHub URL entry and implemented real, commit-pinned Spring code discovery through the CanonicalApiModel seam. Public `yachi666/support-roster-server` at `f316473c15d8564fb61eb5fdb4eb8a5c06be4939`: 86 files, 59 discovered endpoints, 57 with explicit status evidence. Independent DeepSeek Worker produced three pending staff-management drafts with file/line provenance; the POST draft required one retry. Partial output is counted explicitly. No target business API was executed.

Forced gates: **76 tasks, 1,002 tests passed**; AI queue/review PostgreSQL integration, existing product/recovery E2E and isolated Compose clean install passed. Scope and evidence: [GitHub generation acceptance](design/2026-09-23-github-generation.md). Current repository analysis supports public GitHub and the documented Spring subset; private repositories, other frameworks and full business-rule inference are not claimed.
