## Summary

<!-- Describe the change and link the related issue, if any. -->

## Release notes

<!-- Categorize user-visible changes: Features, Fixes, Improvements, Performance, Breaking changes, or Docs-only. State affected packages. -->

## Documentation

<!-- List updated Fumadocs pages and summarize their coverage, or write: No documentation change required: <specific explanation>. -->

## Verification

- [ ] `pnpm precommit:check`
- [ ] Optional Docker image checks, if relevant
- [ ] `pnpm docs:check`

## Checklist

- [ ] The PR title is Conventional Commit format. Task PRs to `dev` use the title as their squash commit title; promotion, Release Please, and main-to-dev sync PRs use true merge commits.
- [ ] Documentation reflects the current implementation.
- [ ] Documentation summary lists changed pages or justifies `No documentation change required`.
- [ ] This task PR targets `dev` (or this is an authorized `dev` → `main` promotion, release-bot PR, or post-release sync).
- [ ] I reported my branch, task status, checks, PR target, and remaining steps.
