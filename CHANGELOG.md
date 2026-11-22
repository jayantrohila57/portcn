# Changelog

## Unreleased

### Features

- Add default CLI output and support invocation through a global symlink. [#9](https://github.com/jayantrohila57/portcn/pull/9)

### Fixes

- Run the full workspace validation suite before commits and validate commit messages with Commitlint. [#11](https://github.com/jayantrohila57/portcn/pull/11)

### Improvements

- Run Git hooks using pnpm on the host; Docker Compose remains an optional packaged CLI and validation workflow. [#10](https://github.com/jayantrohila57/portcn/pull/10)
- Add a Docker Compose setup that builds and runs the packaged CLI and provides optional workspace checks. [#9](https://github.com/jayantrohila57/portcn/pull/9)

### Documentation

- Add Fumadocs guides for getting started, the CLI, architecture, development, Docker, contributing, releases, security, and open source. [#9](https://github.com/jayantrohila57/portcn/pull/9)

### Maintenance

- establish single-checkout task safeguards <!-- task:chore/automate-development-lifecycle -->

## Proposed 0.0.1 baseline (not released)

The proposed baseline is commit `846b45801d808bd728161ccc0e3bf4941c5d6756` on `main`. It has not been tagged or published.

- Provide the `portcn` CLI foundation with branded help and version output; port discovery and service management are not implemented.
- Provide private `@portcn/core` port-number validation and a Fumadocs site.
- Validate task, promotion, synchronization, and Release Please PR routes and release metadata. [#1](https://github.com/jayantrohila57/portcn/pull/1), [#3](https://github.com/jayantrohila57/portcn/pull/3), [#5](https://github.com/jayantrohila57/portcn/pull/5)

Release Please maintains official versioned release notes. The manifest version is `0.0.1`; no release has been published yet.
