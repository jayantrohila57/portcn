# GitHub automation guidance

- Preserve least-privilege workflow permissions and keep CI checks aligned with the root pnpm scripts.
- Release Please is scoped only to `apps/cli`; use the unscoped `portcn` package name and v-prefixed, uncomponentized tags.
- Before `1.0.0`, features and breaking changes advance minor versions and fixes advance patch versions. Keep the initial release at `0.0.1`.
- CI validates release metadata and npm packaging; do not publish to npm or create/move tags from CI without an explicit release design and authorization.
- Use Conventional Commits so Release Please can determine the intended version bump.
