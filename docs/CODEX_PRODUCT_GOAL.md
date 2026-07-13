# Codex Product Goal — OpenAI × Anthropic Operating Contract

## Objective

Turn SketchTest into a deployable, verifiable, maintainable API automation
product. Preserve implemented product behavior while removing obsolete
M0/M1/M2 delivery labels, development-only production routes, hard-coded
Fixture execution plans, placeholder screens, and status claims that are not
backed by executable evidence.

The user-selected execution model is **GPT-5.6 Sol**. Do not silently replace
that model name with a different alias. The goal and its acceptance criteria
remain model-independent and must remain usable by Codex or Claude Code.

This is a durable goal, not a one-pass implementation prompt. Work continues
across sessions until every Definition of Done item has direct, current-state
evidence. Passing a subset of tests, exhausting a context window, or finishing
one implementation slice is not completion.

## Product invariants

- Published versions are immutable.
- Control Plane and Runner communicate only through versioned contracts.
- A Run executes a compiled `ExecutionPlan`; importing an `ApiVersion` must
  never secretly create a hard-coded demonstration workflow.
- `planHash` is a deterministic SHA-256 digest of executable plan content.
- Secrets are resolved at execution time and are never emitted in `RunEvent`s.
- Fixture servers and mock data are test infrastructure, never production
  behavior or production UI dependencies.
- Unsupported behavior fails explicitly or produces a traceable diagnostic;
  it must not be silently ignored.

## Execution slices

Each slice should be small enough to review independently and must end with
the relevant lint, type-check, test, build, and runtime evidence.

1. Remove milestone terminology and development-only production paths.
2. Make ExecutionPlan creation deterministic and eliminate zero hashes and
   empty scheduled plans.
3. Give every deployable package consistent `build`, `check`, `lint`, and
   `test` tasks, then make the root quality gate pass without cache-only proof.
4. Replace placeholder Web routes and static product data with Control Plane
   integrations or remove them from navigation until they are real.
5. Add PostgreSQL-backed cross-process E2E coverage for import, authoring,
   publishing, compilation, lease, execution, events, and reports.
6. Add an object-storage interface and a production implementation for raw
   source documents, large evidence artifacts, and immutable manifests.
7. Enforce production configuration at startup and add health, readiness,
   structured telemetry, and audit evidence.
8. Reconcile README, status, architecture, and operating documentation with
   behavior proved by the repository.
9. Make user routes default-deny with JWT, live database roles, and resource
   workspace isolation; keep Runner protocol routes on separate credentials.
10. Prove login, CLI, browser, Compose clean install, migration rollback, and
    database/object recovery as part of the release-candidate evidence chain.

## Iteration harness

Every continuation follows the same loop:

1. **Orient** — inspect the current worktree, this goal, package instructions,
   and the evidence matrix. Never assume the previous narrative is current.
2. **Select** — choose the highest-risk incomplete vertical slice that can be
   implemented and verified coherently. Do not attempt a repository-wide
   one-shot rewrite.
3. **Plan** — identify affected contracts, callers, migrations, UI surfaces,
   tests, runtime probes, rollback concerns, and authoritative evidence.
4. **Implement** — preserve unrelated user changes and keep stable contract
   seams explicit. Temporary work must not create a second production path.
5. **Evaluate** — run the narrow tests first, then the relevant package gates,
   then root gates. For UI or cross-process behavior, verify the rendered or
   running product rather than relying only on unit tests.
6. **Adversarial review** — look for silent fallback, stale mocks, insecure
   defaults, empty success paths, unverified claims, and regressions outside
   the edited module.
7. **Record** — update the evidence matrix with commands, artifacts, remaining
   gaps, and the next best slice so another context window can resume safely.

Planning and evaluation are separate responsibilities even when performed by
the same agent. For high-risk changes, prefer an independent review pass whose
job is to disprove completion against the acceptance criteria.

## Definition of done

- No M0/M1/M2 labels remain in active source, package metadata, runtime logs,
  current README content, or current-status documentation. Historical design
  records and migration filenames may retain historical context.
- No production route, UI action, or scheduler creates a Fixture-specific,
  hard-coded, empty, or zero-hash `ExecutionPlan`.
- `pnpm lint`, `pnpm check`, `pnpm test`, and `pnpm build` execute meaningful
  tasks for every deployable workspace package and all pass from a clean cache.
- A real E2E test proves the product chain from imported source through a
  published `WorkflowVersion`, Runner execution, `RunEvent` ingestion, and
  evidence-backed report.
- Production mode refuses to start with insecure or missing JWT, encryption,
  database, or object-storage configuration.
- Every non-public user route requires JWT authentication and role permission;
  workspace-owned resources cannot be read or mutated across tenants.
