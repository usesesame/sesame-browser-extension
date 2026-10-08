# Sesame browser helper design

Status: pre-release integration for Windows and Linux. Page filling works today between the Chromium extension and a running desktop app of version 0.3.0 or later. The Windows installers and the Linux deb and rpm packages bundle the native-messaging host, and Sesame registers and repairs the current-user Chrome and Edge connection automatically at startup without administrator access or user-run scripts. The Linux AppImage registers no host. The browser extension still requires ordinary user-confirmed browser installation, and it has not been independently audited or approved for store publication.

## Boundary

The unlocked vault may be read only by the desktop application. The browser helper reaches it over Chromium native messaging and a private local channel, which is a named pipe on Windows and a Unix socket on Linux. There is no localhost HTTP server, network listener, cloud-vault request, web vault, or web-page message bridge.

The extension holds the `activeTab`, `contextMenus`, `nativeMessaging`, `scripting`, and `storage` permissions. Opening the popup grants a narrow, temporary look at the active page. That look reports capped field counts and a form classification only; it does not read field values, page text, form actions, paths, query strings, cookies, or storage. During one-time onboarding the user can grant optional access to all HTTPS pages, so the inline control is available without per-site setup. Extension storage keeps only the first-run preference and the exact origins where the user explicitly paused that control; it never contains credentials or visited-site history.

## Inline overlay

After the one-time HTTPS grant, the dynamically registered `content-overlay.js` script is available across websites. It shows a small "Fill with Sesame" control only when a safe field receives focus, and a "Fill code" button when the focused field is a one-time code target. Before it attaches, the overlay asks the background worker for an exact-origin pause decision, and if that policy cannot be verified, the control stays hidden. It is a trigger and status surface only, never reads or transmits field values, and lives in a closed shadow root so the page cannot read its UI. The shadow host pins itself with `:host { all: initial; opacity: 1 !important }` next to the design tokens and releases nothing until an IntersectionObserver v2 `trackVisibility` reading stays visible for at least 100 ms, re-armed after every top-layer change, so the control stays disabled while it is covered, transparent or animated. Every release action also rechecks the host and its ancestors, the element under the pointer and that the click is trusted, then takes a fresh visibility reading and releases only if it is still visible. That reading catches a cover revealed by a stylesheet change, which no DOM observer sees. A cover shown for less than one reading interval of about 100 ms and removed when the click starts is not caught. A page popover, modal dialog, fullscreen element, or a browser without the v2 API keeps the release controls disabled and points the user at the popup. Extension pages refuse to mount inside a frame. Clicking the control starts the same fill flow that the popup or `Ctrl+Shift+L` starts: the request still binds to the active tab and exact origin, the desktop app must still approve it, and the strict origin relationship is rechecked before any credential is written. The page itself cannot start a fill because the extension exposes no externally connectable surface. Registration is synchronized on install, startup, and browser permission changes; explicit pause exceptions affect only the inline control.

Saving is explicit. A successful fill, or a generated registration password, arms the active tab in memory with its page origin and a ten-minute TTL, and the popup offers "Save this login" only while that arm is live. The arm drops on tab close or cross-origin navigation. While armed, the popup may ask `src/content/signup-capture.ts` to read a registration or password-change form, and that helper reads nothing until the popup asks; no submit listener and no navigation trigger remain. The background validates the capture against the delivering frame origin, refuses an unarmed save, and a successful save drops the arm. A change-password fill arms the tab with the generated password held in the background worker's memory, because the site usually clears the form after it accepts the change; that save goes through the same desktop approval and is dropped with the arm. The save itself still goes through desktop approval.

The native-messaging manifest is pinned to the fixed development extension ID. The short-lived `sesame-browser-host` process validates and relays a closed protocol, and it does not open or decrypt the vault itself. Vault matching and approval belong to the running Sesame app.

## Fill flow

