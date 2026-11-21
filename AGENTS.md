# Repository guidance

- Read the nearest `AGENTS.md` before changing a directory; keep `apps/docs` independently installable/buildable as a workspace app.
- Executable applications belong in `apps/`; reusable, platform-independent libraries belong in `packages/`.
- Put shared domain rules in `@portcn/core`; keep CLI presentation and future Linux-specific integrations outside the core package.
- Keep the root package private and named `@portcn/workspace`. Reserve the unscoped npm package name `portcn` for `apps/cli`.
- Use existing pnpm, Turborepo, Biome, TypeScript, and Vitest configuration. Avoid duplicate tools and dependencies.
- Install dependencies with the frozen lockfile; Husky runs staged Biome checks, Commitlint, and pre-push type/test checks locally. CI runs its checks directly with hooks disabled.
- Preserve strict TypeScript, focused tests, the existing docs branding/theme, and clear errors. Do not claim functionality that is not implemented.
- Update release metadata consistently for the CLI package, workspace root, and Release Please manifest; never edit versions outside Release Please.
- Use Conventional Commit types for changes that need Release Please to calculate a version bump; existing sentence-style commit subjects remain accepted for compatibility.
- Never push, publish, tag, or deploy without explicit authorization. Preserve existing tags.
- Run the relevant lint, format, type, test, build, release, and package checks before proposing changes.
- Every task starts by reading applicable `AGENTS.md` files, checking the working tree, fetching `origin/dev`, and branching from `dev`; never work directly on `main` or `dev`.
- Use `feat/*`, `fix/*`, `refactor/*`, `chore/*`, `docs/*`, `test/*`, `build/*`, `ci/*`, or `perf/*` task branches. Open PRs to `dev`; do not merge without authorization and passing required checks.
- Releases promote `dev` to `main` after roughly four or five merged tasks or on explicit request. Keep task commits during promotion; Release Please runs only on `main` and is the sole version editor.
- After release, synchronize `main` back to `dev` through the explicitly allowed sync PR. Never rewrite published history or move/delete tags.
- Report current branch, task status, checks run, PR target, and remaining steps at completion.
