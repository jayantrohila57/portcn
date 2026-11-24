# Release Management Implementation Plan

Issue: [#119](https://github.com/jayantrohila57/portcn/issues/119)
Branch: `feat/release-management-changelog-whats-new`

## Audit findings

- `dev` is clean and protected; the `dev` and `main` GitHub rulesets require PRs and `branch-policy` plus `validate`, forbid deletion and force pushes, and have no bypass actors.
- `dev` is at `abd134c`; `main` and `v0.1.1` are at `e1a041e`. Existing tags and GitHub Releases are `v0.0.1`, `v0.1.0`, and `v0.1.1`; npm publication and the GitHub Packages recovery caveat are documented in the release runbook. Do not alter existing versions or published artifacts.
- `scripts/prepare-promotion.mjs` originally required three integrated task PRs. `scripts/release-preview.mjs` previews Conventional Commit SemVer. Release Please runs on `main`, creates the release PR/tag/GitHub Release, and `.github/workflows/release-please.yml` handles idempotent npm publication and GitHub Packages dispatch/recovery.
- `CHANGELOG.md` currently mixes Release Please commit summaries and legacy task markers in `Unreleased`; its existing three released sections must be preserved and editorially reconciled without inventing functionality.
- `apps/docs` is an independently buildable Fumadocs/Next app. Release guide is `apps/docs/content/docs/releases/index.mdx`; docs directory navigation is managed by `_meta.json`.

## Phases and status

| Phase | Scope                                                                                                                                           |   Status | Completion |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------: | ---------: |
| 1     | Replace task-count promotion threshold with meaningful release eligibility; tests and lifecycle docs                                            | Complete |       100% |
| 2     | Canonical Keep a Changelog, safe historical preservation, IST dates/links, human-readable release generation and synchronized release authority | Complete |       100% |
| 3     | Publication idempotence/recovery/exact-commit traceability and workflow tests                                                                   | Complete |       100% |
| 4     | Responsive accessible `/whats-new` rendered directly from `CHANGELOG.md`, SEO and version navigation/filtering                                  | Complete |       100% |
| 5     | Governance/docs updates, historical audit, full validation, PR readiness and approval-gated handoff                                             | Complete |       100% |

### Phase 1 completion

- Removed the three-PR threshold; one release-relevant task can qualify.
- Promotion preparation now compares the SemVer preview with the current manifest and skips docs-only/maintenance-only changes.
- Focused promotion tests and `pnpm release:check` pass. Live preview on current `dev` correctly reports no release candidate (20% overall phase progress).

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
- Remaining workflow step: commit and push the task branch, create the PR to `dev`, and await required checks. Per user instruction, stop at the `dev` PR; no production promotion, tag, or publication steps.

## Approval gates

Do not merge a promotion/release PR to `main`, create a release tag, or publish packages without explicit owner authorization. Preserve all existing Git/GitHub/npm history. Task PR to `dev` may use the repository's existing protected auto-merge lifecycle after required checks pass.
