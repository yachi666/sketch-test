# Dependency upgrade — 2026-10-10

All direct external npm dependencies and pnpm were checked against the npm
registry's `latest` tag. `pnpm outdated -r` reports no outdated dependencies.
The lockfile was regenerated with pnpm 12.10.1 and verified with a frozen install.

| Dependency | Installed version |
| --- | --- |
| TypeScript | 7.0.2 |
| Pi agent-core / pi-ai | 1.1.0 / 1.1.0 |
| pnpm | 12.10.1 |
| React / React DOM | 19.3.0 |
| Vite / React plugin | 8.3.4 / 6.1.2 |
| Vitest | 5.0.3 |
| Zod | 4.6.5 |
| jsdom | 30.1.2 |
| Playwright | 1.64.0 |
| Biome | 2.5.15 |
| Fastify | 5.12.5 |
| PostgreSQL driver | 8.23.1 |
| AWS S3 SDK | 3.1149.0 |
| Changesets | 3.0.3 |
| Commitlint | 21.2.3 |
| Lefthook | 2.2.1 |
| Turbo | 2.11.7 |

## Compatibility decisions

- TypeScript 7.0.2 is the stable `typescript` package, not a native-preview alias.
  Shared configurations explicitly include Node ambient types. Web retains
  `vite/client` types as well. Root dev dependencies make these types available
  consistently to all workspace packages.
- Existing v1 contracts and Control Plane routes import `zod/v3`, shipped inside
  Zod 4. This preserves parsing, defaults, inferred shapes and golden outputs.
  Native Zod 4 schema migration is intentionally separate from this dependency
  update because it changes contract semantics.
- Pi's removed `shouldStopAfterTurn` callback is replaced by `finishTurn` with an
  explicit end decision. Tools still execute sequentially, and turn/draft limits
  remain enforced. Tests inspect tools in transcript system messages and cover
  both successful termination and repeated invalid plan proposals.
- Pi's current DeepSeek catalog exposes `deepseek-flash` instead of
  `deepseek-v4-flash`; the provider test uses the current identifier. Runtime model
  selection remains explicit and rejects unknown IDs without substitution.
- `vitest.config.ts` replaces `vitest.workspace.ts` using `test.projects`, includes
  the CLI, and discovers source tests only. Package test commands explicitly
  exclude `dist` because Vitest 5 no longer excludes it by default. The file-based
  CSS regression test resolves paths from its module so root and package runs
  behave alike.
- Shared tsconfig and root Vitest configuration invalidate Turbo caches.
- Node development requirements are now `^22.22.2 || ^24.15.0 || >=26.0.0`, matching
  jsdom and the current toolchain. Validation used Node 24.21.0 and PostgreSQL 18.6.
- pnpm generated exact-version `minimumReleaseAgeExclude` entries for the latest
  AWS SDK packages and Node types during the explicit latest-version install.

## Verification

- Build, TypeScript checks, lint, and 1,041 source tests across 91 test files.
- Existing contract golden tests pass without snapshot updates.
- PostgreSQL/Fastify AI generation acceptance: seven scenarios passed.
- PostgreSQL/Fastify plan generation acceptance: five scenarios passed.
  Both scripts used a disposable database that was removed afterward; no model
  requests or credentials were needed.
- Production-only AI Worker deployment using the same pnpm deploy command as its
  Dockerfile; imported the built harnesses and configured the current DeepSeek
  provider from the deployed directory successfully.
- Frozen-lockfile installation and root workspace test discovery.

Lint still emits warnings, including existing CSS specificity and test typing
warnings. React tests also emit `act` warnings. A deprecated transitive dependency,
`node-domexception@1.0.0`, remains in the upstream dependency tree.
Follow-up container and browser validation passed: Compose smoke, product E2E
with containerized PostgreSQL/MinIO, and the actual Pi agent loops inside the
production AI Worker image. See [container E2E evidence](../verification/2026-10-10/dependency-container-e2e.md).
Container image tags and GitHub Action versions are outside this npm dependency update.

## References

- [TypeScript package metadata](https://registry.npmjs.org/typescript/7.0.2)
- [Pi agent package metadata](https://registry.npmjs.org/@earendil-works/pi-agent-core/1.1.0)
- [Vitest migration guide](https://vitest.dev/guide/migration/)
- [Zod migration guide](https://zod.dev/v4/changelog)
