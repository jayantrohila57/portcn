# Portcn Linux-first product roadmap

**Status date:** 2026-11-27 (Asia/Kolkata)
**Latest published CLI version:** `v0.7.0` (npm and GitHub Release on `main`)
**Current integration branch:** `dev` (ahead of `main`; unreleased `0.8.0` candidate via promotion PR #206)
**Canonical capability tracker:** [GitHub Issues](https://github.com/jayantrohila57/portcn/issues)

GitHub issue state, status labels, and acceptance criteria are authoritative. This roadmap summarizes verified implementation and release evidence, dependencies, and the agreed order. Update it with issue and code changes in the same task. A merged PR alone does not establish completion: verify its acceptance criteria against code, tests, and the release tag.

## Published vs integration branch

| Capability                                                                         | In published `v0.7.0` | On `dev` (not yet on `main`/npm) |
| ---------------------------------------------------------------------------------- | --------------------- | -------------------------------- |
| Unified Linux providers and dashboard (#181–#187)                                  | Yes                   | Yes                              |
| MCP: `list_listeners`, `diagnose_port`, `check_port_availability`, `suggest_ports` | Yes                   | Yes                              |
| Evidence-backed service relationships (#186) via `discover snapshot`               | No                    | Yes (merged #204)                |
| Linux MCP `discovery_snapshot`                                                     | No                    | Yes (merged #204, #205)          |
| JSON stdout broken-pipe handling (#207)                                            | No                    | Yes (merged #207)                |
| Dashboard PTY matrix in CI (#203)                                                  | No                    | Yes (stabilization PR)           |

Do not describe integration-branch-only surfaces as available from `npm install portcn@0.7.0` until Release Please publishes a new tag.

## Product direction

Portcn is a Linux-first local service discovery CLI. Runtime discovery and probes are read-only; users can explicitly save local configuration and open a selected local URL. The published `v0.7.0` Linux command set includes visible TCP/UDP listeners, process and project evidence, saved service details, Docker and Podman inventory, local endpoints, readiness, connection diagnostics, bounded port waits, a read-only MCP server with four tools, and a unified service dashboard that combines visible native listeners, containers, Nginx configuration, and systemd units. Rootlessport forwarding attribution and scoped container deduplication help connect observations across providers. The integration branch adds `portcn discover snapshot` and Linux MCP `discovery_snapshot` for evidence-backed relationships without changing per-provider command JSON. Discovery is limited by the current user, namespace, installed tools, and selected runtime context. A point-in-time observation never reserves a port or proves internet reachability. Portcn does not stop, restart, or otherwise manage services.

The published package also contains a limited macOS listener adapter for `list`, `inspect`, and `diagnose`. macOS process command lines, user IDs, project context, and agent markers are unavailable. Preserve this implementation without expanding macOS coverage during the Linux-first roadmap. Windows listener discovery and further standalone distribution work are deferred until the Linux product is complete. The npm package remains the primary distribution; no binaries are planned.

## Verified release baseline

- GitHub Release `v0.7.0` was published on 2026-11-25. Promotion PR #194 and Release Please PR #200 used true merge commits; the exact `v0.7.0` tag resolves to release commit `f1c63f5`. PR #201 synchronized it to `dev` with true merge commit `443aeec`.
- Release automation published `portcn@0.7.0` to npm; registry metadata reports Node.js `>=22`. The source workspace and build target remain Node.js 24 or newer.
- The release tag set on `main` ends at `v0.7.0` until an authorized promotion merges `dev` and Release Please publishes the next version.
- Issues #181–#185 and #187 are included in published `v0.7.0`: read-only Podman discovery, scoped Docker/Podman observation deduplication, rootlessport attribution, Nginx configuration discovery, systemd service/socket discovery, and the unified service dashboard.
- Issue #186 was implemented on `dev` via PR #204 (`discover snapshot`, `@portcn/core` correlations, Linux MCP `discovery_snapshot`). Acceptance criteria were verified against tests in `packages/core/test/service-relationships.test.ts`, `apps/cli/test/discovery-coordinator.test.ts`, and CLI/MCP integration; closure is tracked on GitHub after stabilization.
- Integration branch also carries CI alignment for Node 22 MCP tools (#205) and the JSON broken-pipe fix (#207).

## Current capability status

| Capability                             | Verified implementation                                                                                                | Status and release                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Listener listing and inspection        | TCP/UDP, IPv4/IPv6, Linux `ss`, limited macOS `lsof` adapter                                                           | Released; core diagnosis in `v0.3.0`, macOS adapter in `v0.6.0`     |
| Port diagnosis and JSON contracts      | Visible owners, permissions/namespaces, deterministic versioned JSON and sanitized errors                              | Released; `v0.3.0`–`v0.4.0`                                         |
| Project and process evidence           | Worktree/project attribution, opt-in agent markers, PID reuse checks, endpoint/project comparison                      | Released; `v0.4.0`                                                  |
| Terminal experience and saved services | Interactive listener dashboard, PTY-tested rendering, favorites, aliases, groups, recovery                             | Released; `v0.4.0`; PTY matrix runs in CI on `dev`                  |
| Docker and bind scope                  | Read-only container inventory, Compose labels, mappings, health metadata, exposure classifications                     | Released; `v0.4.0`; Docker CLI/daemon access is optional            |
| Podman inventory                       | Read-only list/inspect via caller's configured connection; rootless and rootful visibility follows caller permissions  | Released in `v0.7.0`                                                |
| Container identity reconciliation      | Scoped runtime/context/host/container identities and published mapping edges prevent incompatible observations merging | Released in `v0.7.0`                                                |
| Local endpoints and probes             | Saved local URL candidates, explicit open, bounded readiness and connection checks                                     | Released; `v0.5.0`                                                  |
| Port availability and wait             | Point-in-time check/suggestions and bounded cancellable wait                                                           | Released; availability in `v0.4.0`, wait in `v0.6.0`                |
| MCP server (published)                 | Four bounded read-only stdio tools: listeners, diagnosis, availability, suggestions                                    | Released; `v0.6.0`–`v0.7.0`                                         |
| MCP `discovery_snapshot` (Linux)       | Bounded relationship summary from shared discovery coordinator                                                         | Integrated on `dev`; targets next release after promotion #206      |
| Unified discovery architecture         | Typed identity, provider-result, evidence, freshness, scope, partial-result, and correlation contracts                 | Released in `v0.7.0`                                                |
| Service relationships and dependencies | `discover snapshot`, correlation engine, bounded human/JSON summaries; per-command JSON unchanged                      | Verified on `dev` (#186 / #204); unpublished until next release tag |
| Node runtime                           | CLI package supports Node.js 22+; workspace/build require Node.js 24+                                                  | Released; `v0.6.0`                                                  |
| macOS listener discovery               | `list`, `inspect`, and `diagnose`; Linux-only process/project fields unavailable                                       | Released; `v0.6.0`; do not expand during Linux-first work           |
| Rootlessport forwarding attribution    | Relates visible host forwarding helpers to scoped container port mappings                                              | Released in `v0.7.0`                                                |
| Nginx and systemd discovery            | Reports Nginx configuration evidence and visible systemd service/socket state separately from observed listeners       | Released in `v0.7.0`                                                |
| Unified service dashboard              | Presents available native listeners, Docker/Podman containers, Nginx, and systemd service records in one Linux TUI     | Released in `v0.7.0`                                                |
| TLS certificate inspection             | Strict TLS request validation exists; certificate inventory/details do not                                             | Partial; issue #117                                                 |
| Windows listener discovery             | No implementation found                                                                                                | Deferred; issue #141                                                |
| Process termination                    | No signals, lifecycle operations, or safe-to-stop verdict                                                              | Not implemented; design issue #144                                  |

## Revised Linux-first roadmap

| Order | Work                                                                                                                    | Tracking         | State / prerequisite                                          |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------- |
| 1     | Define unified Linux service identity, provider interfaces, provenance, freshness, confidence, and partial-result rules | #180             | Complete; released `v0.7.0` architecture contract             |
| 2–5   | Podman, deduplication, rootlessport, Nginx, systemd, unified dashboard                                                  | #181–#185, #187  | Complete; released `v0.7.0`                                   |
| 6     | Represent evidence-backed service relationships and dependencies                                                        | #186             | Complete on `dev` (#204); awaits authorized release to `main` |
| 7     | Add CPU and memory monitoring by service/project                                                                        | #112             | Pending                                                       |
| 8     | Bounded logs, health checks, advanced diagnostics                                                                       | #110, #114, #117 | Readiness released; logs pending; TLS partial                 |
| 9     | Agent/MCP/Ollama discovery extensions                                                                                   | #104–#106, #116  | Base MCP released; extended discovery pending                 |
| 10    | Safe runtime management design                                                                                          | #144             | Design pending; owner approval required for implementation    |
| 11    | Stability, performance, security, usability                                                                             | #94, #113, #115  | Dashboard stability released; history and storage pending     |
| 12    | Cross-platform expansion                                                                                                | #141             | Windows deferred; preserve macOS scope                        |

### Remaining issue states (after #186 verification)

- **Pending (8):** #105, #106, #110, #112, #113, #115, #116, #144.
- **Partially implemented (1):** #117.
- **Deferred (1):** #141.
- **Completed on `dev`, release-pending:** #186 (relationship model), #203 (PTY in CI when stabilization merges).
- **Blocked (0).**

Verified issue-level roadmap completion counts #186 toward Linux-first product progress once the issue tracker reflects verified closure; published npm users still consume `v0.7.0` until the next authorized release.

## Release, docs, and development policy

- Keep `CHANGELOG.md` as the canonical Keep a Changelog source; `/whats-new` renders published sections only.
- Do not bump versions outside Release Please. Release eligibility remains limited to shipped behavior under `apps/cli/` or `packages/core/`.
- Promotion PR #206 (`dev` → `main`) is open for owner authorization; do not merge without explicit approval.
- Update this roadmap and affected Fumadocs/README/help/agent-skill pages when capability or release boundaries change.

## Reconciliation progress

| Phase                              | Status   | Evidence                                                                                                 |
| ---------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| Stabilization (2026-11-27)         | Complete | #186 verified vs tests; docs/skill/roadmap distinguish `v0.7.0` vs `dev`; #203 PTY step in CI `validate` |
| Release reconciliation `v0.7.0`    | Complete | Published tag and npm `0.7.0` verified                                                                   |
| Integration branch ahead of `main` | Active   | #204–#207 on `dev`; promotion #206 awaiting authorization                                                |
