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

The docs app runs on `http://localhost:3000`. Its source is in `apps/docs`.

## Checks

Run these before opening a pull request:

```sh
pnpm lint
pnpm format:check
pnpm check-types
pnpm test
pnpm build
pnpm release:check
```

The core and CLI have focused tests. Add tests alongside new behavior and keep current checks passing.

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/), for example `docs: clarify current project status` or `fix(docs): preserve search behavior`.

Open a pull request against `main`. Describe the change, link relevant issues when available, and include verification results. Keep changes focused and do not claim unfinished features as implemented.

## Releases

Release Please calculates SemVer from Conventional Commits and opens a release pull request against `main`. It releases only `apps/cli` as the unscoped `portcn` package; the root workspace version follows the CLI version. The initial release is `0.0.1`. Before `1.0.0`, features and breaking changes advance the minor version, while fixes advance the patch version.

Review the generated release pull request, changelog, versions, tag, and CI results before merging it. Merging creates a `v`-prefixed GitHub release; CI and Release Please do not publish to npm. If a release pull request has an incorrect version, correct the Conventional Commit history and allow Release Please to recalculate rather than editing or creating tags manually. If a release tag has already been created incorrectly, preserve the published tag and fix forward with a new Conventional Commit and release; do not move or delete tags.
