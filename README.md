# Sesame browser extension

Sesame supports Chrome and Edge on Windows. The same source also builds an
experimental Firefox package for compatibility work. Firefox is not a
supported store release.

This repository contains the extension's manifests, tests, release scripts,
and native-host compatibility checks. It builds without desktop source code.

It does not contain the vault, the desktop app, or the native messaging host.
See [CONTRIBUTING.md](CONTRIBUTING.md) for what lives where.

> **Load unpacked:** Point Chrome at `dist/chrome` and Edge at `dist/edge`. Do
> not select this source directory: it intentionally has no root
> `manifest.json`. See [LOAD-UNPACKED.md](LOAD-UNPACKED.md).

## Permission model

The extension asks for the minimum permissions by default:

- `activeTab`: temporary access to the active tab when the popup is opened.
- `scripting`: required to inspect or fill the active tab from the popup.
- `nativeMessaging`: required to talk to the local Sesame desktop app.
- `storage`: stores only the origins where the user explicitly pauses the
  inline control and the first-run onboarding preference.

The inline field button is **optional**. Onboarding or the popup asks once for
`https://*/*` through `optional_host_permissions`. After approval, the control
appears on focused, unambiguous sign-in and registration fields. It uses a
closed shadow root. You can pause it for the current origin, manage exceptions
in Options, or revoke the permission. The popup and `Ctrl+Shift+L` remain
available.

## Build

```powershell
npm ci
npm run build:chrome
# or
npm run build:edge
```

Output is written to `dist/<browser>/`. Load that directory as an unpacked
extension in Chrome or Edge.

## State machine

The fill flow is represented explicitly as:

```
disconnected → desktop-closed → locked → ready
ready → inspecting → awaiting-approval → filling → complete
                              ↘ cancelled / expired / failed
```

Credentials live only in the active call stack. If the service worker
terminates, the underlying native port closes and the request fails closed.

## Tests

The repository has unit coverage for detection, coordination, native protocol
validation, and card and identity filling. The automated browser suite has no
specs yet and its dedicated command prints a skip notice.

```powershell
npm run check
npm run lint
npm run design:tokens:check
npm run version:check
npm run test:unit
npm run build:chrome
npm run build:edge
npm run build:firefox
npm run package:stores
```

`npm run ci` runs the complete release gate. Run `npm run test:browser` after
browser-integration changes. It builds the integration bundle, then reports
that no browser specs exist.

The extension version is independent from the desktop version. Change
`package.json`, then run `npm run version:sync` to update the Chrome and Edge
manifests. The experimental Firefox manifest must match the package version too;
`npm run package:stores` enforces that when it creates the archives.
`npm run version:check` checks the package, Chrome, and Edge values.

## Store packages

```powershell
npm run release:check
```

That ends in `npm run package:stores`, which writes Chrome, Edge, and
experimental Firefox archives, their SHA-256 digests, and a dependency SBOM to
`store-packages/`.
Entry order, timestamps, and file modes are fixed, so the same commit and Node
version reproduce the same digests. The packager refuses a package that carries
the integration build's localhost host permissions, a stale manifest version, a
widened permission set, a source map, or an extension identity the pinned
native host would not answer.

Verify the Chrome and Edge archives in clean profiles before uploading. Unit
tests and integration builds do not replace either store's installation flow.

## Browser protocol compatibility

The desktop owns the native-messaging protocol. This repository keeps closed
schemas, fictional test vectors, source commits, and SHA-256 digests in
`contracts/browser/`. Version 1 covers capabilities, activation, login and
identity filling, and save requests. Version 2 covers card filling only.

Changing a wire shape needs a tagged contract and an explicit compatibility
decision. Updating TypeScript types alone is not enough.

Each request uses the version owned by its operation. The general operations
remain on version 1 while card requests use version 2; neither version is a
claim that every operation can negotiate between both contracts.

```powershell
npm run compat:host
```

That downloads the fixtures the desktop publishes, checks them against the
recorded digests at the pinned implementation commit, checks the compatibility
range at the desktop's tracking branch, and replays every downloaded vector
through the real validators. It runs on a schedule rather than in pull-request
CI. It needs network access to the desktop repository, and it needs
no token, because that repository is public; `SESAME_CONTRACT_TOKEN` is only
needed if it is ever made private again.

## Native host distribution

The native host belongs to, and ships with, the Sesame desktop product, not
this extension. This repository contains only the pinned identity contract used
to verify store manifests and an explicit development registration helper. A
production desktop release must install a signed, versioned host and support
upgrade and removal:

- **Install**: a signed MSI or EXE installer places the native host beside
  `sesame.exe`, writes the host manifest under the app's local data directory,
  and creates the registry key
  `HKCU\Software\Google\Chrome\NativeMessagingHosts\app.usesesame.browser`
  pointing to that manifest.
- **Upgrade**: the installer increments the host manifest `version`, stops the
  running host process, replaces the binary, and updates the registry path if it
  changed.
- **Repair**: the installer re-creates the registry key and rewrites the host
  manifest if either is missing.
- **Removal**: uninstall removes the registry key and host manifest before
  removing the desktop installation. The extension will then report
  `host-not-found` until the user reinstalls.

The host manifest pins the allowed extension origin. It must not allow arbitrary
extension IDs or debug hosts. The native host never opens the vault
independently; it only validates and relays requests to the local desktop broker.

For local development only, register an externally supplied desktop host path:

```powershell
.\install-native-host.ps1 -HostPath C:\path\to\sesame-browser-host.exe
```

The helper refuses debug binaries unless `-AllowDebugHost` is explicit, and it
cannot accept an arbitrary extension id. The host must be beside `sesame.exe`,
which is required for the helper to authenticate the desktop broker. Full
native-host launch and desktop approval tests are owned by the desktop product
because they require its binary and vault. This extension's CI uses a protocol
fixture and never receives a credential through an environment variable or test
log.

## Not in this beta

- Firefox (requires separate manifest and native-host allowlist format).
- Automatic submission, passkey interception, browsing-history collection,
  analytics, or background page scanning.
- Credentials are never written to `chrome.storage`, diagnostics, console
  output, extension badges, or error messages.

## Multi-step and SPA login support

Each fill action prepares and binds the exact current document. Modern sites
often split login across multiple steps or replace fields dynamically, so the
extension supports:

- **Phase detection**: the content script reports whether the current page has a
  username-only step, a password-only step, or a combined form.
- **Single-field requests and writes**: a safe username-only or password-only
  step requests and receives only its matching credential field. The other
  value does not cross the native response boundary or reach the page.
- **DOM observation**: the optional inline control now follows newly injected
  fields. The one-shot popup fill still prepares and binds the exact current
  document before approval.
- **Step sequencing**: the popup labels a username-only action explicitly. The
  user advances the website and triggers a new, separately approved fill for
  the password document.
- **No auto-advance**: the extension never clicks "Next" or "Sign in". The user
  advances the site manually and triggers each fill explicitly.
