# Contributing to portcn

Thanks for helping improve portcn. The CLI is not implemented yet; contributions to the existing documentation app and project foundations are welcome.

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

There are no automated test suites yet. Add focused tests alongside future implemented functionality.

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/), for example `docs: clarify current project status` or `fix(docs): preserve search behavior`.

Open a pull request against `main`. Describe the change, link relevant issues when available, and include verification results. Keep changes focused and do not claim unfinished features as implemented.

## Releases

Release Please calculates SemVer from Conventional Commits and opens a release pull request against `main`. Before `1.0.0`, features and breaking changes advance the minor version, while fixes advance the patch version. Merging the release pull request updates the changelog and package versions and creates a `v`-prefixed GitHub release. CI and Release Please do not publish to npm.
