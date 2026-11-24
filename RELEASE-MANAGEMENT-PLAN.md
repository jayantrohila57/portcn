# Release Management Implementation Plan

Issue: [#119](https://github.com/jayantrohila57/portcn/issues/119)
Branch: `feat/release-management-changelog-whats-new`

## Audit findings

- `dev` is clean and protected; the `dev` and `main` GitHub rulesets require PRs and `branch-policy` plus `validate`, forbid deletion and force pushes, and have no bypass actors.
- At final verification, `dev` is at `227772b` after PRs #120, #122, and #123; `main` and `v0.1.1` remain at `e1a041e`. Existing tags and GitHub Releases are `v0.0.1`, `v0.1.0`, and `v0.1.1`; npm publication and the unresolved GitHub Packages recovery caveat are documented in the release runbook. Do not alter existing versions or published artifacts.
- `scripts/prepare-promotion.mjs` originally required three integrated task PRs. `scripts/release-preview.mjs` previews Conventional Commit SemVer. Release Please runs on `main`, creates the release PR/tag/GitHub Release, and `.github/workflows/release-please.yml` handles idempotent npm publication and GitHub Packages dispatch/recovery.
- `CHANGELOG.md` is the canonical Keep a Changelog history. The three published sections remain preserved, and `Unreleased` contains only reviewed task entries; docs-only lifecycle work does not add a changelog entry.
- `apps/docs` is an independently buildable Fumadocs/Next app. Release guide is `apps/docs/content/docs/releases/index.mdx`; docs directory navigation is managed by `_meta.json`.

## Phases and status

### Follow-up verification after PR #120

- PR #120 merged to `dev` as `1a8fbe7`; the corrected CI run passed `branch-policy` and `validate` without bypassing protections.
- The promotion preview incorrectly classified the release-tooling `feat(release)` commit as a product feature because it treated most non-documentation paths as release-relevant. Correcting eligibility to require shipped CLI/core source changes; promotion PR #121 remains unmerged pending explicit approval.
- Visual review confirmed the release timeline, unique year navigation, and comparison links. Desktop and a 390×844 mobile viewport render correctly with no horizontal overflow. Dark and light Fumadocs themes both render correctly. Year filtering and version-specific anchor navigation work; the initial `v0.0.1` release correctly has no self-comparison link.
- Historical source review reconfirmed that `v0.1.1` CLI command source is unchanged from `v0.1.0`. Existing release descriptions remain unchanged pending explicit approval of the drafts. PR #122 merged after `branch-policy` and `validate` succeeded; it excludes release tooling from product release eligibility.

| Phase | Scope                                                                                                                                           |   Status | Completion |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------: | ---------: |
| 1     | Replace task-count promotion threshold with meaningful release eligibility; tests and lifecycle docs                                            | Complete |       100% |
| 2     | Canonical Keep a Changelog, safe historical preservation, IST dates/links, human-readable release generation and synchronized release authority | Complete |       100% |
| 3     | Publication idempotence/recovery/exact-commit traceability and workflow tests                                                                   | Complete |       100% |
| 4     | Responsive accessible `/whats-new` rendered directly from `CHANGELOG.md`, SEO and version navigation/filtering                                  | Complete |       100% |
| 5     | Governance/docs updates, historical audit, full validation, PR readiness and approval-gated handoff                                             | Complete |       100% |
| 6     | Remove changelog noise for docs-only tasks; record final verification, preview, and approval-gated release state                                | Complete |       100% |

### Phase 1 completion

- Removed the three-PR threshold; one release-relevant task can qualify.
- Promotion preparation compares the SemVer preview with the current manifest and skips docs-only/maintenance-only changes.
- Focused promotion tests and `pnpm release:check` pass. Live preview reports no release candidate.

### Phases 2–4 completion

- Reconciled the three existing changelog versions into categorized Keep a Changelog sections with IST dates, preserved issue/commit references, user-facing summaries, and valid version links. Added parser, SemVer ordering, reconciliation, and duplicate-release checks.
- Added deterministic release note generation with IST date handling, issue/PR links, breaking-change categorization, duplicate prevention, and reviewed release-candidate workflow guidance.
- Made npm publication exact-tag verified, pack-checked, idempotent, and safe to recover. GitHub Packages remains independently idempotent and exact-tag guarded; the release workflow now dispatches it explicitly because `GITHUB_TOKEN` release events do not trigger the separate workflow.
- Added `/whats-new` from the canonical changelog, with latest release, chronology, year navigation/filter disclosure, version anchors, issue/release/comparison links, SEO metadata, responsive design, and theme tokens.
- Focused tests pass (31 lifecycle/workflow cases); docs standalone production build passes.

### Phase 5 status

- Updated root and GitHub agent instructions, contributor guidance, release runbook, promotion summary, and pull request body expectations.
- Reconstructed all three published releases from tag SHAs, GitHub publication timestamps, PR/issue evidence, release bodies, package inventory, and source snapshots. Recorded discrepancies and preserved exact proposed GitHub Release bodies under `RELEASE-DESCRIPTION-DRAFTS/`; public descriptions still require owner approval.
- `pnpm precommit:check` passes locally: lifecycle/release tests, lint, formatting, types, package tests/build, package/boundary/release checks, and docs validation.
- PR #122 (`fix(release): exclude tooling from release eligibility`) merged as `d1a103c`; both required checks passed. Its follow-up changed the release guide and expanded path-eligibility tests.
- The local `dev` pointer had an already-integrated pre-PR commit not on the remote; after confirming its changes were represented by PR #122, the local pointer was safely aligned to `origin/dev`. No remote history was rewritten.
- Visual browser review: responsive layout at 390×844 with no horizontal overflow; dark and light palettes; latest badge; all three historical releases; year filter; version anchors; issue, release, and comparison links; terminal demos for releases that have source-backed commands.
- Promotion preview against `origin/dev` remains `0.1.1` → `0.1.1`. PR #120 and #122 change release tooling/docs only, not shipped CLI/core behavior, so there is no meaningful product release candidate to promote. PR #121 remains unmerged; no tag, package, version, or historical GitHub Release description was changed.
- PR #123 (`fix(release): allow documentation-only task PRs`) merged as `227772b`; `branch-policy` and `validate` both passed. Local submit validation and CI now accept an unchanged changelog only when every changed path is documentation, with tests covering the allowed and rejected cases.
- Final preview on `origin/dev` is `0.1.1` → `0.1.1`; the three integrated PRs change release tooling and documentation only. No next product release is prepared because no shipped CLI/core behavior changed.
- No new version, tag, package, or published GitHub Release description was created or modified. PR #121 remains open and unmerged pending explicit production approval; historical Release description drafts still require explicit approval before publication.

## Approval gates

Do not merge a promotion/release PR to `main`, create a release tag, or publish packages without explicit owner authorization. Preserve all existing Git/GitHub/npm history. Task PR to `dev` may use the repository's existing protected auto-merge lifecycle after required checks pass.
