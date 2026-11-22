## Summary

<!-- Describe the change and link the related issue, if any. -->

## Release notes

<!-- Categorize user-visible changes: Features, Fixes, Improvements, Performance, Breaking changes, or Docs-only. State affected packages. -->

## Documentation

<!-- List updated Fumadocs pages and summarize their coverage, or justify: No documentation change required. -->

## Verification

- [ ] `pnpm docker:test` (local CLI checks)
- [ ] `pnpm docker:build` (local packaged runtime)
- [ ] `pnpm docs:check`

## Checklist

- [ ] The PR title is Conventional Commit format and matches the intended squash commit title.
- [ ] Documentation reflects the current implementation.
- [ ] Documentation summary lists changed pages or justifies `No documentation change required`.
- [ ] This task PR targets `dev` (or this is an authorized `dev` → `main` promotion, release-bot PR, or post-release sync).
- [ ] I reported my branch, task status, checks, PR target, and remaining steps.
