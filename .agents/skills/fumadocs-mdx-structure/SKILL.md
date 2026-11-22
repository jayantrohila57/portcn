---

name: fumadocs-mdx-structure
description: Create or update Portcn Fumadocs pages in apps/docs/content/docs.
---

# Portcn Fumadocs

Read `apps/docs/AGENTS.md` and `apps/docs/content/docs/development/mdx-components.mdx` before editing. Use frontmatter with a factual title and description, and organize pages by reader task. Components are centrally registered; do not add imports for them. Use Steps, Tabs, Callouts, Cards, Accordions, Files and TypeTable where they help, and plain Markdown otherwise. Verify CLI examples, output and claims against the current implementation. Keep navigation metadata current, preserve the existing theme, and run `pnpm docs:check` and the docs build. Link canonical contributor files instead of duplicating policy.
