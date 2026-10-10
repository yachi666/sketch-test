# SketchTest

SketchTest is a TypeScript monorepo for evidence-backed REST API automation.
It imports API descriptions into a `CanonicalApiModel`, authors immutable test
and workflow versions, compiles them into an `ExecutionPlan`, runs them in an
independent Runner, and records ordered, redacted `RunEvent` evidence.

[中文说明](./README.zh-CN.md)

## What is implemented

- OpenAPI 3.0.4/3.1.2/3.2.0 (JSON and YAML 1.2), Postman, HAR, and
  RAML adapters plus format detection.
- Arazzo 1.1 sequential HTTP workflow import/export, bound to immutable
  OpenAPI imports with retrieval-URL and content-hash verification.
- Versioned Zod contracts for the canonical API model, test DSL, workflow DSL,
  Runner protocol, generation protocol, and common primitives.
- Fastify Control Plane modules for identity, import, environments and
  secrets, test authoring, workflows, generation drafts, suites, policies,
  scheduling, Runner leases, events, and reports.
- Public GitHub URL → pinned commit → Spring Controller/simple DTO discovery → AI drafts with code-line provenance and actual coverage. See [acceptance and limits](docs/design/2026-09-23-github-generation.md).
- Independent Pi AI Worker with bounded generation tasks, fenced leases, and human-reviewed drafts. See [AI Worker setup](apps/ai-worker/README.md).
- Independent Node.js Runner with retries, polling, extraction, assertions,
  redaction, and ordered event production.
- React Web application exposes authenticated, Control Plane-backed API import,
  workflow publication/execution, and run-report flows.
- CLI commands trigger published workflow versions, poll runs, retrieve reports,
  emit CI-friendly output, and return status-specific exit codes.
- Deterministic test infrastructure for integration and fault-injection tests.

These statements describe available code, not production-readiness. See
[`docs/STATUS.md`](docs/STATUS.md) for verified gates and known gaps.

## Architecture

```text
Web / CLI
    │ versioned HTTP API
    ▼
Control Plane ─── PostgreSQL
    ├── Generation Protocol ─── Independent Pi AI Worker
    │ Runner Protocol
    ▼
Independent Runner ─── System under test
```

The six packages under `packages/contracts` are the only stable seams.
Control Plane, Runner, and AI Worker remain independent processes.
Published `ApiVersion`, `TestCaseVersion`, `WorkflowVersion`,
`EnvironmentVersion`, and `DatasetVersion` records are immutable.

An `ExecutionPlan` records exactly one provenance source:

- a published `WorkflowVersion`;
- a published `TestCaseVersion`; or
- the owning Run for an immutable ad-hoc editor plan.

Plans use deterministic SHA-256 hashes over executable steps and teardown.
Secrets are resolved by the Runner and redacted before event upload.

## Requirements

- Node.js 22.22.2+, 24.15.0+, or 26+ (required by the current test toolchain)
- pnpm 12.10.1
- PostgreSQL for Control Plane runtime and integration tests

## Install and verify

```bash
pnpm install --frozen-lockfile
pnpm turbo run lint check test build --force
```

The four root gates currently pass. Control Plane and Runner builds emit
production JavaScript into `dist/`; their `start` commands execute those
artifacts rather than TypeScript source.

With Docker available, run the production-mode cross-process acceptance and
recovery test with its own disposable PostgreSQL 18 service:

```bash
E2E_MANAGED_POSTGRES=1 pnpm e2e:product
```

It creates isolated PostgreSQL and MinIO resources, starts the built Control
Plane, Runner, Web, and test-only server, verifies login → import → publish →
lease → execution → CLI/report/browser evidence. The primary import path is
OpenAPI 3.2 → Arazzo 1.1 → `WorkflowVersion` → `ExecutionPlan`. It restores the
database and all object evidence into disposable recovery targets and removes
temporary resources in `finally`.

Build and start the packaged images against new Compose volumes, then verify
Control Plane/Web health and an independent Runner heartbeat:

```bash
pnpm e2e:compose
```

The smoke uses unique local resources and removes its containers, images, and
volumes in `finally`.

## Local development

```bash
pnpm dev:web       # React application on 127.0.0.1:5173
pnpm dev:cp        # Control Plane on 0.0.0.0:3802; requires PostgreSQL
pnpm dev:runner    # Runner library development process
pnpm dev:fixture   # deterministic test server on 127.0.0.1:3800
```

Example development configuration:

```bash
export DATABASE_URL='postgresql://localhost:5432/sketchtest'
export JWT_SECRET='replace-with-a-long-random-development-secret'
export SECRET_KEY='replace-with-a-32-byte-secret'
export IMPORT_ALLOWED_HOSTS='specs.example.test'
```

The fixture server is test infrastructure. Production routes and Web actions
must never depend on it.

## Repository map

```text
apps/
  web/              React product interface
  control-plane/    Fastify API and PostgreSQL persistence
  runner/           independent HTTP execution process
  cli/              CI and command-line client
packages/
  contracts/        versioned stable seams
  adapters/         import formats → CanonicalApiModel
  test-fixtures/     deterministic test-only infrastructure
docs/                domain, architecture, status, and operating goals
```

Start with [`CLAUDE.md`](CLAUDE.md) for repository constraints and
[`CONTEXT.md`](CONTEXT.md) for canonical domain language. The durable
productization objective and evidence matrix live in
[`docs/CODEX_PRODUCT_GOAL.md`](docs/CODEX_PRODUCT_GOAL.md).

Deployment, verification, backup, restore, upgrade, and rollback commands are
in [`docs/OPERATIONS.md`](docs/OPERATIONS.md).
The executable OpenAPI/Arazzo support boundary and Overlay decision are in
[`docs/OPENAPI_COMPATIBILITY.md`](docs/OPENAPI_COMPATIBILITY.md).

## Current production gaps

- The verified target is a single-node local release candidate; multi-node
  high availability, managed-service failover, TLS ingress, and load testing
  remain operator responsibilities.
- Browser coverage proves the primary product path, but accessibility,
  compatibility, and broader negative-flow coverage remain incomplete.
- The recovery smoke mirrors database and object evidence locally; an operator
  must still validate encrypted, off-host backups with their chosen provider.

Do not deploy SketchTest to production until the evidence matrix marks these
requirements as proved.

## Security

Never commit credentials or `.env` files. Report vulnerabilities according to
[`SECURITY.md`](SECURITY.md).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Changes to contract schemas require
updating every consumer and the contract tests in the same change.

## License

[Apache-2.0](LICENSE)
