# portcn — Know what's running.

**Your ports. Under control.**

An open-source, developer-first CLI for discovering, inspecting, monitoring, and managing application ports and local services. portcn is planned as a Linux-first tool, starting with Ubuntu.

## Development status

Early development. The CLI and its port and service management features are not implemented. The repository currently provides the documentation site and project tooling; there is no CLI installation or executable yet.

## Implemented

- Fumadocs documentation site with navigation, search, Markdown negotiation, LLM-friendly exports, and generated Open Graph images.
- pnpm workspace and Turborepo task orchestration.
- GitHub Actions validation and Release Please version/changelog workflow.

## Requirements and platform

- Node.js 24 or later
- pnpm 12.3.4
- The future CLI targets Linux first, beginning with Ubuntu. The documentation site runs anywhere supported by Next.js.

## Install and develop

There is no installable CLI package yet. To work on the repository:

```sh
git clone https://github.com/jayantrohila57/portcn.git
cd portcn
pnpm install --frozen-lockfile
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
pnpm release:check
```

No application test suites exist yet; the workspace test command runs package test scripts when they are added.

## Repository structure

- `apps/docs` — independent Fumadocs website.
- `.github` — CI, release automation, contribution templates, and Dependabot configuration.
- `scripts` — version consistency checks.

## Contributions and releases

See [CONTRIBUTING.md](CONTRIBUTING.md) for local development, checks, Conventional Commit messages, and pull request guidance.

Release Please calculates SemVer from Conventional Commits and opens a release pull request. Before `1.0.0`, features and breaking changes advance the minor version, and fixes advance the patch version. Merging the release pull request updates versions and `CHANGELOG.md` and creates a `v`-prefixed GitHub Release. npm publishing is not configured; the CLI is not implemented.

## License

MIT. See [LICENSE](LICENSE).
