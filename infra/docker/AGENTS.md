# Docker development environment

- Build the runtime from the current CLI and core source, package it during the image build, and install that artifact in the minimal runtime stage.
- Keep monorepo validation in the test container with the frozen pnpm lockfile. Do not execute the CLI or its tests on the host.
- Keep host-facing tasks behind the root `docker:*` package scripts and this Compose project.
- Keep the runtime image free of workspace source, development dependencies, and workspace-only runtime imports.
- Preserve ordinary Compose namespace isolation. Do not add privileged containers, host PID/network namespaces, or Docker socket mounts by default.
- Future discovery tests may add isolated fixture services under a dedicated profile. Do not add placeholder fixtures before discovery exists.
