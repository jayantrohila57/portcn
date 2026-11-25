# CLI guidance

- Keep command parsing and user-facing output in this app; keep reusable validation and domain rules in `@portcn/core`.
- Preserve the `portcn` command name, `p:` help branding, Commander conventions, Node 24 target, and executable shebang.
- Keep output predictable, errors actionable, exit codes meaningful, and permissions minimal. Avoid platform inspection or side effects until a feature explicitly requires them.
- Keep workspace-only packages out of published runtime dependencies; verify the bundled package with `pnpm package:check`.
- Run unit tests and workspace validation with the regular pnpm scripts. Docker Compose commands (`pnpm docker:cli`, `pnpm docker:build`) are optional packaged-image checks; they are not required by Git hooks or CI.
- Add focused tests for command output, package imports, and behavior. Do not implement discovery, process management, Docker, or a TUI in the foundation.
- Let the root Husky pre-commit hook run workspace validation; CI independently runs the full validation suite.
- Follow the root task branch lifecycle: branch from `dev`, target task PRs at `dev`, and use Conventional Commit titles for release-relevant changes.
- Every commit and PR title must be Conventional; do not use narrative subjects.
- `diagnose` must reuse the CLI's existing listener discovery and process inspection, preserve every visible owner, and explain permission/namespace visibility limits without elevating privileges or changing processes.
- Before coding, identify CLI reference and guide impact. Update Fumadocs pages in the same task, documenting only implemented behavior, and verify commands, options, output, errors, and exit codes against code. PRs must list changed docs or justify `No documentation change required`.