1. The user opens the extension popup, clicks the inline overlay on a focused sign-in field, presses `Ctrl+Shift+L`, or chooses **Fill with Sesame** from the field's context menu. A capability probe reports whether the native host and desktop broker are present.
2. The extension inspects the active tab for one plausible sign-in surface. It supports conservatively classified username-only, password-only, and combined login steps, and fails closed on multiple forms, registration fields, and password-change fields.
3. The user clicks **Fill this page**. The helper then checks autocomplete hints, static form attributes, and labels on related submit controls to reject signup and password-change surfaces. It never reads current input values or sends those markers away. A page loading, or the popup opening, is never enough on its own to start a fill.
4. The extension binds the request to the active tab, window, exact normalized origin, and a random token held in that document's isolated execution world.
5. The native host relays `{version, type: "fill", requestId, origin, fields}` to the running desktop app over the local channel. `fields` is `username`, `password`, or `both`, based on the bound step. The request carries no page contents or current input values.
6. Sesame compares the requested origin with saved login URLs, preferring exact origins. A bare hostname and its single `www` form may match when scheme and effective port are identical, and the approval dialog identifies this convenience match and shows the saved origin. Parent domains, other subdomains, different schemes, and different ports are not treated as equivalent. A near miss that resembles one saved host answers with the `lookalike` reason and releases nothing; the warning names that host and changes nothing about which origin can fill.
7. Before bringing its window forward, Sesame stores the bounded, secret-free approval metadata as a pending desktop request. The renderer receives an immediate event and also reconciles that pending request, so a listener race or renderer reload cannot leave a live approval invisible. The user selects a login when needed and explicitly approves the request. Approval expires after 30 seconds.
8. Before releasing a credential, the desktop rechecks the peer process, vault session, request binding, selected entry, and the same strict origin relationship. A lock, vault change, disconnect, timeout, replay, or changed login fails closed.
9. The extension rechecks the active tab, window, origin, same-document token, and prepared step mode. It writes only the field values present in that step and dispatches ordinary `input` and `change` events.
10. Sesame never submits the form, clicks a button, presses Enter, or sends a synthetic keyboard action. The user reviews the page and signs in.

One-time codes are a separate surface. When the focused field is a single one-time code field or a split group of three to eight single-character boxes, the inline control offers **Fill code**. The action binds the same active tab, window, exact origin, document token, and prepared surface kind, then asks the desktop for a code for that origin over protocol v4. The desktop offers only logins saved at that origin with a usable one-time secret, requires a fresh approval every time, recomputes the origin match under the vault lock, and releases the derived digits with their remaining window. The extension writes the code into the single field or one digit per split box, drops it from the call stack, and hides the control after a few seconds. The code never reaches the clipboard, extension storage, diagnostics, or logs, and the extension still never submits or clicks.

Only one pending fill request is allowed between the browser and desktop. Chrome closes an action popup when focus moves to the desktop approval, so a request that has already started continues in the extension background worker. Losing the native connection, a navigation or close of the tab it is bound to, a change to the inline settings or site permissions, and the 30 second timeout each cancel it. A fill request is never automatically retried. The active tab, exact origin, and per-document token are checked again before any field is changed.

## Registration flow

Registration is handled separately from saved-login filling. Page inspection tells registration apart from sign-in and password-change surfaces using visible password-field counts and standard field metadata. An explicit **Create password** action generates a 20-character password with `crypto.getRandomValues`, fills up to three password and confirmation fields belonging to one form, and offers a temporary copy action. It does not read the email field, persist the generated password, click a button, or submit. The user saves the completed login in Sesame after registration succeeds.

A password-change form is a distinct surface with one current-password field and one or two new-password fields. An explicit **Change password** action generates a new password, asks the desktop to approve the saved login for the page origin, and then fills the stored current password into the current field and the generated value into the new and confirmation fields. The two values never cross fields, and a field with no current or new marker makes the surface ambiguous and is refused. The desktop approval names the login that supplies the current password, so the helper does not guess which credential is being replaced. The generated value is held in the background worker's memory until the save, the arm expiry, a tab close, or a cross-origin navigation. The popup offers **Save this login** while the arm holds it, and the desktop applies it as an update to the approved login.

## Wire contract

Every native message is versioned, request-bound, length-limited, and decoded with a closed schema.

The desktop-owned canonical contracts are under
`src-tauri/contracts/browser/`. The independently buildable extension uses the
byte-identical, source-commit-stamped snapshots under
`contracts/browser/v1/` through `contracts/browser/v6/`; it does not import the
desktop implementation or download a contract at build or runtime. General
operations use protocol v1. Card filling uses the narrow protocol v2 contract.
Login filling uses protocol v5. One-time codes use protocol v4. The capability probe uses protocol v6, which a desktop older than 0.3.0 does not speak. Against such a desktop the probe fails as a protocol mismatch and the extension asks the user to update the desktop app.

