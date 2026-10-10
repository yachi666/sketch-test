# Contributing to SketchTest

Use [GitHub issues](https://github.com/yachi666/sketch-test/issues/new/choose) for bugs
and feature proposals. For vulnerabilities, use the [private reporting process](SECURITY.md).

## Get started

Follow the [README](README.md#quick-start) to install the pinned pnpm version,
configure dependencies, and verify a clean checkout. Read [CLAUDE.md](CLAUDE.md)
and the relevant package's `CLAUDE.md` before changing code.

```bash
git switch master
git pull --ff-only
git switch -c feat/your-feature
pnpm install --frozen-lockfile
```

Use TypeScript strict mode, Biome, and the shared pnpm catalog. Do not add ESLint
or Prettier. Control Plane, Runner, and AI Worker remain separate processes;
shared contracts are the only stable package boundaries.

## Validate your change

```bash
pnpm turbo run lint check test build --force
node scripts/check-repository.mjs
```

For runtime, container, or cross-process changes, also run:

```bash
pnpm --filter web exec playwright install chromium
E2E_MANAGED_POSTGRES=1 pnpm e2e:product
pnpm e2e:compose
```

Add focused regression coverage for changed behavior. Contract schema changes
must update all consumers and golden snapshots in the same PR. Published versions
are immutable. Never commit `.env`, credentials, generated build output, or local databases.

## Open a pull request

Target `master` and describe the problem, resulting behavior, and validation.
Use a Conventional Commit title, such as `fix(runner): preserve ordered events`.
Keep unrelated work in separate PRs and link the relevant issue when one exists.

The protected branch requires passing checks, an up-to-date branch, resolved
review conversations, and linear history. PRs are squash-merged and their branches
are deleted automatically. Only one human maintainer is currently configured, so
independent approval is not mandatory; this is not an instruction to skip review.

## Version changes

Run `pnpm changeset` when a package change needs a version bump and changelog entry.
Documentation, tests, and repository automation alone usually do not need one.
After the change reaches `master` and CI passes, automation creates or updates a
version PR. That PR must pass the same CI and be reviewed and merged normally.
No workflow pushes version commits directly to `master` or publishes npm packages.

See [GitHub automation](docs/GITHUB_AUTOMATION.md) for maintenance and troubleshooting.
