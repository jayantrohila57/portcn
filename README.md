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

- Docker Engine with the Compose plugin
- Node.js 24 or later and pnpm 12.3.4 for workspace scripts and optional docs development
- The future CLI targets Linux first, beginning with Ubuntu. The documentation site runs anywhere supported by Next.js.

## Install and develop

Build and run the packaged CLI inside Docker. Compose rebuilds the CLI artifact from the current source before each runtime invocation:

```sh
git clone https://github.com/jayantrohila57/portcn.git
cd portcn
pnpm docker:build
pnpm docker:cli -- --help
pnpm docker:cli -- --version
pnpm docker:test
```

`pnpm docker:cli` runs the packaged `portcn` binary installed from the freshly generated npm artifact. Pass CLI arguments after `--`, such as `pnpm docker:cli -- --version`. Do not install `portcn` globally on the host. Unit tests also pack and globally install the artifact inside their isolated test container.

Containers use their normal PID, network, and mount namespaces. The CLI can initially observe only the processes and ports in its own container; host discovery is not enabled. No service uses privileged mode, host networking, host PID, or a Docker socket mount.

Git hooks run staged Biome checks, Conventional Commit validation, and pre-push checks in Compose containers. For local Fumadocs development, install workspace dependencies and run `pnpm dev`; this does not run the CLI. See the [Portcn documentation](apps/docs/content/docs/index.mdx) for setup and reference, and [CONTRIBUTING.md](CONTRIBUTING.md) for the contributor policy.

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
pnpm docker:build
pnpm docker:test
pnpm docker:cli
pnpm docker:cli -- --help
pnpm docker:cli -- --version
pnpm docker:clean
```

`pnpm docker:test` runs lint, formatting, types, unit/integration tests, Turborepo production builds, package integrity, workspace boundaries, and release metadata checks inside Docker. It also tests the npm artifact's executable, default output, help, version, and global installation behavior. `pnpm docker:build` and `pnpm docker:cli` build the latest source into the runtime image before it is run. `pnpm docker:clean` removes this Compose project's containers, images, and volumes.

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
