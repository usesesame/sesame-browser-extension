# Contributing to the Sesame browser extension

This repository holds a single product: the Chrome and Edge extension. It carries
its own version, lockfile, release cadence, and store review. The vault, the
desktop app, and the native messaging host are not part of it.

## What lives elsewhere

| You want to change | Repository |
| --- | --- |
| Vault, unlock, crypto, backup, import | `usesesame/sesame-desktop` |
| The native messaging host binary and its registration | `usesesame/sesame-desktop` |
| The wire protocol between the extension and the host | `usesesame/sesame-desktop`, then re-vendor here |
| Account API, admin portal, self-hosting | `usesesame/sesame-server` |
| Marketing pages and public documentation | `usesesame/sesame-website` |

The desktop owns the protocol because it owns the host. This repository keeps a
tagged, digest-bound copy under `contracts/browser/v1/`. Editing the TypeScript
types without first landing a new tagged contract is a bug rather than a
protocol change.

## Your first change

```bash
npm ci
npm run ci
```

`npm run ci` runs from a fresh clone that has no desktop app, no vault, and no
native host installed. It needs Node.js 24.13. If it fails before you have
touched anything, the problem is your toolchain rather than your change.

Then read:

1. [README.md](README.md) for the permission model, the fill state machine, and
   the protocol boundary.
2. [SECURITY.md](SECURITY.md) for what counts as a vulnerability here.
3. [LOAD-UNPACKED.md](LOAD-UNPACKED.md) for loading a local build.

## Never include secrets

Do not commit or attach real passwords, vaults, exports, PINs, recovery kits,
backup codes, TOTP seeds, or account tokens. Tests, fixtures, and conformance
vectors use fictional data only. A credential must never reach a test log, a
screenshot, an environment variable, or a diagnostic.

## Code rules

Of all the Sesame surfaces, only this extension runs inside a page it does not
control, so its lint rules are stricter than the rest of the product. The rules
are in `eslint.config.js`, each with its reason next to it. In short:

- Credentials live in the active call stack only. Nothing credential-shaped is
  written to `chrome.storage`, a badge, a diagnostic, a console, or an error
  message. `chrome.storage` holds inline-control preferences and nothing else;
  the eslint config's `no-restricted-globals` rule keeps page-origin storage
  out of the extension for the same reason.
- No markup parsing and no runtime code construction in a content script. Build
  nodes.
- Every fill binds one document, one tab, one window, and one normalized
  origin, and rechecks all four before a write.
- The extension never submits a form and never clicks through a login step.

## Before review

| You changed | Run |
| --- | --- |
| Anything | `npm run release:check` |
| `src/content/`, `src/background/`, or `src/permissions/` | `npm run ci`, including the browser tests |
| `src/protocol/` or `contracts/` | `npm run ci` and `npm run compat:host` |
| `manifests/` | `npm run release:check` and load both unpacked builds |

Name the exact commands in the pull request. "Tested" is not an answer.

## Changing the protocol

1. Land the wire change in the desktop repository with a new tagged contract
   directory, for example `contracts/browser/v2/`.
2. Copy that directory here, byte for byte, and record its source commit and
   SHA-256 digests in `SOURCE.json`.
3. Set the compatibility range deliberately. An extension in the store keeps
   talking to hosts users have not updated yet, so the minimum supported host
   version is a support commitment rather than a formality.
4. Keep the old version's tests passing until the range no longer includes it.

`npm run compat:host` downloads the desktop's published fixtures and fails when
the vendored snapshot has drifted or the compatibility range no longer covers
this extension.

## Releasing to the stores

1. Set the version in `package.json`, then run `npm run version:sync`.
2. Open a pull request. `npm run ci` must pass.
3. Tag `v<version>` on `main`. The release workflow builds both store packages,
   records their SHA-256 digests, and generates the dependency SBOM.
4. Verify the Chrome and Edge packages by hand in a clean profile before
   uploading. Automated Chromium coverage is regression evidence; it is not the
   supported installation flow for either store.
5. Chrome and Edge keep separate extension identities. The native host manifest
   pins exact extension origins with no wildcards, so both identities must be
   verified in every release.

## Reporting a security issue

Do not open a public issue. Follow [SECURITY.md](SECURITY.md).
