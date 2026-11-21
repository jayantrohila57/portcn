# Package ownership

- Keep packages independently testable with one clear reusable responsibility. Packages may depend on other packages, never on apps.
- Keep `@portcn/core` platform-independent: domain models, types, validation, interfaces, and deterministic domain rules only. It must not depend on Linux APIs, Commander.js, React, Ink, or Next.js.
- Add `linux`, `terminal`, or `tui` only when real implementation needs that separate responsibility; do not add placeholders or move docs-site code into packages.
- Declare workspace dependencies in each package manifest, expose supported APIs through package exports, and test behavior within its owning package.
