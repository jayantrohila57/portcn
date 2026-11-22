# GitHub automation guidance

- Preserve least-privilege workflow permissions and keep CI checks aligned with the root pnpm scripts.
- CI must run lint, format, types, tests, build, package, boundaries, and release checks through the Docker Compose test service; build and smoke-test the packaged CLI runtime image as well. Do not rely on Husky hooks in Actions.
- Release Please treats the workspace as one `portcn` release unit. Its supported `exclude-paths` filters docs, workflows, and maintenance scripts; changes under `apps/cli` and `packages/core` remain release-relevant. Use v-prefixed, uncomponentized tags.
- Before `1.0.0`, features and breaking changes advance minor versions and fixes advance patch versions. Keep `0.0.1` as the configured bootstrap version and let Release Please calculate the first release from unreleased commits.
- CI validates release metadata and npm packaging; do not publish to npm or create/move tags from CI without an explicit release design and authorization.
- Require Conventional Commits for every commit and PR title; do not preserve narrative-message exceptions for new work.
- CI branch policy requires task branches to target `dev`, `dev` promotions and verified Release Please bot PRs to target `main`, and only the explicit main-to-dev sync route as an exception.
- Run branch policy only for PR events. Push events to `dev` and `main` must still run full validation.
- Verify Release Please PR identity (`github-actions[bot]` for this workflow), exact configured source branch, `main` base, same repository, Conventional title, and a single valid `chore(main): release X.Y.Z` commit.
- Release Please needs workflow `contents`, `issues`, and `pull-requests` write permissions plus the repository Actions setting that permits GitHub Actions to create PRs. Keep default workflow permissions read-only.
- PR workflows created by `GITHUB_TOKEN` may require an owner to approve workflow runs before required checks execute. A narrowly scoped GitHub App/PAT secret can remove that approval gate if unattended CI is required.
- Repository rulesets, not these instructions, must require PRs and `branch-policy`/`validate` checks on `dev` and `main`, block deletion and non-fast-forward updates, and define no bypass actors.
- PR templates and CI must enforce the documentation deliverable: changed pages or a justified `No documentation change required`; CI validates MDX compilation, practical internal links, and objective CLI-reference consistency. Keep semantic coverage as a human review requirement.
