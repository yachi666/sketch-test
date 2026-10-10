# SketchTest

> REST API 自动化测试平台 · pnpm monorepo · TypeScript strict
> Last reviewed: 2026-09-23

## Quick start

```bash
pnpm install               # Install all dependencies
pnpm dev                   # Start all apps in dev mode (turbo)
pnpm dev:web               # Start only the React web app (port 5173)
pnpm dev:cp                # Start only the Control Plane (port 3802, needs PostgreSQL)
pnpm dev:runner            # Start only the Runner
pnpm dev:fixture           # Start the Hermetic Fixture Server (port 3800)
pnpm test                  # Run all tests (vitest, turbo orchestrated)
pnpm build                 # Build all packages and apps
pnpm check                 # Type-check everything (tsc --noEmit)
pnpm lint                  # Lint all packages (biome)
pnpm format                # Format all files (biome)
pnpm clean                 # Remove dist/, incremental state, and build caches
pnpm clean:cache           # Remove generated caches only (--dry-run to preview)
```

## Monorepo map

```
sketch-test/
├── apps/
│   ├── web/                    # React 19 + Vite 8 — workflow editor, run timeline
│   ├── control-plane/          # Fastify API server — IAM, import, runs, workflows, scheduling
│   ├── ai-worker/              # Independent Pi generation daemon — reviewed test drafts
│   ├── cli/                    # CLI tool for CI/CD integration (GitHub Actions, GitLab CI)
│   └── runner/                 # Independent Node.js process — executes HTTP tests
├── packages/
│   ├── contracts/              # 6 shared, versioned Zod contracts (THE stable seams)
│   │   ├── common/             #   @sketch-test/contracts-common — EntityId, diagnostics, HTTP types
│   │   ├── canonical-api-model/#   @sketch-test/canonical-api-model — unified API representation
│   │   ├── runner-protocol/    #   @sketch-test/runner-protocol — ExecutionPlan, RunEvents, lifecycle
│   │   ├── test-dsl/           #   @sketch-test/test-dsl — TestDefinition, assertions, extraction
│   │   ├── workflow-dsl/       #   @sketch-test/workflow-dsl — WorkflowDefinition, steps, teardown
│   │   └── generation-protocol/#   @sketch-test/generation-protocol — bounded AI tasks and pending drafts
│   ├── adapters/
│   │   ├── code-discovery/     # GitHub snapshot → Spring route/DTO canonical evidence
│   │   ├── format-detector/    # Auto-detect import format (OpenAPI, Postman, HAR, cURL)
│   │   ├── openapi/            # OpenAPI 3.x → CanonicalApiModel adapter
│   │   ├── arazzo/             # Arazzo 1.1 ↔ WorkflowDefinition adapter
│   │   ├── postman/            # Postman Collection v2.1 → CanonicalApiModel adapter
│   │   ├── har/                # HAR 1.2 → CanonicalApiModel adapter
│   │   └── raml/               # RAML 1.0 → CanonicalApiModel adapter
│   └── test-fixtures/
│       └── hermetic-fixture-server/  # Deterministic REST API for integration testing
└── tooling/
    └── tsconfig/               # Shared TypeScript base config
```

## Architecture (from [docs/TECHNICAL_ARCHITECTURE.md](docs/TECHNICAL_ARCHITECTURE.md))

- **Control Plane**: Fastify API server — workspace/project management, API import, test authoring, workflow compilation, run orchestration, scheduling, reporting, IAM with JWT auth.
- **Runner**: Independent Node.js/TypeScript process. Deployed near the system under test. Pulls tasks via lease, executes HTTP requests, redacts secrets, uploads events.
- **AI Worker**: Independent Pi 1.1.0 Worker in `apps/ai-worker`; PostgreSQL jobs and fenced leases → curated API projection → validated pending drafts → human review → explicit publication → environment-bound Runner execution. See [ADR 0002](docs/adr/0002-pi-generation-harness.md).
- **PostgreSQL**: Transactional metadata and run indexes.
- **S3-compatible object storage**: Content-addressed raw OpenAPI/Arazzo sources,
  large RunEvents, and immutable evidence manifests.
- **No Kafka in V1** — task scheduling uses PostgreSQL persistent tasks and leases.

## Hard constraints

These are non-negotiable. Violating any of them breaks the platform's design.

- **NEVER commit secrets, .env files, or credentials** — secrets are resolved by the Runner at execution time.
- **Published versions are IMMUTABLE** — ApiVersion, TestCaseVersion, WorkflowVersion, EnvironmentVersion, DatasetVersion. Once published, never modify.
- **Control Plane, Runner, and AI Worker MUST be independent processes** — they share only versioned contracts, not process lifecycles.
- **Contract packages are the ONLY stable seams** — never bypass them with direct cross-package imports or shared mutable state.
- **If a hotspot needs Go/Rust/Python later** — replace behind the existing contract seam; never change the contract.

## Key conventions

