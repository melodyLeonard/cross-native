# Releasing

How the four npm packages are versioned and published. This is for maintainers;
users don't need it.

## The packages

Published in dependency order:

1. `@cross-native/languages` — the language registry (no deps)
2. `@cross-native/core` — the runtime and JS API
3. `@cross-native/compiler` — the CLI and per-language build drivers
4. `react-native-cross-native` — the React Native package and Metro transformer

The three scoped packages live under the `@cross-native` npm org. All four are
published with `--access public` and the `alpha` dist-tag while the API settles.

## Packages ship compiled JavaScript

The source is TypeScript, but Node cannot strip TypeScript types from files under
`node_modules`, so an installed package must contain plain JavaScript. Each
package builds its `src` to `dist` with `tsc` and points `main` at
`dist/index.js`. `scripts/build-packages.mjs` runs that build for every package
and verifies `dist/index.js` was written — the compiler emits JS even when there
are type errors, so the script checks the output rather than trusting the exit
code. `dist` is git-ignored and rebuilt in CI.

## How a release happens

Publishing runs in GitHub Actions (`.github/workflows/publish.yml`), never from a
laptop. The workflow authenticates to npm with the `NPM_TOKEN` repo secret (a
granular access token with read/write to the packages), so no npm password or 2FA
code is ever handled locally.

1. Bump the version in all four `packages/*/package.json`. Keep them in lockstep,
   and update the `@cross-native/*` entries in the dependents' `dependencies` to
   the same version.
1. Tag the Rust runtime crate and push the tag: the generated Cargo manifest
   pins `crossnative` to a git tag (`CRATE_TAG` in
   `packages/compiler/src/drivers/rust.ts`) so installed-from-npm builds are
   reproducible. Create a matching tag on the release commit
   (`git tag crossnative-v<version> <commit> && git push origin crossnative-v<version>`)
   and bump `CRATE_TAG` to it. Without this, a Rust build from a fresh install
   would fail to resolve the crate.
2. Commit with `[publish]` in the message and push to `main` (or run the
   **Publish** workflow manually from the Actions tab). The workflow only
   publishes on `[publish]` commits or manual dispatch, so ordinary pushes never
   release.
3. The workflow installs deps, builds all `dist`, then publishes each package in
   order. It is idempotent: a version already on the registry is skipped, so a
   re-run after a partial failure only publishes what's missing.

## Verifying a release

From a fresh React Native app (the repo's `PiBench` is set up for this):

```
npm install react-native-cross-native@<version>
npx react-native bundle --entry-file index.js --platform ios \
  --dev false --bundle-output /tmp/app.jsbundle --reset-cache
```

A clean install with no peer-dependency errors, and a bundle that compiles the
source files (you'll see `Building <Language> module` lines and the compiled
modules land in the bundle), means the release works end to end.

## Notes

- The three scoped packages need the `@cross-native` org to exist and the token
  to have write access to it. `react-native-cross-native` is unscoped.
- `prepublishOnly` is intentionally absent: the workflow builds `dist` before the
  publish step, and a `prepublishOnly` that re-ran `tsc` would abort the publish
  on any latent type error.