- Capability request: `{version, type: "capabilities", requestId}`.
- Capability response: `{version, type: "capabilities", requestId, installed, desktopAvailable}`.
- Activation request: exactly `{version, type: "activate", requestId}`. It contains no site or credential fields. A running desktop focuses its main window; when the desktop is closed, the registered native helper may start only the sibling Sesame executable from its own install directory.
- Activation response: exactly `{version, type: "activated", requestId, opened}`. Activation never starts, retries, or resumes a fill request.
- Fill request: `{version: 5, type: "fill", requestId, origin, fields}`. `origin` is a normalized origin, not a hostname or full URL. `fields` is optional and means `both` when omitted. Only the version five fill form is accepted; version one requests without `fields` and version three requests are refused.
- Successful fill response contains exactly the requested slice: `username`, `password`, or both credential fields, plus `version`, `type`, `requestId`, and `matchKind`. `matchKind` is `exact` or `wwwAlias`, naming the rule the desktop enforced before it released the credential. The explanation is additive: it never changes which origin can fill, and the desktop recomputes the rule when it releases the credential.
- Unavailable response: exactly `{version, type: "fill-unavailable", requestId, reason}`, where `reason` is from a small allowlist. When `reason` is `lookalike`, the response also carries exactly one `lookalike` field: the one stored host the requested page resembles, normalized to a lowercase origin host and bounded to 128 characters with no control character and no path, query, or userinfo. No credential is released on that path.
- The lookalike warning is advisory. It never produces a fill, never relaxes the exact-origin rule, and never carries a credential or more than one stored host. The named host is the user's own data and is already shown in the normal approval list, so the warning treats it as untrusted display text: the extension normalizes it for display, bounds it, and renders it as text, never as markup.
- Identity request: `{version, type: "identity", requestId, origin, fields}`,
  where `fields` is a unique comma-separated subset of the nine allowlisted
  identity keys. A successful response is exactly `{version, type:
  "identity", requestId, identity}`, with a nested `identity` object whose keys
  exactly match that request.
- Card request: `{version: 2, type: "card", requestId, origin, fields}`,
  where `fields` is a unique comma-separated subset of the five allowlisted
  card keys. The response contains exactly those requested card fields.
- One-time code request: `{version: 4, type: "totp", requestId, origin}`.
  `origin` is a normalized origin, not a hostname or full URL. The request
  carries no page contents, no current input values, and no seed.
- Successful one-time code response contains exactly `{version, type: "totp",
  requestId, code, remainingSeconds}`. `code` is the derived digits only, never
  the seed, and `remainingSeconds` is the time left in the window that
  produced it.
- One-time code unavailable response: exactly `{version, type:
  "totp-unavailable", requestId, reason}`, where `reason` is from the same
  allowlist as the other operations.
- Save request: `{version, type: "save", requestId, origin, kind, password}`
  with optional bounded `title` and `username`; `kind` is exactly `new` or
  `update`. Success is exactly `{version, type: "saved", requestId, saved:
  true}`.
- Protocol errors use a length-limited `error` response and never carry credentials.

Credential fields are length-limited and an empty password is rejected. A response with an unknown or extra field, including vault data, is rejected. A one-time code is accepted only in a response to a version four one-time code request, and only as one to nine digits with a bounded remaining window. Capability responses cannot carry credentials.

## Local transport

On Windows, the desktop broker creates a named pipe bound to the current Windows account and logon session. Its protected access-control list permits only that account and LocalSystem, rejects remote clients, requests the first pipe instance, and uses bounded frames and timeouts. Both sides verify the expected executable path and logon session of the process at the other end before accepting credential traffic.

On Linux, the desktop broker binds a Unix socket in a directory with mode 0700 and gives the socket mode 0600. Both sides check that the process at the other end runs as the same user and from the expected executable path before they accept credential traffic, and the desktop records the peer's start time so a replaced process is detected.

These checks reduce accidental exposure and cross-process confusion. They do not make the channel a security boundary against malware already running as the same user. A compromised browser, extension process, desktop process, operating system, or same-user process with equivalent access is outside the supported threat model.

## Secret handling limits

Passwords are returned only after desktop approval and only for the pending request. The extension does not write credentials to extension storage, diagnostics, or logs. A generated password reaches the clipboard only through the person's explicit temporary copy action, and Sesame clears that copy after 30 seconds, when the popup closes, or when the inline control is removed, but only if the browser lets it read the clipboard and confirm that it still holds the password. When the browser refuses, Sesame says so and asks the person to clear the clipboard. A password generated for a change is held in the background worker's memory until the save, the arm expiry, a tab close, or a cross-origin navigation; the service worker terminating drops it with the arm. Candidate lists remain in the desktop app and contain only login id, title, and username. One-time codes follow the same rule as passwords: they exist only in the approved fill call stack, and they reach neither the clipboard nor extension storage.

While the approved fill is delivered, credentials necessarily exist briefly as Rust and JavaScript values. Rust response buffers use zeroizing wrappers where practical, but JavaScript strings cannot be reliably wiped. The design therefore promises no persistence or intentional logging, rather than perfect memory erasure.

## Development and release limits

The supported helper targets Chrome and Edge on Windows and on Linux. An
experimental Firefox package is built and identity-checked against the pinned
Gecko id, but no test runs it in Firefox, and Firefox store publication and
native-host validation remain release gates. Ordinary site filling is
restricted to HTTPS origins under the narrow bare-hostname/`www` equivalence
described above; any loopback-only development exception is not a shipping
guarantee. Signed-store distribution, installer upgrade and removal tests,
clean-profile verification, browser-version compatibility testing,
accessibility testing, and an independent security assessment remain release
gates.

Do not publish or recommend this development helper for primary credentials. Test it with disposable entries and keep an independent encrypted backup.
