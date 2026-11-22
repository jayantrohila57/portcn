# Changelog

## Unreleased

### Features

- publish cli to github packages <!-- task:feat/github-packages-publishing -->

- publish cli through release please <!-- task:feat/npm-trusted-publishing -->

- Add default CLI output and support invocation through a global symlink. [#9](https://github.com/jayantrohila57/portcn/pull/9)

### Fixes

- validate release workflow shell <!-- task:fix/release-workflow-validation -->

- dispatch GitHub Packages publication <!-- task:fix/release-package-dispatch -->

- allow secure fork contributions <!-- task:fix/allow-fork-contributions -->

- configure github packages authentication <!-- task:fix/github-packages-auth -->

- correct initial release candidate <!-- task:fix/release-candidate-baseline -->

- harden npm publication workflow <!-- task:fix/npm-publish-workflow -->

- Run the full workspace validation suite before commits and validate commit messages with Commitlint. [#11](https://github.com/jayantrohila57/portcn/pull/11)

### Improvements

- Run Git hooks using pnpm on the host; Docker Compose remains an optional packaged CLI and validation workflow. [#10](https://github.com/jayantrohila57/portcn/pull/10)
- Add a Docker Compose setup that builds and runs the packaged CLI and provides optional workspace checks. [#9](https://github.com/jayantrohila57/portcn/pull/9)

### Documentation

- Add Fumadocs guides for getting started, the CLI, architecture, development, Docker, contributing, releases, security, and open source. [#9](https://github.com/jayantrohila57/portcn/pull/9)

### Maintenance

- establish single-checkout task safeguards <!-- task:chore/automate-development-lifecycle -->

## Proposed 0.0.1 release candidate (not released)

The corrected release candidate is commit `d495d5b0ce3b0e9fd5f9b4df4aec0f9ab7d204ee` on `dev`. It includes symlink-safe CLI execution and has not been tagged or published.

- Provide the `portcn` CLI foundation with branded help and version output; port discovery and service management are not implemented.
- Provide private `@portcn/core` port-number validation and a Fumadocs site.
- Validate task, promotion, synchronization, and Release Please PR routes and release metadata. [#1](https://github.com/jayantrohila57/portcn/pull/1), [#3](https://github.com/jayantrohila57/portcn/pull/3), [#5](https://github.com/jayantrohila57/portcn/pull/5)

Release Please maintains official versioned release notes. The manifest version is `0.0.1`; no release has been published yet.
