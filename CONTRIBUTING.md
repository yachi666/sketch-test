# Contributing to SketchTest

## Getting started

```bash
git clone <repo-url>
cd sketch-test
pnpm install
pnpm dev          # Start all apps in dev mode
```

**Requirements**: Node >= 20.0.0, pnpm >= 11.8.0.

## Development workflow

1. **Create a branch** from `master`:
   ```bash
   git checkout -b feat/your-feature
   ```

2. **Write code** following our conventions:
   - TypeScript strict mode everywhere
   - Biome for formatting and linting (2-space indent, single quotes, semicolons)
   - Zod schemas for all runtime validation — types derived via `z.infer<>`
   - Exported schemas use `Schema` suffix; inferred types use the bare name

3. **Commit** using conventional commits:
   ```bash
   git commit -m "feat(scope): description"
   ```
   Types: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`, `ci`.

4. **Check** before pushing:
   ```bash
   pnpm check      # TypeScript type-check
   pnpm lint       # Biome lint
   pnpm format     # Biome format
   pnpm test       # All tests (vitest)
   ```

5. **Open a PR** against `master`.

## Code conventions

### Contracts
- All 5 `packages/contracts/*` packages are **stable seams**. Before modifying a contract, check all downstream consumers.
- Published versions (ApiVersion, TestCaseVersion, WorkflowVersion, EnvironmentVersion, DatasetVersion) are **immutable**.
- Add new schemas to `contracts-common` only when needed by 2+ other packages.

### Testing
- **Unit tests**: `vitest run` per package — fast, no external deps.
- **Golden tests**: Zod output serialized to JSON, compared against checked-in snapshots.
- **Integration tests**: Use the Hermetic Fixture Server (`packages/test-fixtures/hermetic-fixture-server`).
- **Fault injection**: Set `FAULT_MODE` and `FAULT_TARGET` env vars.

## Project structure

See [CLAUDE.md](CLAUDE.md) for the full monorepo map and [docs/](docs/) for architecture and planning documents.

## Questions?

Open a [discussion](https://github.com/your-org/sketch-test/discussions) or file an issue.
