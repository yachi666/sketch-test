> AGENTS.md is loaded by Claude Code alongside CLAUDE.md for agent skill routing.
> Keep it lean: route to specialized instruction docs, don't duplicate
> project-level conventions from CLAUDE.md.

## Agent instructions

### Project overview

Read `CLAUDE.md` at the repo root for monorepo structure, conventions, and current status. Pay special attention to:

- **Hard constraints** — non-negotiable rules (immutable versions, independent processes, contract-only seams). Violating these breaks the platform.
- **Gotchas** — common pitfalls (contract change cascades, PostgreSQL requirement, Biome vs ESLint, golden test snapshots).
- **Domain language** — 7 product principles and canonical terms table.

Each package and app has its own `CLAUDE.md` with API docs, invariants, and modification guides. See the index below.

### Issue tracker

Issues live as GitHub issues on this repo's remote (uses the `gh` CLI). PRs are **not** a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

`CLAUDE.md` includes the 7 product principles and canonical terms table. For the full domain glossary, business processes, and platform flows, read `CONTEXT.md` at the repo root. See `docs/agents/domain.md` for agent-specific domain conventions.

### Per-package CLAUDE.md index

| Package | CLAUDE.md |
|---------|-----------|
| Root (monorepo) | [`CLAUDE.md`](CLAUDE.md) |
| Web | [`apps/web/CLAUDE.md`](apps/web/CLAUDE.md) |
| Control Plane | [`apps/control-plane/CLAUDE.md`](apps/control-plane/CLAUDE.md) |
| AI Worker | [`apps/ai-worker/CLAUDE.md`](apps/ai-worker/CLAUDE.md) |
| Runner | [`apps/runner/CLAUDE.md`](apps/runner/CLAUDE.md) |
| CLI | [`apps/cli/CLAUDE.md`](apps/cli/CLAUDE.md) |
| OpenAPI Adapter | [`packages/adapters/openapi/CLAUDE.md`](packages/adapters/openapi/CLAUDE.md) |
| Arazzo Adapter | [`packages/adapters/arazzo/CLAUDE.md`](packages/adapters/arazzo/CLAUDE.md) |
| Postman Adapter | [`packages/adapters/postman/CLAUDE.md`](packages/adapters/postman/CLAUDE.md) |
| HAR Adapter | [`packages/adapters/har/CLAUDE.md`](packages/adapters/har/CLAUDE.md) |
| RAML Adapter | [`packages/adapters/raml/CLAUDE.md`](packages/adapters/raml/CLAUDE.md) |
| Code Discovery Adapter | [`packages/adapters/code-discovery/CLAUDE.md`](packages/adapters/code-discovery/CLAUDE.md) |
| Format Detector | [`packages/adapters/format-detector/CLAUDE.md`](packages/adapters/format-detector/CLAUDE.md) |
| Contracts: Generation | [`packages/contracts/generation-protocol/CLAUDE.md`](packages/contracts/generation-protocol/CLAUDE.md) |
| Contracts: Common | [`packages/contracts/common/CLAUDE.md`](packages/contracts/common/CLAUDE.md) |
| Contracts: Canonical API | [`packages/contracts/canonical-api-model/CLAUDE.md`](packages/contracts/canonical-api-model/CLAUDE.md) |
| Contracts: Runner Protocol | [`packages/contracts/runner-protocol/CLAUDE.md`](packages/contracts/runner-protocol/CLAUDE.md) |
| Contracts: Test DSL | [`packages/contracts/test-dsl/CLAUDE.md`](packages/contracts/test-dsl/CLAUDE.md) |
| Contracts: Workflow DSL | [`packages/contracts/workflow-dsl/CLAUDE.md`](packages/contracts/workflow-dsl/CLAUDE.md) |
| Hermetic Fixture Server | [`packages/test-fixtures/hermetic-fixture-server/CLAUDE.md`](packages/test-fixtures/hermetic-fixture-server/CLAUDE.md) |
