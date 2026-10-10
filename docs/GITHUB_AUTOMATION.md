# GitHub automation

This repository uses GitHub Actions and native GitHub security features. Workflow
code is versioned under [`.github/`](../.github/); repository settings are described
below so a maintainer can reproduce them.

## Checks and merge policy

`master` requires a pull request, an up-to-date branch, resolved conversations,
and linear history. Force pushes and deletion are disabled, including for admins.
Squash merge is the supported merge method; merged branches are deleted automatically.
Auto-merge is available for a maintainer to opt into after review. No bot approves
or blindly merges dependency updates.

The six runtime gates retain their existing names: `lint`, `typecheck`, `test (22)`,
`test (24)`, `product-e2e`, and `compose-smoke`. `automation` additionally checks
workflow syntax, embedded shell scripts, entry-point documentation file links, and
full-SHA Action references. `pages-build` validates the deployment build on PRs.
`dependency-review` rejects newly introduced high/critical vulnerabilities on PRs
and version-branch CI dispatches. All nine are required. Check sources are restricted to the GitHub Actions app.

Only one human maintainer currently exists, so required approvals are set to zero.
[CODEOWNERS](../.github/CODEOWNERS) routes review requests to the maintainer. Raise
the required approval count when an independent second maintainer is available.

## Security and dependencies

- **CodeQL:** JavaScript/TypeScript and GitHub Actions analysis on PRs, `master`
  pushes, manual dispatch, and Tuesdays at 09:23 Asia/Shanghai (01:23 UTC).
- **Dependency review:** PRs fail the check when they introduce known high or
  critical vulnerabilities. Results appear in the job summary, without PR comments.
- **Dependabot:** npm updates Mondays at 09:00 and Actions updates at 09:30,
  Asia/Shanghai. React, Vite, and Vitest families are grouped to keep related
  versions together; other minor/patch updates are grouped and major updates stay
  separate. npm version updates have a seven-day cooldown. Security updates have
  their own group and are not delayed by the version-update cooldown.
- **Native protection:** Dependabot alerts and security updates, secret scanning,
  push protection, and private vulnerability reporting are enabled.
- **Least privilege:** workflow tokens default to read-only. CodeQL, Pages, and
  version PR jobs request only the additional permissions they need. External
  Actions are pinned to upstream commit SHAs; Dependabot maintains those pins.

CodeQL and dependency review provide additional findings; they do not replace
runtime tests or imply that all historical vulnerabilities have been resolved.
See [SECURITY.md](../SECURITY.md) for confidential reporting.

## Version pull requests

The `release` job runs only after a successful `master` push's CI gates. It detects
pending `.changeset/*.md` files; an empty set is a successful no-op. With changesets,
`changesets/action/version` v2 (compatible with Changesets v3) creates or updates a
version PR instead of pushing to protected `master`. Versioning refreshes the
lockfile, and the action creates the signed commit through the GitHub API;
Changesets does not create a local commit.

GitHub's built-in token does not trigger `pull_request` workflows for a PR it
creates. The job therefore explicitly dispatches `ci.yml` on the version PR's head
branch. The dispatch runs the same nine required checks; it cannot recursively
create another version PR because that job requires a `push` to `master`.

Repository Settings → Actions → General allows Actions to create PRs. The same
GitHub setting also permits reviews, but no workflow uses it to approve changes.
No personal access token or new secret is required.

Package publication is intentionally separate: the repository is pre-release and
most packages are private. The CLI is not marked private, but its npm destination
and release authorization are not configured here. No npm publishing credentials
are added and no automatic package publication occurs. Add a reviewed, protected
release environment and trusted publishing only when a distribution is intended.
[`.github/release.yml`](../.github/release.yml) categorizes GitHub-generated release notes.

## GitHub Pages

PR CI builds workspace dependencies before Web, sets the project URL base path,
and generates a `404.html` fallback. The router uses Vite's base URL; normal local
and container builds continue to use `/`.

The Pages workflow deploys only after successful CI for a `master` push from this
repository, checking out that exact tested SHA. Manual dispatch is restricted to
`master`. Deployment uses the `github-pages` environment and OIDC.

Pages hosts **only the static frontend**, not the Control Plane, PostgreSQL,
object storage, Runner, or AI Worker. It is not a self-contained live demo.
To connect it to a real deployment:

1. Set repository Actions variable `PUBLIC_CONTROL_PLANE_URL` to the externally
   reachable **HTTPS** Control Plane origin, without a trailing slash.
2. Add `https://yachi666.github.io` to that Control Plane's `WEB_ORIGINS`.
3. Redeploy Pages. Browser-visible `VITE_*` values must never contain secrets.

Without this variable, the frontend has no configured remote API and product
operations are unavailable. GitHub Pages serves deep-link fallback pages with HTTP
404 even when the client-side route renders; use the container deployment when
correct server-side SPA routing and a complete application are required.

## Maintenance

- Read failures in the Actions job summary and logs; fix them through a PR.
- Keep required check names aligned with branch protection when renaming jobs.
- The standalone `actionlint` validator is pinned by version and SHA-256 in CI;
  update both from the upstream release when upgrading it.
- Run `node scripts/check-repository.mjs` and `actionlint` locally for documentation
  and workflow edits. Run normal runtime gates for application changes.
- Do not use `pull_request_target` to execute code from untrusted PRs.
- Issue templates use the repository's `needs-triage` label; issues are not
  automatically closed for inactivity.

References: [GitHub workflow security](https://docs.github.com/en/actions/reference/security/secure-use),
[Dependabot options](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference),
[Changesets version action](https://github.com/changesets/action/tree/v2.1.2/version).
