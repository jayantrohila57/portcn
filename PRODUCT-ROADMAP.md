# Portcn Linux-first product roadmap

**Status date:** 2026-11-25 (Asia/Kolkata)
**Latest published CLI version:** `v0.6.0`
**Current integration branch:** `dev`
**Canonical capability tracker:** [GitHub Issues](https://github.com/jayantrohila57/portcn/issues)

GitHub issue state, status labels, and acceptance criteria are authoritative. This roadmap summarizes verified implementation and release evidence, dependencies, and the agreed order. Update it with issue and code changes in the same task. A merged PR alone does not establish completion: verify its acceptance criteria against code, tests, and the release tag.

## Product direction

Portcn is a Linux-first local service discovery CLI. Runtime discovery and probes are read-only; users can explicitly save local configuration and open a selected local URL. The current Linux command set inspects visible TCP/UDP listeners, process and project evidence, saved service details, Docker inventory and bind scope, local endpoints, readiness, connection diagnostics, bounded port waits, and a read-only MCP server. Discovery is limited by the current user, namespace, installed tools, and selected Docker context. A point-in-time observation never reserves a port or proves internet reachability. Portcn does not stop, restart, or otherwise manage services.

The published package also contains a limited macOS listener adapter for `list`, `inspect`, and `diagnose`. macOS process command lines, user IDs, project context, and agent markers are unavailable. Preserve this implementation without expanding macOS coverage during the Linux-first roadmap. Windows listener discovery and further standalone distribution work are deferred until the Linux product is complete. The npm package remains the primary distribution; no binaries are planned.

The next product foundation is one evidence-backed service model that can relate native sockets and processes to Docker and Podman containers, forwarding helpers, Nginx, systemd units, and projects. Existing commands remain supported while providers are integrated. The model must distinguish observed, configured, inferred, incomplete, and unavailable evidence.

## Verified release baseline

- GitHub Release `v0.6.0` was published on 2026-11-25. Tag `v0.6.0` is preserved, and PR #179 synchronized the release into `dev` with true merge commit `8e80acc`.
- Registry metadata reports `portcn@0.6.0` with Node.js `>=22`. The source workspace and build target remain Node.js 24 or newer.
- `v0.6.0` includes bounded `wait`, read-only stdio MCP, Node 22 packaged-runtime support, limited macOS listener discovery, and the Linux socket-tool fix for packaged CLI images.
- Earlier shipped capabilities include core listener diagnosis (`v0.3.0`), versioned JSON, project/process evidence, terminal design, saved services, Docker inventory and exposure (`v0.4.0`), and local endpoints, readiness, and connection diagnostics (`v0.5.0`).
- The release tag set is `v0.0.1`, `v0.1.0`, `v0.1.1`, `v0.2.0`, `v0.3.0`, `v0.4.0`, `v0.5.0`, and `v0.6.0`. Release Please remains the only version and tag authority.
- No new product behavior is included in this reconciliation branch. The release-note deduplication regression fix changes release tooling/tests only and does not qualify for a CLI version bump.

## Current capability status

| Capability                             | Verified implementation                                                                            | Status and release                                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Listener listing and inspection        | TCP/UDP, IPv4/IPv6, Linux `ss`, limited macOS `lsof` adapter                                       | Released; core diagnosis in `v0.3.0`, macOS adapter in `v0.6.0`                                       |
| Port diagnosis and JSON contracts      | Visible owners, permissions/namespaces, deterministic versioned JSON and sanitized errors          | Released; `v0.3.0`–`v0.4.0`                                                                           |
| Project and process evidence           | Worktree/project attribution, opt-in agent markers, PID reuse checks, endpoint/project comparison  | Released; `v0.4.0`                                                                                    |
| Terminal experience and saved services | Interactive listener dashboard, PTY-tested rendering, favorites, aliases, groups, recovery         | Released; `v0.4.0`                                                                                    |
| Docker and bind scope                  | Read-only container inventory, Compose labels, mappings, health metadata, exposure classifications | Released; `v0.4.0`; Docker CLI/daemon access is optional                                              |
| Local endpoints and probes             | Saved local URL candidates, explicit open, bounded readiness and connection checks                 | Released; `v0.5.0`                                                                                    |
| Port availability and wait             | Point-in-time check/suggestions and bounded cancellable wait                                       | Released; availability in `v0.4.0`, wait in `v0.6.0`                                                  |
| MCP server                             | Four bounded read-only stdio tools: listeners, diagnosis, availability, suggestions                | Released; `v0.6.0`                                                                                    |
| Node runtime                           | CLI package supports Node.js 22+; workspace/build require Node.js 24+                              | Released; `v0.6.0`                                                                                    |
| macOS listener discovery               | `list`, `inspect`, and `diagnose`; Linux-only process/project fields unavailable                   | Released; `v0.6.0`; do not expand during Linux-first work                                             |
| Podman, Nginx, systemd, service graph  | No implementation found                                                                            | Pending; issues #181–#186                                                                             |
| Unified service dashboard              | Current dashboard focuses on listeners, not all service providers                                  | Pending; issue #187                                                                                   |
| TLS certificate inspection             | Strict TLS request validation exists; certificate inventory/details do not                         | Partial; issue #117 records remaining requirements                                                    |
| Windows listener discovery             | No implementation found                                                                            | Deferred; issue #141                                                                                  |
| Process termination                    | No signals, lifecycle operations, or safe-to-stop verdict                                          | Not implemented; design issue #144 is pending and any implementation requires explicit owner approval |

## Revised Linux-first roadmap

Sequence work by these dependencies. Do not begin the next feature until this reconciliation is complete and the owner has reviewed this roadmap.

| Order | Work                                                                                                                                  | Tracking         | State / prerequisite                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------- |
| 1     | Define unified Linux service identity, provider interfaces, provenance, freshness, confidence, and partial-result rules               | #180             | Pending; architecture before new providers                                                           |
| 2     | Integrate native processes and existing Docker observations with Podman discovery                                                     | #95, #101, #181  | Native and Docker are released; add Podman after #180                                                |
| 3     | Deduplicate Docker/Podman observations and attribute `rootlessport` forwarding processes                                              | #182, #183       | Pending; depends on #180 and #181                                                                    |
| 4     | Discover Nginx and systemd services without confusing configured state with live observations                                         | #184, #185       | Pending; depends on shared service identity                                                          |
| 5     | Integrate provider results in one Linux service-oriented terminal dashboard                                                           | #187             | Pending; depends on #180–#185; preserve existing TUI and JSON behavior                               |
| 6     | Represent evidence-backed service relationships and dependencies                                                                      | #186             | Pending; depends on provider identities and relationships from #180–#185                             |
| 7     | Add CPU and memory monitoring by service/project with units, sampling intervals, PID reuse protection, and duplicate-process handling | #112             | Pending; depends on stable service identity                                                          |
| 8     | Add bounded logs, health checks, and advanced diagnostics                                                                             | #110, #114, #117 | Readiness #114 is released; logs #110 pending; TLS certificate inspection #117 partial               |
| 9     | Improve agent and MCP integration, including local MCP server and Ollama discovery                                                    | #104–#106, #116  | MCP server #104 is released; discovery/residency work is pending                                     |
| 10    | Design safe runtime management before any explicit process control                                                                    | #144             | Design pending; implementation must be separate and owner-approved                                   |
| 11    | Improve product stability, performance, security, and usability                                                                       | #94, #113, #115  | Dashboard stability #94 is released; history #113 and container storage #115 remain pending          |
| 12    | Reconsider cross-platform expansion only after Linux completion                                                                       | #141             | Windows is deferred; preserve current macOS support. No standalone distribution expansion is planned |

### Remaining issue states

- **Pending (16):** #105, #106, #110, #112, #113, #115, #116, #144, and new Linux work #180–#187.
- **Partially implemented (1):** #117. Local HTTP(S) requests already use strict TLS validation and report failures; certificate metadata and explicit certificate-state inspection are missing.
- **Deferred (1):** #141 Windows support, until the Linux product is complete.
- **Blocked (0):** No currently open issue is blocked on an external dependency. Process-management implementation remains gated on owner approval after the design is complete.
- **Completed (25 of 43 tracked issues):** 19 issues were verified and closed during this reconciliation; previously closed issues remain in GitHub history.

The fully implemented feature set is **20 of 37 Linux-first capability issues (54.1%)**. This denominator excludes documentation/release-process/runtime-compatibility research and the deferred Windows issue. It counts a capability as complete only when verified and released; partial #117 does not count as complete.

## Release, docs, and development policy

- Keep `CHANGELOG.md` as the canonical Keep a Changelog source; `/whats-new` renders it directly. The v0.6.0 release section is already aligned, so documentation-only reconciliation leaves it unchanged.
- Do not bump versions for roadmap, docs, issue-tracking, tests, or release-tooling changes. Release eligibility remains limited to shipped behavior changes under `apps/cli/` or `packages/core/` with a qualifying Conventional Commit.
- Follow the protected branch and release workflow in `CONTRIBUTING.md`. Task PRs target `dev`; promotions, Release Please, and main-to-dev synchronization preserve ancestry with true merge commits. Never rewrite or move a published tag.
- Update this roadmap and the affected Fumadocs/README/help pages in the same task. Do not advertise proposals as working capabilities.

## Reconciliation progress

| Phase                                            | Status   | Evidence                                                                                                                              |
| ------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Resolve blockers and synchronize release      | Complete | PR #179 merged with true merge commit `8e80acc`; branch policy, validate, macOS listener, and Node 22 packaged-runtime checks passed  |
| 2. Audit code, issues, releases, tests, and docs | Complete | Command/test inventory and issue-to-PR/tag audit; docs gaps recorded above                                                            |
| 3. Reconcile GitHub issues                       | Complete | 19 verified completions closed; 8 Linux-first issues created; labels/milestones updated                                               |
| 4. Documentation alignment                       | Complete | Roadmap, READMEs, development rules, Fumadocs, CLI help, and MCP skill aligned; changelog remains accurate                            |
| 5. Quality and stability audit                   | Complete | Workspace and container checks, 6 PTY checks, live Linux listener/project/endpoint flows, Docker inventory, npm install, and MCP pass |
| 6. Release reconciliation                        | Complete | v0.6.0 tag, release, changelog, Release Please publish run, npm metadata, and installed package agree; no bump qualifies              |
| 7. Establish revised roadmap                     | Complete | Twelve ordered Linux-first steps and dependencies are recorded above                                                                  |
| 8. Final report                                  | Complete | 43 issues: 25 completed, 1 partial, 16 pending, 1 deferred, 0 blocked; 20/37 capabilities complete (54.1%)                            |
