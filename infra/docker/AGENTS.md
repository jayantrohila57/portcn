# Docker development environment

- Build the runtime from the current CLI and core source, package it during the image build, and install that artifact in the minimal runtime stage.
- Run workspace validation on the host using the regular pnpm scripts and frozen lockfile, as required by Git hooks. The test container is an optional additional check; CI runs workspace scripts on its GitHub Actions runner.
- Keep host-facing tasks behind the root `docker:*` package scripts and this Compose project.
- Keep the runtime image free of workspace source, development dependencies, and workspace-only runtime imports.
- Preserve ordinary Compose namespace isolation. Do not add privileged containers, host PID/network namespaces, or Docker socket mounts by default.
- Future discovery tests may add isolated fixture services under a dedicated profile. Do not add placeholder fixtures before discovery exists.
