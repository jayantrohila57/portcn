# GitHub automation guidance

- Preserve least-privilege workflow permissions and keep CI checks aligned with the root pnpm scripts.
- CI must run lint, format, types, tests, build, package, and release checks directly; do not rely on Husky hooks in Actions.
- Release Please treats the workspace as one `portcn` release unit; CLI and core paths are in scope, while docs-only changes are out of scope. Use v-prefixed, uncomponentized tags.
- Before `1.0.0`, features and breaking changes advance minor versions and fixes advance patch versions. Keep the initial release at `0.0.1`.
- CI validates release metadata and npm packaging; do not publish to npm or create/move tags from CI without an explicit release design and authorization.
- Use Conventional Commits so Release Please can determine the intended version bump. Sentence-style legacy messages are accepted for compatibility but do not communicate a release type.
- CI branch policy requires task branches to target `dev`, `dev` promotions and verified Release Please bot PRs to target `main`, and only the explicit main-to-dev sync route as an exception.
