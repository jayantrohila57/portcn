# Documentation site deployment

`apps/docs` is a private pnpm workspace app that can be built independently with `pnpm --filter @portcn/docs build`. It is designed to use a separate Vercel project and does not require a CLI release. Project creation, settings, domains, and deployments require explicit owner authorization.

## Vercel project settings

After authorization, create a Vercel project for `jayantrohila57/portcn` with these settings:

- **Root Directory:** `apps/docs`
- **Framework Preset:** Next.js
- **Include source files outside the Root Directory:** enabled
- **Production Branch:** `main`
- **Build Command:** use the detected `pnpm build` script in `apps/docs/package.json`
- **Install Command:** use the repository's pnpm workspace lockfile and frozen install

The outside-root setting is required: the What's New route reads `../../CHANGELOG.md` at build/runtime and loads the canonical changelog parser from `scripts/changelog-policy.cjs`. The docs package has a unique workspace name and its own Next.js build script.

Keep the default Next.js server deployment. `/whats-new` uses request-time year filtering and the app includes a search route; a static export would not preserve the current route behavior. Canonical metadata uses Vercel's production host when available, then the deployment host, and falls back to `http://localhost:3000` in local builds.

## Release and branch behavior

Release Please excludes `apps/docs`, so documentation changes do not create CLI versions or package publications. Let the Vercel Git integration create previews for task pull requests. Production must track protected `main`; changes still pass through the existing `dev` checks and the protected `dev` to `main` promotion PR. Do not change branch rulesets to enable deployment.

This repository currently has no configured Vercel project or recorded deployment. Verify Root Directory, outside-root source access, workspace install, production branch, preview, and production URL after an authorized setup. Until then, describe deployment as prepared but not configured or live.
