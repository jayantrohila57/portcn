# GitHub automation guidance

- Preserve least-privilege workflow permissions and keep CI checks aligned with the root pnpm scripts.
- CI must run lint, format, types, tests, build, package, boundaries, release, and documentation checks directly on the GitHub Actions runner with hooks disabled. Docker Compose is for local CLI builds and checks; CI does not need to run Docker.
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
- PR templates must require the documentation deliverable; CI checks objective documentation consistency but cannot assess semantic completeness: changed pages or a justified `No documentation change required`; CI validates MDX compilation, practical internal links, and objective CLI-reference consistency. Keep semantic coverage as a human review requirement.

- Task PRs to dev must include a generated Unreleased entry matching the PR title and branch; CI verifies it. Semantic accuracy still requires review.
