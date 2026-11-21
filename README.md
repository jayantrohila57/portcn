# portcn — Know what's running.

**Your ports. Under control.**

An open-source, developer-first CLI foundation for local development. portcn is Linux-first, starting with Ubuntu.

## Development status

Early development. The CLI package and executable foundation are in place; port discovery and service management are not implemented yet.

## Implemented

- Fumadocs documentation site with navigation, search, Markdown negotiation, LLM-friendly exports, and generated Open Graph images.
- pnpm workspace and Turborepo task orchestration.
- `portcn` CLI package with branded help/version output and a Node.js executable.
- Private `@portcn/core` package for future shared functionality.
- GitHub Actions validation and Release Please version/changelog workflow for `portcn`.

## Requirements and platform

- Node.js 24 or later
- pnpm 12.3.4
- The future CLI targets Linux first, beginning with Ubuntu. The documentation site runs anywhere supported by Next.js.

## Install and develop

To build and run the CLI foundation locally:

```sh
git clone https://github.com/jayantrohila57/portcn.git
cd portcn
pnpm install --frozen-lockfile
pnpm build
node apps/cli/dist/index.js --help
```

Dependency installation initializes Git hooks. Pre-commit checks staged files with Biome, commit-msg accepts Conventional Commits and existing sentence-style subjects, and pre-push runs type checks and tests. Use Conventional Commits when Release Please should calculate a version bump. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

To work on the documentation site:

```sh
pnpm dev
```

The docs app runs at `http://localhost:3000`. To select another port, invoke Next.js directly:

```sh
pnpm --filter @portcn/docs exec next dev --port 3001
```

## Build and verification

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

The CLI help, version, execution, and core import have minimal unit coverage.

## Repository structure

- `apps/docs` — independent Fumadocs website.
- `apps/cli` — standalone `portcn` command line package.
- `packages/core` — private shared library for future CLI logic.
- `.github` — CI, release automation, contribution templates, and Dependabot configuration.
- `scripts` — version consistency checks.

## Contributions and releases

See [CONTRIBUTING.md](CONTRIBUTING.md) for local development, checks, Conventional Commit messages, and pull request guidance.

Release Please calculates SemVer from Conventional Commits and opens a release pull request. Before `1.0.0`, features and breaking changes advance the minor version, and fixes advance the patch version. Merging the release pull request updates the CLI and private root versions plus `CHANGELOG.md`, and creates a `v`-prefixed GitHub Release. npm publishing is not configured.

## License

MIT. See [LICENSE](LICENSE).
