# portcn — Know what's running.

**Your ports. Under control.**

An open-source, developer-first CLI for understanding local development services. Portcn is Linux-first, starting with Ubuntu.

## Current release

The latest **published** npm release is **`portcn@0.7.0`**. Runtime discovery is read-only; process and service lifecycle management are not implemented.

| Surface                                                         | `v0.7.0` on npm | `dev` integration branch (unreleased)                  |
| --------------------------------------------------------------- | --------------- | ------------------------------------------------------ |
| Listener list/inspect/diagnose, JSON, dashboard                 | Yes             | Yes                                                    |
| Docker, Podman, Nginx, systemd, exposure, unified services tab  | Yes (Linux)     | Yes                                                    |
| Read-only MCP: listeners, diagnose, availability, suggest       | Yes             | Yes                                                    |
| `portcn discover snapshot` and MCP `discovery_snapshot` (Linux) | No              | Yes (merged via #204; targets `v0.8.0` promotion #206) |
| JSON broken-pipe handling fix (#207)                            | No              | Yes                                                    |

The Linux CLI includes TCP/UDP listing and diagnosis, process/project evidence, versioned JSON, an interactive terminal dashboard, saved service groups, read-only container inventory and bind-scope reports, local endpoint/readiness/connectivity checks, bounded port waiting, and a read-only stdio MCP server. Port observations are scoped to the current namespace; container metadata follows the caller's runtime context and may describe another host.

The published package includes limited macOS `list`, `inspect`, and `diagnose` support through `lsof`. Process command lines, user IDs, project paths, and agent markers are unavailable on macOS. Windows listener discovery is not implemented. See the [platform and capability roadmap](PRODUCT-ROADMAP.md) for verified status and deferred work.

## Requirements and platform

- Node.js 24 or later and pnpm 12.3.4 for the source workspace; the published CLI package requires Node.js 22 or later.
- Docker Engine with the Compose plugin (optional, for packaged CLI image checks)
- The CLI currently targets Linux first, beginning with Ubuntu. The documentation site runs anywhere supported by Next.js.

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
node apps/cli/dist/index.js diagnose 3000 --json-version 1
node apps/cli/dist/index.js discover snapshot --json  # Linux; integration branch only until next npm release
node apps/cli/dist/index.js mcp                     # read-only stdio MCP server
```

Optional Docker Compose commands build and run the packaged CLI image. For example, `pnpm docker:cli --version` rebuilds the current artifact before running it. Unit tests and package checks run with the regular pnpm scripts. CI `validate` also runs the dashboard PTY matrix after `pnpm build`.

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
node --test scripts/dashboard-pty.test.mjs
pnpm package:check
pnpm boundaries:check
pnpm release:check
pnpm docs:check
```

Docker Compose packaged-image checks are optional and are documented in [Docker](apps/docs/content/docs/docker/index.mdx).

## Project documentation

The searchable [project documentation](apps/docs/content/docs/index.mdx) in `apps/docs` covers getting started, CLI behavior, architecture, development, Docker, contributing, releases, security, and open source. Community policies remain in the canonical root and GitHub files.

The [product roadmap](PRODUCT-ROADMAP.md) is the status summary for capabilities; GitHub issue state and acceptance criteria are authoritative. Planned items are proposals, not shipped features or release commitments.

## Repository structure

- `apps/docs` — independent Fumadocs website.
- `apps/cli` — standalone `portcn` command line package.
- `packages/core` — private, platform-independent port validation and shared domain types.
- `.github` — CI, release automation, contribution templates, and Dependabot configuration.
- `scripts` — version consistency checks.

## Contributions and releases

See [CONTRIBUTING.md](CONTRIBUTING.md) for local development, checks, Conventional Commit messages, and pull request guidance.

Release Please calculates SemVer from Conventional Commits and opens a release pull request. Before `1.0.0`, features and breaking changes advance the minor version, and fixes advance the patch version. Merging the release pull request updates the CLI and private root versions plus `CHANGELOG.md`, and creates a `v`-prefixed GitHub Release. The release workflow publishes the unscoped `portcn` package to npmjs.com with Trusted Publishing; the published release workflow also publishes the scoped `@jayantrohila57/portcn` package to GitHub Packages. Both workflows verify the release version and skip an already-published matching version.

## License

MIT. See [LICENSE](LICENSE).
