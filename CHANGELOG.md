# Changelog

All notable changes to Portcn are documented here. Dates use India Standard Time (IST).

## Unreleased

### Added

- discover containers and compose port mappings ([#101](https://github.com/jayantrohila57/portcn/issues/101)) <!-- task:feat/docker-compose-discovery -->

- persist favorites aliases and custom service groups ([#100](https://github.com/jayantrohila57/portcn/issues/100)) <!-- task:feat/saved-service-config -->

- add service table and contextual details ([#97](https://github.com/jayantrohila57/portcn/issues/97)) <!-- task:feat/service-table-context -->

- establish terminal design system ([#118](https://github.com/jayantrohila57/portcn/issues/118)) <!-- task:feat/tui-design-system -->

- verify endpoints against expected projects ([#108](https://github.com/jayantrohila57/portcn/issues/108)) <!-- task:feat/endpoint-project-verification -->

- add read-only process ownership safety checks ([#111](https://github.com/jayantrohila57/portcn/issues/111)) <!-- task:fix/read-only-process-safety -->

- attribute agent-started services and detect leftover processes ([#103](https://github.com/jayantrohila57/portcn/issues/103)) <!-- task:feat/agent-process-attribution -->

- associate listening services with projects and worktrees ([#96](https://github.com/jayantrohila57/portcn/issues/96)) <!-- task:feat/project-worktree-evidence -->

- check port availability and suggest alternatives ([#99](https://github.com/jayantrohila57/portcn/issues/99)) <!-- task:feat/port-availability -->

- add versioned JSON contracts ([#98](https://github.com/jayantrohila57/portcn/issues/98)) <!-- task:feat/agent-json-diagnostics -->

### Changed

### Fixed

### Deprecated

### Removed

### Security

## [0.3.0] - 2026-11-25

[0.3.0]: https://github.com/jayantrohila57/portcn/compare/v0.2.0...v0.3.0

**Title:** Port conflict diagnosis

**Terminal demo:** `portcn diagnose 3000 --json`

### Added

- diagnose port conflicts with owner and namespace details ([#95](https://github.com/jayantrohila57/portcn/issues/95)) <!-- task:feat/port-conflict-diagnosis -->

## [0.2.0] - 2026-11-25

[0.2.0]: https://github.com/jayantrohila57/portcn/compare/v0.1.1...v0.2.0

**Title:** A steadier terminal dashboard

### Fixed

- Keep dashboard selection and pagination aligned after filtering or tab changes, and restore the terminal and cursor on quit, Ctrl+C, or rendering failures ([#94](https://github.com/jayantrohila57/portcn/issues/94)).

## [0.1.1] - 2026-11-24

[0.1.1]: https://github.com/jayantrohila57/portcn/compare/v0.1.0...v0.1.1

**Title:** More reliable package publishing

### Changed

- Add CLI usage and license files to the package and record the verified `portcn@0.1.0` npm publication ([#70](https://github.com/jayantrohila57/portcn/issues/70), [#72](https://github.com/jayantrohila57/portcn/issues/72)).
- Harden GitHub Packages validation for exact tags and the shared CLI build, retaining the legacy `0.1.0` tarball validation exception ([#71](https://github.com/jayantrohila57/portcn/issues/71), [#79](https://github.com/jayantrohila57/portcn/issues/79), [#81](https://github.com/jayantrohila57/portcn/issues/81)).
- Keep release notes reconciled with the published history and retain issue, pull request, and commit references ([#85](https://github.com/jayantrohila57/portcn/issues/85), [#87](https://github.com/jayantrohila57/portcn/issues/87), [#90](https://github.com/jayantrohila57/portcn/issues/90)).
- Keep promotion checks compatible with protected synchronization merges between `main` and `dev` ([#75](https://github.com/jayantrohila57/portcn/issues/75), [#76](https://github.com/jayantrohila57/portcn/issues/76), [#77](https://github.com/jayantrohila57/portcn/issues/77)).

## [0.1.0] - 2026-11-24

[0.1.0]: https://github.com/jayantrohila57/portcn/compare/v0.0.1...v0.1.0

**Title:** Port discovery and an interactive dashboard

**Terminal demo:** `portcn list --interactive` · `portcn list --json` · `portcn inspect 3000`

### Added

- List listening TCP and UDP ports ([#23](https://github.com/jayantrohila57/portcn/issues/23)), then inspect a port's listeners and best-effort process details on Linux ([#30](https://github.com/jayantrohila57/portcn/issues/30)).
- Open an interactive terminal dashboard with All, TCP, UDP, and With Process tabs; select rows, search, sort, refresh, and inspect listener details ([#32](https://github.com/jayantrohila57/portcn/issues/32), [#37](https://github.com/jayantrohila57/portcn/issues/37), [#38](https://github.com/jayantrohila57/portcn/issues/38), [#39](https://github.com/jayantrohila57/portcn/issues/39)).
- Return machine-readable JSON from both `list` and `inspect` commands ([#41](https://github.com/jayantrohila57/portcn/issues/41)).
- Add bordered tables and terminal colors, with plain output for non-interactive pipes ([#31](https://github.com/jayantrohila57/portcn/issues/31)).

### Fixed

- Keep dashboard tabs, tables, navigation, and keyboard guidance readable across terminal widths and heights ([#33](https://github.com/jayantrohila57/portcn/issues/33), [#34](https://github.com/jayantrohila57/portcn/issues/34), [#35](https://github.com/jayantrohila57/portcn/issues/35), [#36](https://github.com/jayantrohila57/portcn/issues/36), [#40](https://github.com/jayantrohila57/portcn/issues/40)).

### Security

- Allow contributions from forks without exposing repository write credentials to their pull request workflows ([#22](https://github.com/jayantrohila57/portcn/pull/22)).

## [0.0.1] - 2026-11-22

[0.0.1]: https://github.com/jayantrohila57/portcn/releases/tag/v0.0.1

**Title:** Portcn CLI foundation

**Terminal demo:** `portcn --version` · `portcn --help`

### Added

- Install the `portcn` command and use `--version`, `--help`, or no arguments for the default branded output. Port discovery and process or service management were not part of this release.
