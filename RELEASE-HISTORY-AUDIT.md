# Portcn historical release audit

This audit checks the initial repository commit and every published release boundary currently present in Git. It distinguishes shipped CLI behavior from CI, packaging, and test work so the public changelog describes what users received. Publication timestamps are converted from GitHub's UTC `publishedAt` values to India Standard Time (IST). Existing tags, release records, and packages are immutable; the release-description text below is a proposal only.

## Sources checked

- Git history from initial commit `b8cb45e5c1c23b68b24d2c9027daeaffaacf7e6b` through `v0.1.1`, including the first-parent commit ranges between version tags.
- Peeled tag commits, GitHub Release records and bodies, release dates, the npm version list, and the repository's release workflow and runbook.
- Merged pull request inventory #1 through #93, with bodies reviewed for the initial lifecycle/release work (#1–#29), CLI feature sequence (#30–#43), and release stabilization sequence (#45–#90), plus promotion/synchronization PRs #91–#93; linked issue records include the initial port-listing issue #23.
- Source snapshots at all three tags. The CLI command modules at `v0.1.1` are unchanged from `v0.1.0`; that tag adds `apps/cli/README.md`, `LICENSE`, and package metadata.

## Published release boundaries

| Version  | Git tag target (peeled commit)             | GitHub Release publication (IST) | Verified package status                                                                                                                                                                |
| -------- | ------------------------------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v0.0.1` | `d495d5b0ce3b0e9fd5f9b4df4aec0f9ab7d204ee` | 2026-11-22 16:43:10              | `portcn@0.0.1` appears in npm's published version list.                                                                                                                                |
| `v0.1.0` | `390d6495c98fe829ae9ffcff7fc7e2d4668a9a4b` | 2026-11-24 17:41:12              | `portcn@0.1.0` appears in npm's published version list; GitHub Packages publication succeeded in run [45404125212](https://github.com/jayantrohila57/portcn/actions/runs/45404125212). |
| `v0.1.1` | `e1a041e6200e83c692e9290c0e8a1ff6a6e8e54b` | 2026-11-24 19:34:44              | `portcn@0.1.1` appears in npm's published version list; GitHub Packages publication succeeded in run [45410185155](https://github.com/jayantrohila57/portcn/actions/runs/45410185155). |

The public npm version list also contains `0.0.0-stage`; it is not associated with a release tag or GitHub Release in this repository and is not presented as a Portcn release. No version or tag was created or changed during this audit.

## Reconstructed user-facing history

### `v0.0.1` — Portcn CLI foundation

The published release body and source snapshot agree: this version packaged the executable with branded help, version output, and default no-argument output. Its source registers no `list` or `inspect` commands. The release explicitly excluded port discovery and process/service management. The changelog now reflects that boundary and links to the original GitHub Release.

### `v0.1.0` — Port discovery and an interactive dashboard

The tag snapshot registers `list` and `inspect`. The merged feature work adds TCP/UDP listener listing (#23), Linux port inspection with best-effort process details (#30), terminal tables and color behavior (#31), optional protocol/process tabs (#32), and a resize-aware dashboard with keyboard selection/search/sorting, refresh, palette, and selected-listener details (#37–#39). Terminal layout and hostile/Unicode text handling fixes are represented as one concise `Fixed` entry (#33–#36, #40). `list --json` and `inspect --json` were added in #41. The secure fork workflow (#22) is retained under `Security`.

Issue/PR #42 and #43 are pseudo-terminal and terminal-size tests; they validate the dashboard but do not introduce additional user functionality, so they are intentionally omitted from the user-facing changelog. The original Release Please body also lists CI and release-workflow corrections as “Fixes”; those implementation details are not repeated as product fixes. Commit and PR evidence remains in Git history and the source release record.

A GitHub Packages workflow was introduced in this release period (#19). An initial `v0.1.0` attempt failed before publication, but the later exact-tag workflow run [45404125212](https://github.com/jayantrohila57/portcn/actions/runs/45404125212) succeeded and its logs report `@jayantrohila57/portcn@0.1.0` published. No recovery action is needed.

### `v0.1.1` — More reliable package publishing

This version's merged work centers on publication and branch lifecycle reliability. It adds consumer CLI usage and license files to the package and records verified npm publication (#70, #72); accepts lightweight and annotated tags and checks the peeled commit (#71); builds `@portcn/core` before packaging the CLI (#79); preserves the legacy `0.1.0` tarball path while requiring README and LICENSE for future packages (#81); and permits the ancestry-preserving synchronization merges required by protected promotion (#75–#77). Changelog reconciliation work (#85, #87, #90) ensures the notes follow historical release boundaries. These changes are summarized under `Changed`, rather than presented as new CLI features.

The original release body separates CI/release implementation commits into “Fixes” and repeats multiple reconciliation commits. Those items are consolidated by outcome. User-relevant issue references remain in `CHANGELOG.md`; individual implementation commits remain immutable and searchable.

## Discrepancies and limits

- Before this reconciliation, the working `CHANGELOG.md` did not contain a dated `v0.0.1` section even though the tag and GitHub Release exist. The corrected entry uses the published release body and exact tag date.
- The `v0.1.0` and `v0.1.1` GitHub Release bodies are generated Conventional Commit summaries, not polished Keep a Changelog notes. The proposals below regroup them by shipped outcome and retain only verified consumer/contributor value.
- GitHub Packages publication is proven for `v0.0.1`, `v0.1.0`, and `v0.1.1` by the successful exact-tag workflows [45021457874](https://github.com/jayantrohila57/portcn/actions/runs/45021457874), [45404125212](https://github.com/jayantrohila57/portcn/actions/runs/45404125212), and [45410185155](https://github.com/jayantrohila57/portcn/actions/runs/45410185155); each log names and publishes the matching scoped package version. Direct registry metadata could not be queried from this session: npm.pkg.github.com returned 401 anonymously and GitHub package inventory returned 403 because the configured token lacks `read:packages`. Thus workflow publication is verified, while current registry metadata/installability is not independently verified here. Earlier failed `v0.1.0` attempts were superseded by the successful exact-tag run; no tag or version was recreated or moved.
- The repository code and Release Please path filters allow documentation-only changes to reach `main` without a CLI version bump, and `apps/docs` builds independently. This makes an independent docs deployment technically possible through a separately configured docs project or workflow while preserving both protected-branch rulesets. No Vercel project is visible to the connected account, and this repository has no Vercel configuration, deploy workflow, GitHub deployment, or environment. Therefore a production deployment path is not currently evidenced; configure and verify it before claiming `/whats-new` can be deployed live independently.
- No historical screenshots or terminal recordings are checked into the repository. The source and CLI reference support the changelog-driven terminal command demonstrations shown for `v0.0.1` and `v0.1.0`. No visual artifact has been fabricated.
- Existing Release descriptions have not been edited. Updating a published description changes public release metadata, so the proposals below require explicit approval first.

## Proposed GitHub Release descriptions (approval required)

Exact proposed bodies are in [v0.0.1](RELEASE-DESCRIPTION-DRAFTS/v0.0.1.md), [v0.1.0](RELEASE-DESCRIPTION-DRAFTS/v0.1.0.md), and [v0.1.1](RELEASE-DESCRIPTION-DRAFTS/v0.1.1.md). They have not been applied to GitHub. Review them against the canonical entries and authorize the public metadata updates before any published release body is changed.

## Ongoing standard

For every release, verify the tag's peeled commit, GitHub Release date, package versions, merged PRs, linked issues, and source behavior. Record the evidence and discrepancies before editing notes. Keep `CHANGELOG.md` as the canonical history; render titles, dates, categories, issue links, and any verified terminal demo from that file. Prepare a GitHub Release description from the exact changelog section, then obtain explicit approval before applying it to an already-published release. For GitHub Packages, preserve the exact-tag successful workflow evidence and query authenticated registry metadata when the token has `read:packages`.
