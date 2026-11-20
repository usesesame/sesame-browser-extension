# Sesame browser extension

This is the browser extension for the Sesame password manager. It fills logins,
identities, cards and one-time codes on web pages, and every fill needs your
approval in the Sesame desktop app. The extension never holds your vault and
never submits a form for you.

It supports Chrome and Edge on Windows and Linux, and it needs
Sesame desktop 0.3.0 or later. Desktop 0.6.0 adds the "Whole site" and
"Never fill" rules for a login and lets the extension create and change
passwords. With an older desktop it still fills logins on their saved address
and asks you to update Sesame before it creates or changes a password. On Linux, install the browser from your system
packages or from its vendor, because a Snap or Flatpak browser cannot reach
desktop apps. An experimental Firefox build comes from the
same source, but it is not a supported release yet.

## Install

Most people should install Sesame from the
[Chrome Web Store](https://chromewebstore.google.com/detail/sesame/aodkkjabifjcbppgccgjidcmaiamddla).
Edge can install it from there too.

You can also download `sesame-extension-<version>-chromium.zip` from
[Releases](https://github.com/usesesame/sesame-browser-extension/releases).
Unzip it, open the extensions page in Chrome, Edge or Chromium, turn on
developer mode and choose Load unpacked. This copy connects to the desktop app
like the store version, but the browser won't update it, so install each new
release by hand.

## Using it

Open the toolbar popup on a sign-in page and choose Fill, or press
`Alt+Shift+L` on Windows and Linux or `Command+Shift+L` on Mac. Press
`Alt+Shift+F` or `Command+Shift+I` to fill your saved identity instead.

If you allow it once, a small Sesame button also appears under sign-in, sign-up
and address fields when you click into them. It only fills after you click it,
and it stays disabled while anything covers it. You can pause it for a site in
Options or remove the permission to turn it off.

## Development

You need Node.js 24.20 and a Chromium for the browser tests.

```sh
npm ci
npm run build:chrome
npm run verify
```

Load `dist/chrome` or `dist/edge` with Load unpacked to try your build.
[LOAD-UNPACKED.md](LOAD-UNPACKED.md) explains why the source folder itself
can't be loaded. `npm run verify` runs everything a pull request needs, including
a real Chromium, and [CONTRIBUTING.md](CONTRIBUTING.md) lists what to run for
each kind of change.

## How it talks to the desktop app

The desktop app owns the native messaging protocol, and this repository keeps a
pinned copy of each version under `contracts/browser/`. Version 1 covers
identities, saving and the basic requests, version 2 covers cards, version 3
and version 5 cover logins, version 4 covers one-time codes, version 6 adds the
capability check, version 7 lets a login match anywhere on the same site
when its rule allows that, and version 8 lets the desktop create and keep new
passwords for sign-up and password changes. Changing the wire format starts with a new contract in
the desktop repository.

The native host that the browser starts ships with the desktop app, which
registers it for each supported browser on every start.
[DESIGN.md](DESIGN.md) covers the host, the fill flow and the security limits,
and [SECURITY.md](SECURITY.md) says how to report a problem.

## Releases

A version tag runs the release workflow. It builds the Chrome, Edge and Firefox
packages, attests them and drafts a GitHub pre-release with the downloadable
Chromium zip. [CONTRIBUTING.md](CONTRIBUTING.md#releasing-to-the-stores) has
the steps.
