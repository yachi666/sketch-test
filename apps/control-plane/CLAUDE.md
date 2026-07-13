# @sketch-test/control-plane

> Fastify API server — IAM, API import, run orchestration, workflow compilation, scheduling, reporting

## Role

The Control Plane is the central API server. It manages workspaces, users, API versions, test cases, workflows, environments, datasets, test suites, policies, and schedules. It creates runs, hands out leases to Runners, collects step events, and serves reports to the Web UI and CLI.

The current product surface contains approximately 109 route declarations and 28 PostgreSQL tables. Treat these counts as descriptive rather than completion evidence.

## Quick start

```bash
# Requires PostgreSQL running locally
DATABASE_URL=postgresql://localhost:5432/sketchtest pnpm dev:cp
```

## API surface

~80 endpoints across 14 route modules. See `src/modules/<name>/<name>.routes.ts` for route definitions.

| Module | Purpose |
|--------|---------|
| health | `GET /health` (includes DB status) |
| iam | Workspace, user, service account CRUD; JWT auth (`login`, `me`) |
| import | Multi-format API spec import (`POST /api/import`); version diff |
| run | API versions, runs, execution plans, scheduling |
| lease | Runner long-poll (`GET /api/runs/next`), atomic claim, idempotent event upload |
| runner-registry | Runner registration, heartbeat, status lifecycle |
| workflow | Workflow CRUD, versioning, compile, publish |
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
  main.ts                  # Fastify bootstrap, 16 route modules registered
  db/db.ts                 # PostgreSQL pool + domain-grouped schema migrations
  shared/id.ts             # EntityId generation (prefixed, URL-safe)
  modules/
    health/                # GET /health
    iam/                   # Auth middleware + workspace/user/service-account CRUD
    import/                # Multi-format import + diff
    run/                   # Run CRUD, ExecutionPlan builder, lease (FOR UPDATE SKIP LOCKED)
    runner-registry/       # Registration + heartbeat + lifecycle
    workflow/              # CRUD + versioning + WorkflowDefinition → ExecutionPlan compiler
    test-authoring/        # Test case CRUD + versioning + publishing
    test-suite/            # Test suite CRUD + quality gate evaluation
    generation/            # Rule-based test generation engine
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

## Dependencies

- `fastify` — HTTP framework
- `pg` — PostgreSQL driver (no ORM)
- `@sketch-test/contracts-common` — EntityId, ContentHash, Instant, diagnostics
- `@sketch-test/canonical-api-model` — API import target
- `@sketch-test/runner-protocol` — ExecutionPlan, RunEvents, lease protocol
- `@sketch-test/test-dsl` — TestDefinition, assertions
- `@sketch-test/workflow-dsl` — WorkflowDefinition (compiler input)
