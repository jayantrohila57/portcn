# CLI guidance

- Keep command parsing and user-facing output in this app; keep reusable validation and domain rules in `@portcn/core`.
- Preserve the `portcn` command name, `p:` help branding, Commander conventions, Node 24 target, and executable shebang.
- Keep output predictable, errors actionable, exit codes meaningful, and permissions minimal. Avoid platform inspection or side effects until a feature explicitly requires them.
- Keep workspace-only packages out of published runtime dependencies; verify the bundled package with `pnpm package:check`.
- For local development, run the CLI, its package-install checks, unit tests, and validation inside Docker Compose (`pnpm docker:cli`, `pnpm docker:test`). Never install `portcn` globally on the host. CI runs workspace checks directly on GitHub Actions with hooks disabled.
- Add focused tests for command output, package imports, and behavior. Do not implement discovery, process management, Docker, or a TUI in the foundation.
- Let the root Husky pre-push hook run workspace type checks and tests; CI independently runs the full validation suite.
- Follow the root task branch lifecycle: branch from `dev`, target task PRs at `dev`, and use Conventional Commit titles for release-relevant changes.
- Every commit and PR title must be Conventional; do not use narrative subjects.
- Before coding, identify CLI reference and guide impact. Update Fumadocs pages in the same task, documenting only implemented behavior, and verify commands, options, output, errors, and exit codes against code. PRs must list changed docs or justify `No documentation change required`.
