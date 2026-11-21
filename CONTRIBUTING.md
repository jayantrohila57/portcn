# Contributing to portcn

Thanks for helping improve portcn. The CLI foundation is in place; port discovery and service management are not implemented yet.

## Requirements

- Node.js 24 or later
- pnpm 12.3.4 (`corepack enable` can provide pnpm)
- Linux is the initial target platform for future CLI functionality; the docs app can be developed on any supported Node.js platform.

## Local setup

```sh
git clone https://github.com/jayantrohila57/portcn.git
cd portcn
pnpm install --frozen-lockfile
pnpm dev
```

Dependency installation initializes the root Husky hooks. The docs app runs on `http://localhost:3000`; its source is in `apps/docs`.

VS Code users can install the Biome extension (`biomejs.biome`) for formatting and import organization on save. The root Biome configuration is shared across workspaces.

## Checks

Run these before opening a pull request:

```sh
pnpm lint
pnpm format:check
pnpm check-types
pnpm test
pnpm build
pnpm package:check
pnpm boundaries:check
pnpm release:check
```

The core and CLI have focused tests. Add tests alongside new behavior and keep current checks passing.

Git hooks enforce the same workflow locally: pre-commit runs Biome on staged supported files and applies fixes, commit-msg validates Conventional Commits, and pre-push runs workspace TypeScript checks and tests. Failed checks block the operation. CI runs its full checks directly with Husky disabled, so it does not depend on local hooks.

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/) for changes that need a Release Please version bump, for example `feat(cli): ...` or `fix(docs): preserve search behavior`. The commit hook also accepts existing sentence-style subjects such as `Refactor project structure and documentation.` for compatibility; these do not identify a release type to Release Please.

Open a pull request against `main`. Describe the change, link relevant issues when available, and include verification results. Keep changes focused and do not claim unfinished features as implemented.

## Releases

Release Please is the only versioning tool. It calculates SemVer from Conventional Commits and opens a release pull request against `main`. It releases only `apps/cli` as the unscoped `portcn` package; documentation-only changes outside that path do not trigger a CLI release. The root workspace version follows the CLI version. The initial release is `0.0.1`. Before `1.0.0`, features and breaking changes advance the minor version, while fixes advance the patch version.

Review the generated release pull request, changelog, versions, tag, and CI results before merging it. Merging creates a `v`-prefixed GitHub release; CI and Release Please do not publish to npm. If a release pull request has an incorrect version, correct the Conventional Commit history and allow Release Please to recalculate rather than editing or creating tags manually. If a release tag has already been created incorrectly, preserve the published tag and fix forward with a new Conventional Commit and release; do not move or delete tags.
