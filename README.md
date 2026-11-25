# portcn — Know what's running.

**Your ports. Under control.**

An open-source, developer-first CLI for understanding local development services. Portcn is Linux-first, starting with Ubuntu.

## Development status

Portcn `v0.3.0` is published. It provides read-only Linux commands to list listeners, inspect a port, and diagnose visible owners and namespace limits. The development branch adds versioned JSON output, point-in-time port checks and suggestions, best-effort project/worktree evidence, and opt-in agent session attribution in diagnosis. Process termination is not implemented.

## Implemented

- Fumadocs documentation site with navigation, search, Markdown negotiation, LLM-friendly exports, and generated Open Graph images.
- pnpm workspace and Turborepo task orchestration.
- `portcn` CLI package with branded default/help/version output and a Node.js executable.
- Read-only `portcn list` on Linux: listening TCP/UDP ports, local addresses, and process details when visible; requires `ss` from `iproute2`.
- Read-only `portcn inspect <port>` on Linux: protocol, state, local address, PID, process name, and best-effort `/proc` details for all visible listeners on a validated port.
- Read-only `portcn diagnose <port>` on Linux: visible listeners, owners, address families, and namespace/permission visibility limits. Missing listeners do not guarantee a later bind will succeed.
- Development branch: diagnosis also reports bounded process ancestry and Git project/worktree evidence when visible; this is evidence, not proof of service ownership.
- Optional development branch metadata: set `PORTCN_AGENT_SESSION_ID` and optionally `PORTCN_AGENT_NAME` to annotate a process tree; attribution is not identity verification and possible leftovers are not safe-to-stop decisions.
- Development branch: `portcn check <port>` reports visible listener overlap for a TCP/UDP protocol and bind address; `portcn suggest` returns bounded candidate ports without observed conflicts. Neither command binds or reserves ports.
- Human-readable list and inspect output uses bordered ASCII tables with colors in interactive terminals and plain text when piped.
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
node apps/cli/dist/index.js list  # Linux, requires iproute2
node apps/cli/dist/index.js inspect 3000  # Linux, read-only
node apps/cli/dist/index.js list --interactive  # header, tabs, paginated table, and footer navigation
node apps/cli/dist/index.js diagnose 3000 --json # visible listeners and diagnostic limits
node apps/cli/dist/index.js list --json-version 1 # stable versioned JSON on dev
node apps/cli/dist/index.js check 3000            # read-only listener overlap check on dev
node apps/cli/dist/index.js suggest               # bounded port suggestions on dev
```

Optional Docker Compose commands build and run the packaged CLI image. For example, `pnpm docker:cli -- --version` rebuilds the current artifact before running it. Unit tests and package checks run with the regular pnpm scripts.

Containers use their normal PID, network, and mount namespaces. The CLI can initially observe only the processes and ports in its own container; host discovery is not enabled. No service uses privileged mode, host networking, host PID, or a Docker socket mount.

Before each commit, Git hooks run staged Biome checks, Conventional Commit validation, and the full workspace validation suite with pnpm on the host. Pushes do not run local checks; CI runs its checks directly on GitHub Actions without Docker. For local Fumadocs development, run `pnpm dev`. See the [Portcn documentation](apps/docs/content/docs/index.mdx) for setup and reference, and [CONTRIBUTING.md](CONTRIBUTING.md) for the contributor policy.

Running `pnpm docker:cli` without arguments displays help. Port listing is read-only and sees only sockets within the current process/network namespace; running the CLI in Docker does not grant host inspection. Service management is not implemented. Use Conventional Commits when Release Please should calculate a version bump.

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

The [product roadmap](https://github.com/jayantrohila57/portcn/blob/dev/PRODUCT-ROADMAP.md) tracks implemented status, planned capabilities, dependencies, and acceptance criteria. Planned items are proposals, not shipped features or release commitments.

## Repository structure

- `apps/docs` — independent Fumadocs website.
- `apps/cli` — standalone `portcn` command line package.
- `packages/core` — private shared library for future CLI logic.
- `.github` — CI, release automation, contribution templates, and Dependabot configuration.
- `scripts` — version consistency checks.

## Contributions and releases

See [CONTRIBUTING.md](CONTRIBUTING.md) for local development, checks, Conventional Commit messages, and pull request guidance.

Release Please calculates SemVer from Conventional Commits and opens a release pull request. Before `1.0.0`, features and breaking changes advance the minor version, and fixes advance the patch version. Merging the release pull request updates the CLI and private root versions plus `CHANGELOG.md`, and creates a `v`-prefixed GitHub Release. The release workflow publishes the unscoped `portcn` package to npmjs.com with Trusted Publishing; the published release workflow also publishes the scoped `@jayantrohila57/portcn` package to GitHub Packages. Both workflows verify the release version and skip an already-published matching version.

## License

MIT. See [LICENSE](LICENSE).
