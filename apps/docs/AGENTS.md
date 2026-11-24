# Fumadocs

This site is built with [Fumadocs](https://fumadocs.dev) on Next.js. The APIs and conventions of Fumadocs may differ from your training data, so check its docs for the task at hand:

- Writing pages: https://fumadocs.dev/docs/next/markdown.md
- Organizing pages and folders: https://fumadocs.dev/docs/next/page-conventions.md
- Customizing the UI: https://fumadocs.dev/docs/next/guides/customize-ui.md
- Changing the theme and colors: https://fumadocs.dev/docs/ui/theme.md
- Upgrading Fumadocs: https://fumadocs.dev/docs/next/upgrade.md
- Other tasks: https://fumadocs.dev/llms.txt lists every docs page.

- Keep docs standalone from the CLI implementation and preserve Fumadocs navigation, search, metadata, and Solar theme tokens.
- Keep status and capability claims factual; update docs as working CLI functionality is added.
- Treat docs as required for user, contributor, architecture, dependency, configuration, workflow, security, or development changes. Identify affected pages before implementation, update docs in the same task, and verify examples against code. CLI commands and options must match the registered interface.
- Organize Fumadocs by task: getting started, CLI reference, guides, architecture, contributing, releases, security, open source, and development reference. Link canonical root and GitHub community files instead of duplicating them.
- Keep formatting in the shared root Biome configuration; avoid app-specific lint or formatter configuration.
- Keep the docs app deployable as an independent Next.js project. Its Vercel Root Directory is `apps/docs`; enable access to source files outside that root because `/whats-new` reads the root `CHANGELOG.md` and uses `scripts/changelog-policy.cjs`. Keep server rendering for routes that use runtime search parameters and search APIs; do not switch to static export without replacing those behaviors.
- Resolve the canonical metadata base from Vercel's production/deployment host variables and use localhost for local builds. Do not hardcode or guess a production domain.
- Vercel project configuration and deployment are owner approval gates. Leave project settings, branch tracking, domains, environment variables, and deployment state untouched until explicitly authorized.
- Use task branches from `dev` and target task PRs at `dev`. Docs-only changes do not trigger a CLI release; release-relevant behavior changes must use an appropriate Conventional Commit.
- Every commit and PR title must be Conventional, including docs-only work (use `docs:`); do not use narrative subjects.
- Use the official Fumadocs MDX components registered in `components/mdx.tsx` when they help explain the content. Follow `content/docs/development/mdx-components.mdx` for available components, usage examples, and when plain Markdown is clearer.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
