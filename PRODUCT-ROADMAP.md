# Portcn product roadmap

**Status date:** 2026-11-25 (Asia/Kolkata)

**Phase 0 completed:** 2026-11-25 06:41 IST

**Current integration branch:** `dev` (updated after PR #153)

**Latest published CLI release:** `v0.3.0`

**Canonical tracker:** GitHub issues; this file records scope, dependencies, and verified progress.

## Product direction

Portcn is a read-only, Linux-first local runtime inspection CLI. It discovers visible TCP/UDP listeners, inspects a port, diagnoses visible owners and namespace limits, and provides interactive terminal views. It does not terminate processes. Product work should first make port-conflict diagnosis dependable, then build project context and safe read-only ownership explanations before expanding into integrations.

Portcn overlaps with `ss`, `lsof`, `netstat`, and small port-killer utilities in inspecting local sockets. Its intended distinction is beginner-readable explanations, one coherent view of visible owners and namespace limits, project context, and stable agent-facing read-only contracts. These are product goals, not claims that every capability is already implemented. Portcn does not replace those system tools or guarantee visibility beyond the current user and namespaces.

## Verified release and repository baseline

- GitHub reports `v0.3.0` as latest, published 2026-11-25; the local `v0.3.0` tag points to the `main` release commit. `dev` contains the subsequent main-to-dev sync and is clean at audit time.
- Closed issue #95 is implemented by merged PR #134 (`feat(cli): diagnose port conflicts with owner and namespace details`). The current CLI supports read-only `diagnose <port>` and JSON output; this is present on `dev` and included in published `v0.3.0` after PR #135/#136.
- Existing product proposals #96–#118 and new issues #139–#144 cover the planned capabilities below. No duplicate scope was confirmed in the issue-body audit; missing dependency notes on #96–#100 were added. All 35 repository issues now use priority, category, complexity, platform, and status labels. All 29 open capability issues have a capability milestone.
- GitHub Discussions are disabled. Existing issue templates and contributor guide are present; GitHub Issues remain the feedback path. Discussions were not enabled.
- npm registry metadata confirms `portcn@0.3.0` is available at `https://registry.npmjs.org/portcn/0.3.0`; this verifies version metadata, not an independent clean-install smoke test.
- PR #138 reconciled the stale release-status wording across README and documentation pages against `v0.3.0`.

## Phases and acceptance criteria

| Phase                                        | Scope and tracked issues                                                                                                         | Dependencies                                                               | Acceptance criteria                                                                                                                                                                                                                                                     | Status                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 0. Repository audit and product organization | This roadmap; audit issues, releases, docs, contributor feedback                                                                 | None                                                                       | Verify repository/release baseline; map existing work without duplicates; write accurate feature status, dependencies, acceptance criteria, and tracking taxonomy. Discussions are disabled; issue templates and Issues remain the feedback path.                       | Complete                                                               |
| 1. Port diagnostics                          | #95 complete; #98 stable JSON/diagnostics; #99 availability and suggestions                                                      | #95                                                                        | Versioned deterministic JSON, documented exit/error contracts, safe output, correct point-in-time port semantics, TCP/UDP and IPv4/IPv6 coverage, local integration fixtures.                                                                                           | #95 shipped in v0.3.0; #98 and #99 implemented on dev, release pending |
| 2. Project awareness and process safety      | #96 project/worktree association; #111 read-only safety; #108 endpoint/project verification; #103 agent attribution              | Phase 1 contracts                                                          | Evidence-ranked ownership; handle PID reuse, exits, permissions and namespaces; explain uncertainty; never infer termination safety from process names or age. Read-only.                                                                                               | #96, #103, #108, and #111 implemented on dev; release pending          |
| 3. Terminal design and UX                    | #118 design system; #97 master-detail; #100 saved services/config                                                                | Existing dashboard; phase 1 output contracts                               | Reusable accessible terminal conventions; progressive disclosure; versioned config; no-color, narrow-terminal, piped and JSON behavior; PTY coverage for keyboard/resize/filter/pagination/restoration.                                                                 | #118, #97, and #100 implemented on dev                                 |
| 4. Docker and service intelligence           | #101 Docker/Compose; #102 exposure; #107 HTTP(S); #114 readiness; #109 connection diagnostics                                    | Stable discovery and project context where needed                          | Distinguish listening/reachable/ready/unhealthy/stopped/unknown; bounded local probes; explicit browser action; work without Docker; no privileged access, socket mount, external scan, or automatic restart.                                                           | In progress                                                            |
| 5. Agent integration                         | #104 read-only stdio MCP; reusable skill                                                                                         | Phases 1–2; readiness contracts from #114 where applicable                 | Reuse existing contracts; stable schemas, timeouts and limitations; protocol-only stdout; graceful shutdown; no shell execution, model/API key, or destructive tool.                                                                                                    | Planned                                                                |
| 6. Compatibility and distribution            | #140 macOS; #141 Windows; #142 Node 22 audit; #143 distribution evaluation                                                       | Stable platform-independent contracts                                      | Dependency-backed runtime decision and CI matrix; per-platform tests before support claims; preserve Linux; document unsupported capabilities.                                                                                                                          | Planned                                                                |
| 7. Safe runtime management                   | #139 port watch/wait; #144 termination safety design                                                                             | Reliable read-only identity/ownership from Phase 2                         | Bounded cancellable watch; if termination is later approved: preview, dry-run, exact identity revalidation, graceful-first, refuse ambiguity, no privilege escalation, disabled to agents by default. Product safety design needs owner approval before implementation. | Planned; termination gated                                             |
| 8. Advanced runtime intelligence             | #105 MCP discovery; #106 Ollama; #110 logs; #112 resources; #113 snapshots; #115 Docker storage; #116 Ollama residency; #117 TLS | Core experience proven; each issue's dependency/permission limits reviewed | Individually scoped, optional, read-only where appropriate, bounded, privacy-conscious, modular; no daemon/cloud service or broad scan.                                                                                                                                 | Planned                                                                |
| 9. Product validation and adoption           | Reproducible real-development scenarios, docs, measurements and feedback                                                         | Phases 1–5 for relevant scenarios                                          | Fixtures and demonstrations; correctness/latency/memory/package/platform baselines; agent-task success method; feedback gathered without invented demand or metrics.                                                                                                    | Planned                                                                |

## Issue sequence and dependency notes

1. Complete a focused audit of #98 and #99 against the shipped #95 implementation; both are merged to `dev` and await release. Do not reopen or duplicate #95 absent a verified defect.
2. Establish #96 project/worktree evidence before finalizing #111 safety explanations and #108 expected-project verification.
3. Treat #97 and #118 as coordinated UX slices, with #100 persistence separately bounded and versioned.
4. For Phase 4, implement discovery (#101) and bounded readiness (#114) as explicit prerequisites for features that need those facts; keep #102 exposure language probabilistic and #107 browser opening explicit.
5. Build #104 only after its tool surface can reuse tested read-only contracts. #103 agent attribution must remain evidence-qualified.
6. macOS (#140), Windows (#141), port watch (#139), Node runtime support (#142), distribution (#143), and process safety design (#144) are split into individual issues. No destructive work starts before the owner-approved Phase 7 design.
7. Phase 8 items remain independent issues; validate their permissions, data sources and resource bounds in each issue before implementation.

## Issue taxonomy and capability milestones

Issues use one label from each applicable dimension: `priority:high`, `priority:medium`, or `priority:unranked`; a `category:*` capability label; `complexity:unestimated` until an estimate is reviewed; a platform label; and `status:planned`. GitHub Open/Closed remains the authoritative workflow status. Priority preserves the issue body's high/medium intent and does not imply a date or release commitment.

Capability milestones group deliverables, not deadlines or versions:

- **Core port diagnostics:** #98, #99.
- **Project awareness and safety:** #96, #103, #108, #111.
- **Terminal experience:** #97, #100, #118.
- **Local services and containers:** #101, #102, #107, #109, #114.
- **Agent and advanced runtime intelligence:** #104–#106, #110, #112, #113, #115–#117.
- **Compatibility and distribution:** #140–#143.
- **Safe runtime management:** #139, #144.
- **Compatibility and distribution:** #140–#143.
- **Safe runtime management:** #139, #144.

## Tracking and release policy

- Work one issue and branch at a time using the repository lifecycle scripts. Task PRs target `dev`; no production merge, tag, package publication, or deployment is authorized by this roadmap.
- Record issue, priority/dependencies, acceptance evidence, tests, PR and release in the relevant issue/PR and update this roadmap after a task completes.
- Keep user-facing behavior documented in the same task. Keep `CHANGELOG.md` categorized and accurate; documentation-only changes do not create a CLI release.
- Existing release history: `v0.0.1`, `v0.1.0`, `v0.1.1`, `v0.2.0`, `v0.3.0`. Release Please remains the version and tag authority. See `RELEASE-HISTORY-AUDIT.md` for historical verification.

## Phase 0 completion record

- [x] Verify clean branch, `dev` synchronization, tag list, GitHub latest release, issue inventory, PR inventory, and Discussions setting.
- [x] Confirm #95 implementation and shipped release through issue/PR/tag history.
- [x] Audit all existing issue titles and bodies for duplicate scope, acceptance criteria, and dependencies; no duplicate was confirmed. Added dependency notes to #96–#100 where absent.
- [x] Reconcile stale release-status wording in root/npm READMEs and the getting-started, CLI reference, guides, landing, and open-source docs.
- [x] Create individual missing proposals #139–#144; define the issue taxonomy and capability milestones; classify all 35 issues and assign capability milestones to the 29 open product proposals.
- [x] Reconcile this tracker against current GitHub issues and release evidence. Phase 1 and Phase 2 (#96, #103, #108, #111) are implemented on `dev`; release is pending. Phase 3 #118, #97, and #100 are implemented on `dev`.

**Phase 0 completion:** 100% (1 of 10 phases complete). Latest published version: `v0.3.0`. PRs #138 and #145 merged to `dev`; subsequent feature work is tracked in the phase rows above. Blockers: none for Phase 0; process termination remains owner-approval-gated before implementation.
