# Contributing to portcn

Thanks for helping improve portcn. The CLI foundation is in place; port discovery and service management are not implemented yet.

## Requirements and setup

- Node.js 24 or later
- pnpm 12.3.4 (`corepack enable` can provide pnpm)
- Linux is the initial target for future CLI functionality; the docs app can be developed on supported Node.js platforms.

```sh
git clone https://github.com/jayantrohila57/portcn.git
cd portcn
git switch dev
pnpm install --frozen-lockfile
pnpm dev
```

The docs app runs on `http://localhost:3000`. Read the applicable `AGENTS.md` files before editing.

## Required task lifecycle

1. Check `git status`, fetch `origin/dev`, and update the local integration branch. Never start work on `main` or `dev`.
2. Create a task branch from `dev`: `feat/<name>`, `fix/<name>`, `refactor/<name>`, `chore/<name>`, `docs/<name>`, `test/<name>`, `build/<name>`, `ci/<name>`, or `perf/<name>`.
3. Implement the focused change, update tests and documentation, and run the checks below. Do not bypass failures or rewrite published history.
4. Use Conventional Commits, e.g. `feat(cli): discover listening ports`, `fix(core): reject invalid ports`, `perf(cli): reduce scan overhead`, or `docs: clarify setup`. Add `!` or a `BREAKING CHANGE:` footer for breaking changes. `feat` and breaking changes advance the minor version before 1.0.0; `fix` and `perf` advance patch unless marked breaking. Non-release types do not bump versions.
5. Open the task PR to `dev`, with a summary, affected packages, release-note category, and checks. Feature PR squash titles must remain Conventional Commits. Merge only after required checks pass and the authorized owner approves; use the PR title as the squash commit title. Delete the merged branch when appropriate.
6. Report current branch, status, checks, PR target, and remaining steps.

Ordinary PR branches must belong to this repository. The only `main` PR routes are a `dev` promotion, a verified Release Please bot PR, and an explicitly named `main-to-dev-sync` synchronization branch. CI validates the actual PR base/head repository and branch plus bot account identity; titles do not grant an exception.

## Checks

```sh
pnpm lint
pnpm format:check
pnpm check-types
pnpm test
pnpm build
pnpm package:check
pnpm boundaries:check
pnpm release:check
```

Husky runs staged Biome checks, Conventional Commit validation, and pre-push type/test checks. CI runs the full suite directly with hooks disabled.

## Promotion and releases

Allow about four or five completed task PRs to accumulate in `dev`, or prepare a promotion when the owner requests one. Create a PR from `dev` to `main` that preserves task commits (do not squash the promotion). Summarize all changes since the last release under Features, Fixes, Improvements, Performance, Breaking changes, and affected packages. Run the full integration checks. Merge only after the authorized repository owner explicitly approves.

Release Please runs only after changes reach `main`. It aggregates the Conventional Commit history and opens the single `portcn` release PR, updating `CHANGELOG.md`, root and CLI package versions, and `.release-please-manifest.json`. No component prefix is used; tags are `vX.Y.Z`. The initial release is `0.0.1`. Before 1.0.0, features and breaking changes advance minor, fixes advance patch. Core changes can affect CLI behavior and are included; docs-only changes are excluded. Breaking changes after 1.0.0 require a major version.

The owner must review the release PR, changelog, matching version files, and passing CI, then explicitly authorize merging it. Do not edit versions manually, create/move/delete tags, or publish a GitHub Release/npm package during setup. Preserve every existing tag; correct mistakes by fixing forward. After release, open an explicit `main-to-dev-sync` PR from `main` back to `dev` and merge after checks pass.

GitHub rulesets must require PRs and passing `branch-policy` and `validate` checks on `dev` and `main`, block direct pushes, deletion, and force pushes, and require zero approvals so a solo owner can merge. Protect Release Please PRs through narrowly scoped bot bypass for PR creation/update only if needed; never permit the bot to bypass checks or merge. Configure the GitHub settings from the repository owner account; repository CI alone cannot establish these rulesets.
