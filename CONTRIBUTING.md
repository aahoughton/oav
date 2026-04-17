# Contributing

## Branch + PR flow

- `main` is protected. No direct pushes.
- Branch from `main` for every change (`feature/…`, `fix/…`, `docs/…` —
  naming convention not enforced, just helpful).
- Open a PR against `main`. Required status checks must pass before it
  can merge.
- Merging is **squash-only**, so one PR = one commit on `main`. The
  PR title becomes the commit subject, which is why the title is
  linted (see below).

## Commit / PR title format

PR titles follow [Conventional
Commits](https://www.conventionalcommits.org/):

```
<type>[optional !]: <subject>

examples:
  feat: add custom-keywords option to createValidator
  fix: resolve operation-level $ref in cacheFor
  docs: expand maxErrors example in validator README
  feat!: change ValidationError.children to always be an array
```

Allowed types: `feat`, `fix`, `perf`, `refactor`, `docs`, `build`,
`ci`, `chore`, `revert`, `style`, `test`.

Release-please uses these on merge:

- `feat:` → minor bump
- `fix:` → patch bump
- `!` or `BREAKING CHANGE:` footer → major bump
- everything else → no version bump

## Running checks locally

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For schema or validator changes that could affect HTTP behaviour:

```bash
cd conformance
pnpm install             # first time only
pnpm tsx run-openapi-cases.ts
```

## Release process

Releases are automated. You don't bump versions or tag manually.

1. Land PRs to `main` as normal.
2. Every push to `main` triggers release-please, which maintains a
   single open "chore: release" PR that accumulates the next version's
   changelog entries and version bump.
3. When you're ready to release, merge that PR. Release-please tags
   the commit, creates a GitHub Release, and the publish workflow
   pushes the package to npm.

## Manual one-time GitHub setup

Some things can't live in-repo:

- **Branch protection on `main`**: require PR, require status checks
  (`ci / lint`, `ci / typecheck`, `ci / test (22)`, `ci / test (24)`,
  `ci / build`, `ci / conformance`, `ci / pack-smoke`,
  `pr-title / lint`), require branches up-to-date, disallow
  force-push, linear history.
- **Secret**: `NPM_TOKEN` — an automation token from
  `npmjs.com/settings/<you>/tokens` with publish scope for
  `@aahoughton/*`.
- **Repo → Settings → Actions → General → Workflow permissions**:
  default is "Read", plus enable "Allow GitHub Actions to create and
  approve pull requests" (needed for release-please to open its
  release PR). Individual workflows grant themselves write scopes via
  their `permissions:` blocks.