- Current documentation contains commands that a new operator can use to
  deploy, verify, observe, and recover the product.

## Completion evidence matrix

| Requirement | Required proof | Current state |
|---|---|---|
| No milestone-era production behavior | Source search plus route/UI/runtime inspection | Proved for active production paths: Fixture-specific plans, mock-backed UI routes, empty/zero-hash schedule behavior, and milestone completion claims are absent |
| Valid immutable ExecutionPlans | Contract tests, deterministic hash tests, scheduler/run integration | Proved: WorkflowVersion, TestCaseVersion, and ad-hoc Run provenance are mutually exclusive; scheduled plans reject empty/invalid/hash-mismatched input |
| Complete package quality gates | Clean-cache root lint/check/test/build logs | Proved for all 16 workspace packages; CLI and fixture now own meaningful lint/check/test/build tasks |
| Authentication and isolation | Default-deny route tests, role tests, cross-tenant tests, foreign-resource validation | Proved at middleware/service level: JWT user is reloaded from PostgreSQL, RBAC is enforced, and cross-workspace resources fail as 404 |
| Real product E2E | PostgreSQL + Control Plane + Runner + Web + CLI + fixture run | Proved 2026-07-13 by `pnpm e2e:product`: login → 8-endpoint import → publish → lease → independent Runner → 6 externalized RunEvents → CLI/report → mandatory Chromium mutation flow |
| Durable evidence storage | Object-store tests, integration and recovery probes | Proved: raw OpenAPI, all 6 forced-large events, and immutable manifest are stored and hydrated with integrity checks; 8/8 objects were mirrored and SHA-256 compared in recovery |
| Production-safe configuration | Negative startup tests and packaged deployment smoke | Proved for the supported single-node target: production credential/S3 checks, `.env.example` Compose validation, and isolated clean-volume CP/Web/Runner startup |
| Versioned migration and rollback | Migration identity/checksum tests, failure rollback, restored migration history | Proved: advisory lock + transaction + immutable ledger; failed schema statement rolls back; dump/restore retained migration history and completed Run |
| Observability and auditability | Trace/log/metric correlation test and operator inspection | Proved at local runtime level: W3C traceparent, x-request-id audit correlation, normalized metrics, and PostgreSQL/S3 readiness |
| Real Web product surfaces | Browser checks with no placeholder/mock production dependencies | Proved for declared surfaces: persisted login, API catalog/import, run report, and browser-authored workflow execution run live in Chromium without console errors |
| Operable local release candidate | Deployment, migration, rollback, recovery and clean-install verification | Proved 2026-07-13 for single-node local Compose; off-host recovery, HA, TLS ingress, load, accessibility, and cross-browser evidence remain production-environment work |

The matrix must be updated with links or exact commands as evidence appears.
`Current state` may become `Proved` only when the proof covers the full stated
scope. Absence of a known failure is not proof.

## Codex working method

- Inspect callers and contracts before editing a cross-package seam.
- Start large changes with a concrete plan and keep it synchronized with the
  current worktree.
- Treat tests, command output, runtime probes, and rendered UI checks as
  evidence; do not infer broad completion from a narrow unit test.
- Preserve unrelated user changes in a dirty worktree.
- Report remaining gaps explicitly and never mark this goal complete while an
  acceptance criterion lacks direct evidence.

## OpenAI basis

This workflow follows OpenAI's published guidance that Codex performs best
with structured context, issue-like prompts, persistent `AGENTS.md` guidance,
iterative environment improvement, and test-backed review. It also follows
OpenAI's guidance for bounded execution, explicit treatment of higher-risk
actions, agent-native telemetry/audit trails, durable threads, explicit change
records, and goals with behavior-based success criteria.

Primary references:

- https://learn.chatgpt.com/use-cases/follow-goals
- https://openai.com/index/codex-maxxing-long-running-work/
- https://openai.com/business/guides-and-resources/how-openai-uses-codex/
- https://openai.com/index/running-codex-safely/
- https://openai.com/index/gpt-5-6/

## Anthropic basis

Anthropic's long-running-agent guidance shows that compaction and a broad
prompt are insufficient: agents tend to attempt too much at once and leave
half-implemented state. This contract therefore requires incremental feature
slices, a persistent task/evidence artifact, a working state at handoff, and a
separate evaluator mindset. Anthropic's security guidance also requires
overlapping controls across the model, execution environment, and external
content rather than relying on model behavior alone.

Primary references:

- https://www.anthropic.com/engineering/harness-design-long-running-apps
- https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- https://www.anthropic.com/engineering/claude-code-best-practices
- https://www.anthropic.com/engineering/how-we-contain-claude
