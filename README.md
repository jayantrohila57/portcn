# portcn — Know what's running.

**Your ports. Under control.**

An open-source, developer-first CLI foundation for local development. portcn is Linux-first, starting with Ubuntu.

## Development status

Early development. The CLI package and executable foundation are in place; port discovery and service management are not implemented yet.

## Implemented

- Fumadocs documentation site with navigation, search, Markdown negotiation, LLM-friendly exports, and generated Open Graph images.
- pnpm workspace and Turborepo task orchestration.
- `portcn` CLI package with branded default/help/version output and a Node.js executable.
- Private `@portcn/core` package for future shared functionality.
- GitHub Actions validation and Release Please version/changelog workflow for `portcn`.

## Requirements and platform

- Node.js 24 or later and pnpm 12.3.4
- Docker Engine with the Compose plugin (optional, for packaged CLI image checks)
- The future CLI targets Linux first, beginning with Ubuntu. The documentation site runs anywhere supported by Next.js.

## Install and develop

Install dependencies and build the workspace locally:

```sh
git clone https://github.com/jayantrohila57/portcn.git
cd portcn
pnpm install --frozen-lockfile
pnpm build
node apps/cli/dist/index.js --help
pnpm test
```

Optional Docker Compose commands build and run the packaged CLI image. For example, `pnpm docker:cli -- --version` rebuilds the current artifact before running it. Unit tests and package checks run with the regular pnpm scripts.

Containers use their normal PID, network, and mount namespaces. The CLI can initially observe only the processes and ports in its own container; host discovery is not enabled. No service uses privileged mode, host networking, host PID, or a Docker socket mount.

Before each commit, Git hooks run staged Biome checks, Conventional Commit validation, and the full workspace validation suite with pnpm on the host. Pushes do not run local checks; CI runs its checks directly on GitHub Actions without Docker. For local Fumadocs development, run `pnpm dev`. See the [Portcn documentation](apps/docs/content/docs/index.mdx) for setup and reference, and [CONTRIBUTING.md](CONTRIBUTING.md) for the contributor policy.

Running `pnpm docker:cli` without arguments currently displays help and foundation status. Port discovery and service management are not implemented yet. Use Conventional Commits when Release Please should calculate a version bump.

To work on the documentation site:

```sh
pnpm dev
```

The docs app runs at `http://localhost:3000`; open `/docs` for the searchable project guide. To select another port, invoke Next.js directly:

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
pnpm docs:check
```

Docker Compose packaged-image checks are optional and are documented in [Docker](apps/docs/content/docs/docker/index.mdx).

## Project documentation

The searchable [project documentation](apps/docs/content/docs/index.mdx) in `apps/docs` covers getting started, CLI behavior, architecture, development, Docker, contributing, releases, security, and open source. Community policies remain in the canonical root and GitHub files.

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
