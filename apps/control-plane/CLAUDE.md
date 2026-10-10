# @sketch-test/control-plane

> Fastify API server — IAM, API import, run orchestration, workflow compilation, scheduling, reporting

## Role

The Control Plane is the central API server. It manages workspaces, users, API versions, test cases, workflows, environments, datasets, test suites, policies, and schedules. It creates runs, hands out leases to Runners, collects step events, and serves reports to the Web UI and CLI.

Route registration in `src/main.ts` and versioned migrations in `src/db` are the source of truth for the current API and database surface.

## Quick start

```bash
# Requires PostgreSQL running locally
DATABASE_URL=postgresql://localhost:5432/sketchtest pnpm dev:cp
```

## API surface

See `src/modules/<name>/<name>.routes.ts` for route definitions.

| Module | Purpose |
|--------|---------|
| health | `GET /health` (includes DB status) |
| iam | Workspace, user, service account CRUD; JWT auth (`login`, `me`) |
| import | Multi-format API spec import (`POST /api/import`); version diff |
| run | API versions, runs, execution plans, scheduling |
| lease | Runner long-poll (`GET /api/runs/next`), atomic claim, idempotent event upload |
| runner-registry | Runner registration, heartbeat, status lifecycle |
| workflow | Workflow CRUD, Arazzo 1.1 import, versioning, compile, publish |
| test-authoring | Test case CRUD, versioning, publish, compare |
| test-suite | Test suite CRUD, versioning, quality gate evaluation |
| generation | Generation jobs, draft review (accept/reject) |
| environment | Environment CRUD, versioning; secrets (masked, decrypt) |
| dataset | Dataset CRUD, versioning, JSON/CSV import |
| policy | Policy CRUD, context evaluation |
| report | Aggregated run report |

## Architecture

```
apps/control-plane/src/
  main.ts                  # Fastify bootstrap and route registration
  db/db.ts                 # PostgreSQL pool + domain-grouped schema migrations
  shared/id.ts             # EntityId generation (prefixed, URL-safe)
  modules/
    health/                # GET /health
    iam/                   # Auth middleware + workspace/user/service-account CRUD
    import/                # Multi-format import + diff
    run/                   # Run CRUD, ExecutionPlan builder, lease (FOR UPDATE SKIP LOCKED)
    runner-registry/       # Registration + heartbeat + lifecycle
    workflow/              # Arazzo import + CRUD/versioning + WorkflowDefinition → ExecutionPlan
    test-authoring/        # Test case CRUD + versioning + publishing
    test-suite/            # Test suite CRUD + quality gate evaluation
    generation/            # Rule and Pi jobs, fenced leases, validated draft review
    environment/           # Environment + secrets (encrypted at rest)
    dataset/               # Dataset CRUD + JSON/CSV import
    policy/                # Policy CRUD + evaluation engine
    report/                # Run report aggregation
```

## Database

PostgreSQL tables are grouped by product domain: core execution, IAM,
environments and secrets, test authoring and generation, Runner registry,
workflows, datasets, suites and quality gates, policies, and schedules.

All tables use TEXT primary keys (prefixed, URL-safe identifiers) and JSONB for flexible contract storage. Startup applies checksummed, immutable migrations under a PostgreSQL advisory lock, records them in `schema_migrations`, and rolls a failed migration back transactionally. `src/db/db.ts` is authoritative; `src/db/migrations/001_initial.sql` is historical reference only. Runner lease uses `FOR UPDATE SKIP LOCKED` for concurrency-safe task assignment.

## Key invariants

1. **Default-deny authorization** — only health/readiness/metrics, bootstrap/login, and explicitly enumerated Runner-protocol routes are public or token-specialized. Every other route requires JWT authentication, a current database user, role permission, and resource workspace ownership.
2. **ExecutionPlans are compiled from WorkflowDefinitions** at publish time by the Workflow Compiler.
3. **Events are idempotent** by `id` — `ON CONFLICT (id) DO NOTHING`.
4. **Secrets are redacted on the Runner side** before upload — CP stores encrypted values, never sees plaintext at rest.
5. **Published versions are immutable** — ApiVersion, TestCaseVersion, WorkflowVersion, EnvironmentVersion, DatasetVersion.
6. **Control Plane, Runner, and Web are independent processes** — they share only versioned contracts.
7. **Arazzo imports bind only current-workspace ApiVersions** — source retrieval
   URL and canonical content hash are verified before raw source persistence;
   workflow/version creation is transactional.
8. **TestSuiteVersions are non-empty and immutable** — members must have a
   published executable version, duplicate members are normalized at creation,
   and suites referenced by schedules cannot be partially deleted.

## Dependencies

- `fastify` — HTTP framework
- `pg` — PostgreSQL driver (no ORM)
- `@sketch-test/contracts-common` — EntityId, ContentHash, Instant, diagnostics
- `@sketch-test/canonical-api-model` — API import target
- `@sketch-test/runner-protocol` — ExecutionPlan, RunEvents, lease protocol
- `@sketch-test/test-dsl` — TestDefinition, assertions
- `@sketch-test/workflow-dsl` — WorkflowDefinition (compiler input)

## GitHub repository sources (2026-09-23)

`POST /api/import/repository` accepts a public GitHub repository URL, optional ref and directory. It pins and verifies the snapshot, discovers bounded Spring code facts via the adapter and stores an immutable workspace-owned ApiVersion. Never execute repository code or pass raw code/defaults/credentials to the model. Explicitly retain unsupported-semantics diagnostics. AI completion derives code provenance from this stored version. See `docs/design/2026-09-23-github-generation.md` at the repository root.

## AI plan suggestions (2026-09-28)

`modules/plan-generation` owns workspace settings and fenced plan jobs (migration
003). `GET/POST /api/plan-suggestions`, settings, save, cancel and publish routes
require workspace authorization. Explicitly enumerated `/api/ai-worker/plans/*`
routes require the workspace-bound worker token. Enabled workspaces are checked
every 30 seconds when a capable worker polls; inventory hashes deduplicate
suggestions. Inventory is bounded to 75 published tests, 25 compiled workflows
and 50 pending drafts. Do not send raw definitions or environment values.

Save uses optimistic revisions and never publishes. Publish revalidates
referenced versions and transactionally creates a TestSuite and immutable v1;
pending gaps are excluded, no Runner task is created. Lease completion is fenced
and idempotent. See `docs/design/2026-09-28-ai-plan-generation.md` at the root and
`scripts/plan-generation-e2e.ts` for the disposable PostgreSQL acceptance test.