### Language & tooling
- **TypeScript 7 strict** across all packages and apps. Node ambient types are explicit in the shared tsconfig.
- **Biome** for formatting and linting (see `biome.json` for rules). This replaces ESLint + Prettier.
- **Vitest** for testing (`vitest.config.ts` at repo root).
- **Turbo** for task orchestration.
- **pnpm catalog** for shared dependency versions (`pnpm-workspace.yaml`).
- **Changesets** for versioning (`pnpm changeset`).

### Code style
- All contracts use **Zod schemas** for runtime validation; types are inferred from schemas. Zod 4 is installed, with existing v1 contracts and CP routes importing `zod/v3` to preserve parsing/default semantics. A native Zod 4 schema migration needs a separate contract compatibility review.
- Exported schemas use the `Schema` suffix (e.g., `EndpointSchema`). Inferred types use the plain name (`Endpoint`).
- Every contract file starts with a JSDoc block stating the schema version, purpose, and invariants.
- Packages import from `@sketch-test/contracts-common` for shared primitives (EntityId, ContentHash, Instant, etc.).

### Contracts as stable seams
- The six `packages/contracts/*` packages are the **most important stable seams** in the platform.
- Consumer code (test generation, workflow compiler, API browser) depends **only** on these contracts.
- Adapter code (OpenAPI, RAML, code discovery) **produces** these contracts.
- Before modifying any contract schema, check all downstream consumers and update golden tests.

## Domain language

Use the canonical terms from [CONTEXT.md](CONTEXT.md) for the full glossary. Key principles and terms:

### Seven product principles (non-negotiable)
1. **Evidence-first** — all conclusions and results must trace back to sources.
2. **Draft-first** — AI and rule-generated content enters as drafts, never directly as published tests.
3. **Flow over count** — critical business flow coverage matters more than total test case count.
4. **Reproducibility-first** — failures must retain enough input and version info to replay.
5. **Secure by default** — secrets are never shown in plain text; request/response is redacted by default.
6. **Adapter architecture** — OpenAPI, RAML, and code analysis all output the same CanonicalApiModel.
7. **Control/execution separation** — Runners can be deployed in the same network as the system under test.

### Canonical terms (always use these)
| Say | Don't Say |
|-----|-----------|
| TestCaseVersion | test case (ambiguous: draft or published?) |
| WorkflowVersion | workflow (ambiguous: editor doc or published?) |
| CanonicalApiModel | API spec, API document, parsed API |
| ExecutionPlan | compiled workflow, frozen workflow |
| RunSnapshot | run config, run params |
| RunEvent | execution log, run log |
| StepRun | step execution, run step |
| GeneratedDraft | AI test, generated test |

## Testing

- **Unit tests**: `vitest run` per package — fast, no external dependencies.
- **Golden tests**: all 6 contract packages have golden tests that serialize Zod output to JSON and compare against checked-in snapshots.
- **Adapter tests**: each adapter (OpenAPI, Arazzo, Postman, HAR, RAML, format-detector) has fixture-based tests.
- **Integration tests**: use the Hermetic Fixture Server (look under `packages/test-fixtures/`). It provides a deterministic REST API (users, auth, orders, payments) with fixed clock, fixed random seed, and fault injection. Start with `pnpm dev:fixture`.
- **Fault injection**: Set `FAULT_MODE=timeout|500|slow` and `FAULT_TARGET=/api/payments` to inject faults into specific endpoints.
- **Product E2E** exercises OpenAPI 3.2 → Arazzo 1.1 → WorkflowVersion →
  ExecutionPlan across production Control Plane, Runner, Web, CLI, PostgreSQL,
  and S3-compatible object storage processes.

## Gotchas

Common pitfalls that trip up new contributors:

- **Contract changes cascade** — changing a contract schema requires updating all downstream consumers AND golden test snapshots. Run `pnpm test` from root to catch breaks.
- **PostgreSQL is required for CP dev** — `pnpm dev:cp` fails without a running PostgreSQL instance. Set `DATABASE_URL` if not using the default.
- **Biome replaces ESLint + Prettier** — don't install or configure them. Run `pnpm lint` and `pnpm format`.
- **pnpm catalog controls shared versions** — React, Vite, TypeScript, etc. are pinned in `pnpm-workspace.yaml`. Don't bump them in individual `package.json` files.
- **Published versions are one-way** — once a version is published, it cannot be changed. Get it right before publishing.
- **Golden test snapshots are checked in** — if you intentionally change contract output, update the snapshots with `vitest run --update`.

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
| [docs/STATUS.md](docs/STATUS.md) | Current project status and milestone progress (snapshot) |
| [AGENTS.md](AGENTS.md) | Agent skill routing |

## Product review and Pi harness (2026-09-12)

- [Product review and target flows](docs/design/2026-09-12-product-review.md)
- [Pi harness decision and integration boundary](docs/adr/0002-pi-generation-harness.md)
- [AI Worker instructions](apps/ai-worker/CLAUDE.md)
- [Generation protocol instructions](packages/contracts/generation-protocol/CLAUDE.md)
