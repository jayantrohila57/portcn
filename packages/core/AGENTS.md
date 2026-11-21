# Core package guidance

- Keep this package platform-independent and free of CLI presentation, operating-system process inspection, and Linux-specific integrations.
- Export only reusable, typed domain behavior needed by applications. Avoid placeholder APIs and unused abstractions.
- Validate inputs at boundaries, keep functions deterministic where practical, and add focused boundary tests.
- Keep the package private until there is an explicit decision to publish it independently.
- Add tests for shared behavior; root pre-push runs all workspace type checks and available tests.
- Core behavior used by the CLI participates in the single `portcn` release; describe user-visible effects with `feat`, `fix`, or `perf` commits and follow the root branch lifecycle.
