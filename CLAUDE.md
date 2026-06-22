# SketchTest

> REST API 自动化测试平台 · pnpm monorepo · TypeScript strict

## Quick start

```bash
pnpm install               # Install all dependencies
pnpm dev                   # Start all apps in dev mode (turbo)
pnpm dev:web               # Start only the React web app
pnpm dev:fixture           # Start the Hermetic Fixture Server (port 3800)
pnpm test                  # Run all tests (vitest, turbo orchestrated)
pnpm build                 # Build all packages and apps
pnpm check                 # Type-check everything (tsc --noEmit)
pnpm lint                  # Lint all packages (biome)
pnpm format                # Format all files (biome)
pnpm clean                 # Remove all dist/ directories
```

**Node** >= 20.0.0 · **pnpm** >= 9.0.0 · **Package manager** pnpm@11.8.0

## Monorepo map

```
sketch-test/
├── apps/
│   ├── web/                    # React 19 + Vite 6 — workflow editor, run timeline
│   ├── control-plane/          # NestJS + Fastify (empty skeleton — WIP)
│   └── runner/                 # Independent Node.js process — executes HTTP tests
├── packages/
│   ├── contracts/              # 5 shared, versioned Zod contracts (THE stable seams)
│   │   ├── common/             #   @sketch-test/contracts-common — EntityId, diagnostics, HTTP types
│   │   ├── canonical-api-model/#   @sketch-test/canonical-api-model — unified API representation
│   │   ├── runner-protocol/    #   @sketch-test/runner-protocol — ExecutionPlan, RunEvents, lifecycle
│   │   ├── test-dsl/           #   @sketch-test/test-dsl — TestDefinition, assertions, extraction
│   │   └── workflow-dsl/       #   @sketch-test/workflow-dsl — WorkflowDefinition, steps, teardown
│   ├── adapters/
│   │   └── openapi/            # OpenAPI → CanonicalApiModel adapter
│   └── test-fixtures/
│       └── hermetic-fixture-server/  # Deterministic REST API for integration testing
└── tooling/
    └── tsconfig/               # Shared TypeScript base config
```

## Architecture (from [docs/TECHNICAL_ARCHITECTURE.md](docs/TECHNICAL_ARCHITECTURE.md))

- **Control Plane**: TypeScript modular monolith (NestJS + Fastify) — project catalog, API assets, test definitions, workflows, scheduling, reporting, authorization.
- **Runner**: Independent Node.js/TypeScript process. Deployed near the system under test. Pulls tasks via lease, executes HTTP requests, redacts secrets, uploads events.
- **AI Worker**: Independent TypeScript worker for spec parsing, Git analysis, and draft generation.
- **PostgreSQL**: Transactional metadata and run indexes.
- **S3-compatible object storage**: Raw specs, request/response artifacts, generated outputs.
- **No Kafka in V1** — task scheduling uses PostgreSQL persistent tasks and leases.

**Critical rule**: Control Plane, Runner, and AI Worker must be independent processes. They share versioned contracts, not process lifecycles. If a hotspot needs Go/Rust/Python later, replace behind the existing seam — never change the contract.

## Key conventions

### Language & tooling
- **TypeScript strict** across all packages and apps.
- **Biome** for formatting and linting (space indent 2, single quotes, semicolons, trailing commas, 100 char line width).
- **Vitest** for testing (workspace config in `vitest.workspace.ts`).
- **Turbo** for task orchestration.
- **pnpm catalog** for shared dependency versions (`pnpm-workspace.yaml`).
- **Changesets** for versioning (`pnpm changeset`).

### Code style
- All contracts use **Zod schemas** for runtime validation — types are derived with `z.infer<typeof Schema>`.
- Exported schemas use the `Schema` suffix (e.g., `EndpointSchema`). Inferred types use the plain name (`Endpoint`).
- Every contract file starts with a JSDoc block stating the schema version, purpose, and invariants.
- Packages import from `@sketch-test/contracts-common` for shared primitives (EntityId, ContentHash, Instant, etc.).

### Contracts as stable seams
- The five `packages/contracts/*` packages are the **most important stable seams** in the platform.
- Consumer code (test generation, workflow compiler, API browser) depends **only** on these contracts.
- Adapter code (OpenAPI, RAML, code discovery) **produces** these contracts.
- Published versions of ApiVersion, TestCaseVersion, WorkflowVersion, EnvironmentVersion, DatasetVersion are **immutable**.
- Before modifying any contract schema, check all downstream consumers and update golden tests.

## Domain language

Use the canonical terms and product principles from [CONTEXT.md](CONTEXT.md). Key reminders:

- Published versions (ApiVersion, TestCaseVersion, WorkflowVersion, EnvironmentVersion, DatasetVersion) are **immutable**.
- The seven product principles are non-negotiable — evidence-first, draft-first, flow over count, reproducibility-first, secure by default, adapter architecture, control/execution separation.

## Testing

- **Unit tests**: `vitest run` per package — fast, no external dependencies.
- **Golden tests**: the canonical-api-model contract package has golden tests (`__tests__/golden.test.ts`) that serialize Zod output to JSON and compare against checked-in snapshots (remaining contract packages in progress).
- **Integration tests**: use the Hermetic Fixture Server (`packages/test-fixtures/hermetic-fixture-server`). It provides a deterministic REST API (users, auth, orders, payments) with fixed clock, fixed random seed, and fault injection. Start with `pnpm dev:fixture`.
- **Fault injection**: Set `FAULT_MODE=timeout|500|slow` and `FAULT_TARGET=/api/payments` to inject faults into specific endpoints.

## Current milestone: M0 (feasibility)

Per [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md), we are in M0. Delivered so far:
- ✅ Monorepo setup with pnpm workspace, TypeScript strict, Biome, Vitest, Turbo
- ✅ 5 contract packages with Zod schemas (golden tests for canonical-api-model; remaining in progress)
- ✅ OpenAPI → CanonicalApiModel adapter
- ✅ Runner with HTTP execution, assertion evaluation, variable extraction, redaction
- ✅ Hermetic Fixture Server with 8 business process scenarios (BP-01 through BP-08)
- ✅ CI pipeline (`.github/workflows/ci.yml`)
- 🔲 Control Plane (NestJS/Fastify) — skeleton only
- 🔲 AI Worker
- 🔲 Workflow Compiler

## Docs index

| Document | Purpose |
|----------|---------|
| [CONTEXT.md](CONTEXT.md) | Domain glossary and business processes |
| [docs/PRD.md](docs/PRD.md) | Product requirements |
| [docs/TECHNICAL_ARCHITECTURE.md](docs/TECHNICAL_ARCHITECTURE.md) | System architecture and module map |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Milestone-based task breakdown |
| [docs/TECH_STACK_RESEARCH.md](docs/TECH_STACK_RESEARCH.md) | Technology evaluation notes |
| [docs/ALL_TYPESCRIPT_ARCHITECTURE.md](docs/ALL_TYPESCRIPT_ARCHITECTURE.md) | Rationale for all-TypeScript stack |
| [docs/agents/domain.md](docs/agents/domain.md) | Agent instructions for domain docs |
| [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md) | GitHub issue conventions |
| [docs/agents/triage-labels.md](docs/agents/triage-labels.md) | Triage label vocabulary |
| [AGENTS.md](AGENTS.md) | Agent skill routing |
