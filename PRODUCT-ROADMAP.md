# Portcn Linux-first product roadmap

**Status date:** 2026-11-26 (Asia/Kolkata)
**Latest published CLI version:** `v0.7.0`
**Current integration branch:** `dev`
**Canonical capability tracker:** [GitHub Issues](https://github.com/jayantrohila57/portcn/issues)

GitHub issue state, status labels, and acceptance criteria are authoritative. This roadmap summarizes verified implementation and release evidence, dependencies, and the agreed order. Update it with issue and code changes in the same task. A merged PR alone does not establish completion: verify its acceptance criteria against code, tests, and the release tag.

## Product direction

Portcn is a Linux-first local service discovery CLI. Runtime discovery and probes are read-only; users can explicitly save local configuration and open a selected local URL. The current Linux command set includes visible TCP/UDP listeners, process and project evidence, saved service details, Docker and Podman inventory, local endpoints, readiness, connection diagnostics, bounded port waits, a read-only MCP server, and a unified service dashboard that combines visible native listeners, containers, Nginx configuration, and systemd units. Rootlessport forwarding attribution and scoped container deduplication help connect observations across providers. Discovery is limited by the current user, namespace, installed tools, and selected runtime context. A point-in-time observation never reserves a port or proves internet reachability. Portcn does not stop, restart, or otherwise manage services.

The published package also contains a limited macOS listener adapter for `list`, `inspect`, and `diagnose`. macOS process command lines, user IDs, project context, and agent markers are unavailable. Preserve this implementation without expanding macOS coverage during the Linux-first roadmap. Windows listener discovery and further standalone distribution work are deferred until the Linux product is complete. The npm package remains the primary distribution; no binaries are planned.

The provider foundation and unified Linux dashboard shipped in `v0.7.0`. The next step is to validate that dashboard in realistic environments, then add evidence-backed relationships among native sockets and processes, Docker and Podman containers, forwarding helpers, Nginx, systemd units, and projects. The relationship model must distinguish observed, configured, inferred, incomplete, and unavailable evidence.

## Verified release baseline

- GitHub Release `v0.6.1` was published on 2026-11-25. PR #189 promoted the validated CLI correction to `main`; Release Please PR #190 created true merge commit `15bdab0`; PR #191 synchronized `main` to `dev` with true merge commit `7a52061`.
- GitHub Release `v0.7.0` was published on 2026-11-25. Promotion PR #194 and Release Please PR #200 used true merge commits; the exact `v0.7.0` tag resolves to release commit `f1c63f5`. PR #201 synchronized it to `dev` with true merge commit `443aeec`, and `origin/main` is an ancestor of `origin/dev`.
- Release automation published `portcn@0.7.0` to npm; registry metadata and a fresh `npx portcn@0.7.0 --version` install returned `0.7.0`. The exact-tag GitHub Packages workflow successfully published `@jayantrohila57/portcn@0.7.0`; direct registry metadata verification requires `read:packages`, which was not available to the audit session.
- Registry metadata reports `portcn@0.7.0` with Node.js `>=22`. The source workspace and build target remain Node.js 24 or newer.
- `v0.6.1` corrects the `diagnose --help` description to document its existing Linux and macOS support. It adds no new runtime behavior. The exact-tag Release Please workflow and GitHub Packages publication succeeded; npm metadata and clean installed CLI behavior were verified.
- `v0.6.0` added bounded `wait`, read-only stdio MCP, Node 22 packaged-runtime support, limited macOS listener discovery, and the Linux socket-tool fix for packaged CLI images.
- Earlier shipped capabilities include core listener diagnosis (`v0.3.0`), versioned JSON, project/process evidence, terminal design, saved services, Docker inventory and exposure (`v0.4.0`), and local endpoints, readiness, and connection diagnostics (`v0.5.0`).
- The release tag set is `v0.0.1`, `v0.1.0`, `v0.1.1`, `v0.2.0`, `v0.3.0`, `v0.4.0`, `v0.5.0`, `v0.6.0`, `v0.6.1`, and `v0.7.0`. Release Please remains the only version and tag authority.
- Issue #180 established the shared discovery contracts. Provider integrations and dashboard work in #181–#185 and #187 followed that contract and shipped in `v0.7.0`; #180 itself did not change CLI behavior.
- Issues #181–#185 and #187 are included in published `v0.7.0`: read-only Podman discovery, scoped Docker/Podman observation deduplication, rootlessport attribution, Nginx configuration discovery, systemd service/socket discovery, and the unified service dashboard.
- Issue #180 supplies the shared discovery contracts. Issue #186 implementation is in progress on `feat/service-relationships` after the v0.7.0 baseline; it is not yet in a published release tag.

## Current capability status

| Capability                             | Verified implementation                                                                                                | Status and release                                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Listener listing and inspection        | TCP/UDP, IPv4/IPv6, Linux `ss`, limited macOS `lsof` adapter                                                           | Released; core diagnosis in `v0.3.0`, macOS adapter in `v0.6.0`                                       |
| Port diagnosis and JSON contracts      | Visible owners, permissions/namespaces, deterministic versioned JSON and sanitized errors                              | Released; `v0.3.0`–`v0.4.0`                                                                           |
| Project and process evidence           | Worktree/project attribution, opt-in agent markers, PID reuse checks, endpoint/project comparison                      | Released; `v0.4.0`                                                                                    |
| Terminal experience and saved services | Interactive listener dashboard, PTY-tested rendering, favorites, aliases, groups, recovery                             | Released; `v0.4.0`                                                                                    |
| Docker and bind scope                  | Read-only container inventory, Compose labels, mappings, health metadata, exposure classifications                     | Released; `v0.4.0`; Docker CLI/daemon access is optional                                              |
| Podman inventory                       | Read-only list/inspect via caller's configured connection; rootless and rootful visibility follows caller permissions  | Released in `v0.7.0`; actual visibility depends on caller permissions and runtime connection          |
| Container identity reconciliation      | Scoped runtime/context/host/container identities and published mapping edges prevent incompatible observations merging | Released in `v0.7.0`                                                                                  |
| Local endpoints and probes             | Saved local URL candidates, explicit open, bounded readiness and connection checks                                     | Released; `v0.5.0`                                                                                    |
| Port availability and wait             | Point-in-time check/suggestions and bounded cancellable wait                                                           | Released; availability in `v0.4.0`, wait in `v0.6.0`                                                  |
| MCP server                             | Four bounded read-only stdio tools: listeners, diagnosis, availability, suggestions                                    | Released; `v0.6.0`                                                                                    |
| Unified discovery architecture         | Typed identity, provider-result, evidence, freshness, scope, partial-result, and correlation contracts                 | Released in `v0.7.0`; evidence-backed service relationships remain issue #186                         |
| Node runtime                           | CLI package supports Node.js 22+; workspace/build require Node.js 24+                                                  | Released; `v0.6.0`                                                                                    |
| macOS listener discovery               | `list`, `inspect`, and `diagnose`; Linux-only process/project fields unavailable                                       | Released; `v0.6.0`; do not expand during Linux-first work                                             |
| Rootlessport forwarding attribution    | Relates visible host forwarding helpers to scoped container port mappings                                              | Released in `v0.7.0`; attribution is limited by process and namespace visibility                      |
| Nginx and systemd discovery            | Reports Nginx configuration evidence and visible systemd service/socket state separately from observed listeners       | Released in `v0.7.0`; configured state does not prove a live endpoint                                 |
| Unified service dashboard              | Presents available native listeners, Docker/Podman containers, Nginx, and systemd service records in one Linux TUI     | Released in `v0.7.0`; provider results may be partial or unavailable                                  |
| Service relationships and dependencies | Evidence-backed observed, configured, or inferred relationships with source, confidence, and freshness                 | Implemented on `feat/service-relationships`; issue #186 pending merge verification                    |
| TLS certificate inspection             | Strict TLS request validation exists; certificate inventory/details do not                                             | Partial; issue #117 records remaining requirements                                                    |
| Windows listener discovery             | No implementation found                                                                                                | Deferred; issue #141                                                                                  |
| Process termination                    | No signals, lifecycle operations, or safe-to-stop verdict                                                              | Not implemented; design issue #144 is pending and any implementation requires explicit owner approval |

## Revised Linux-first roadmap

The provider and dashboard sequence is shipped in `v0.7.0`. Continue with issue #186 after the required realistic environment validation; keep later work in dependency order.

| Order | Work                                                                                                                                  | Tracking         | State / prerequisite                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------- |
| 1     | Define unified Linux service identity, provider interfaces, provenance, freshness, confidence, and partial-result rules               | #180             | Complete with architecture contract and deterministic tests; no provider integration                 |
| 2     | Integrate native processes and existing Docker observations with Podman discovery                                                     | #95, #101, #181  | Released in `v0.7.0`; visibility follows the caller's configured Podman connection and permissions   |
| 3     | Deduplicate Docker/Podman observations and attribute `rootlessport` forwarding processes                                              | #182, #183       | Released in `v0.7.0`; identity and mapping correlation in #182, scoped process attribution in #183   |
| 4     | Discover Nginx and systemd services without confusing configured state with live observations                                         | #184, #185       | Released in `v0.7.0`; configured and observed evidence remain distinguishable                        |
| 5     | Integrate provider results in one Linux service-oriented terminal dashboard                                                           | #187             | Released in `v0.7.0`; provider availability and user permissions limit visible detail                |
| 6     | Represent evidence-backed service relationships and dependencies                                                                      | #186             | In review on `feat/service-relationships`; `discover snapshot`, core correlations, Linux MCP tool    |
| 7     | Add CPU and memory monitoring by service/project with units, sampling intervals, PID reuse protection, and duplicate-process handling | #112             | Pending; depends on stable service identity                                                          |
| 8     | Add bounded logs, health checks, and advanced diagnostics                                                                             | #110, #114, #117 | Readiness #114 is released; logs #110 pending; TLS certificate inspection #117 partial               |
| 9     | Improve agent and MCP integration, including local MCP server and Ollama discovery                                                    | #104–#106, #116  | MCP server #104 is released; discovery/residency work is pending                                     |
| 10    | Design safe runtime management before any explicit process control                                                                    | #144             | Design pending; implementation must be separate and owner-approved                                   |
| 11    | Improve product stability, performance, security, and usability                                                                       | #94, #113, #115  | Dashboard stability #94 is released; history #113 and container storage #115 remain pending          |
| 12    | Reconsider cross-platform expansion only after Linux completion                                                                       | #141             | Windows is deferred; preserve current macOS support. No standalone distribution expansion is planned |

### Remaining issue states

- **Pending (9):** #105, #106, #110, #112, #113, #115, #116, #144, and new Linux work #186.
- **Partially implemented (1):** #117. Local HTTP(S) requests already use strict TLS validation and report failures; certificate metadata and explicit certificate-state inspection are missing.
- **Deferred (1):** #141 Windows support, until the Linux product is complete.
- **Blocked (0):** No currently open issue is blocked on an external dependency. Process-management implementation remains gated on owner approval after the design is complete.
- **Completed (32 of 43 tracked issues):** 19 previously completed issues were verified during reconciliation; #180–#185 deliver shared architecture, Podman inventory, safe reconciliation, rootlessport attribution, Nginx configuration, and systemd discovery; #187 adds the unified Linux dashboard, released in `v0.7.0`. Service relationships remain open in #186.

Verified issue-level roadmap completion is **27 of 37 Linux-first capability issues (73.0%)**. This counts #180's architecture deliverable plus #181–#185 and #187, now released in `v0.7.0`; it does not count open service relationships #186. The denominator excludes documentation/release-process/runtime-compatibility research and deferred Windows issue #141; partial #117 is not complete.

## Release, docs, and development policy

- Keep `CHANGELOG.md` as the canonical Keep a Changelog source; `/whats-new` renders it directly. The v0.7.0 dated section and GitHub Release are aligned; the published package adds the provider integrations and unified Linux service dashboard.
- Do not bump versions for roadmap, docs, issue-tracking, tests, or release-tooling changes. Release eligibility remains limited to shipped behavior changes under `apps/cli/` or `packages/core/` with a qualifying Conventional Commit.
- Follow the protected branch and release workflow in `CONTRIBUTING.md`. Task PRs target `dev`; promotions, Release Please, and main-to-dev synchronization preserve ancestry with true merge commits. Never rewrite or move a published tag.
- Update this roadmap and the affected Fumadocs/README/help pages in the same task. Do not advertise proposals as working capabilities.

## Reconciliation progress

| Phase                                            | Status   | Evidence                                                                                                                                                    |
| ------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Resolve blockers and synchronize release      | Complete | PR #179 merged with true merge commit `8e80acc`; branch policy, validate, macOS listener, and Node 22 packaged-runtime checks passed                        |
| 2. Audit code, issues, releases, tests, and docs | Complete | Command/test inventory and issue-to-PR/tag audit; docs gaps recorded above                                                                                  |
| 3. Reconcile GitHub issues                       | Complete | 19 verified completions closed; 8 Linux-first issues created; labels/milestones updated                                                                     |
| 4. Documentation alignment                       | Complete | Roadmap, READMEs, development rules, Fumadocs, CLI help, and MCP skill aligned; changelog remains accurate                                                  |
| 5. Quality and stability audit                   | Complete | Workspace and container checks, 7 PTY checks (Ctrl+C + live project timing fixed 2026-11-26), live Linux flows, Docker inventory, npm install, and MCP pass |
| 6. Release reconciliation                        | Complete | Authorized v0.7.0 release verified; PR #201 synchronized with true merge commit `443aeec`; npm install/version and exact-tag workflows passed               |
| 7. Establish revised roadmap                     | Complete | Twelve ordered Linux-first steps and dependencies are recorded above                                                                                        |
| 8. Final report                                  | Complete | At the prior reconciliation: 43 issues, 25 completed, 1 partial, 16 pending, 1 deferred, 0 blocked; release follow-up recorded above                        |
