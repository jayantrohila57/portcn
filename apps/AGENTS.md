# Application ownership

- Keep application entry points, routes, orchestration, commands, and application-specific presentation in `apps/`.
- Put reusable behavior in a package only when a clear responsibility, reuse case, or testing benefit justifies it; apps may depend on packages through declared workspace dependencies.
- Do not import one application from another. Keep docs routes, Fumadocs loaders, UI, layouts, and styles inside `apps/docs`.
- Test application behavior at its entry points and use package tests for reusable behavior. Do not add placeholder apps or packages.
- Before coding, identify documentation impact. Update relevant Fumadocs pages in the same task and verify documented commands and examples against implementation. PRs must list changed docs or justify `No documentation change required`.
