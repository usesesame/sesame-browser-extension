# Sesame browser helper design

Status: pre-release Windows integration. Page filling works today between the Chromium extension and a running desktop app. Windows installers bundle the native-messaging host, and Sesame registers and repairs the current-user Chrome and Edge connection automatically at startup without administrator access or user-run scripts. The browser extension still requires ordinary user-confirmed browser installation, and it has not been independently audited or approved for store publication.

## Boundary

The unlocked vault may be read only by the desktop application. The browser helper reaches it over Chromium native messaging and a private local Windows named pipe. There is no localhost HTTP server, network listener, cloud-vault request, web vault, or web-page message bridge.

The extension holds the `activeTab`, `nativeMessaging`, `scripting`, and `storage` permissions. Opening the popup grants a narrow, temporary look at the active page. That look reports capped field counts and a form classification only; it does not read field values, page text, form actions, paths, query strings, cookies, or storage. During one-time onboarding the user can grant optional access to all HTTPS pages, so the inline control is available without per-site setup. Extension storage keeps only the first-run preference and the exact origins where the user explicitly paused that control; it never contains credentials or visited-site history.

## Inline overlay

After the one-time HTTPS grant, the dynamically registered `content-overlay.js` script is available across websites. It shows a small "Fill with Sesame" control only when a safe field receives focus. Before it attaches, the overlay asks the background worker for an exact-origin pause decision, and if that policy cannot be verified, the control stays hidden. It is a trigger and status surface only, never reads or transmits field values, and lives in a closed shadow root so the page cannot read its UI. Clicking it starts the same fill flow that the popup or `Ctrl+Shift+L` starts: the request still binds to the active tab and exact origin, the desktop app must still approve it, and the strict origin relationship is rechecked before any credential is written. The page itself cannot start a fill because the extension exposes no externally connectable surface. Registration is synchronized on install, startup, and browser permission changes; explicit pause exceptions affect only the inline control.

The same overlay arms the save/update capture listener, and since 2026-08-13 a popup-driven login or registration fill arms it too. After a successful fill, the popup calls the shared `sesameEnsureSignupCapture` content helper, which detaches before it attaches so repeated arming never stacks duplicate listeners. A user without an all-HTTPS grant therefore still receives the save/update offer when they submit a form Sesame just filled. Arming never widens what the listener may do: it still reads only on a trusted submit, only from the submitted form, only when the form classifies as a registration or password-change surface, and the proposal still goes through the desktop approval.

The native-messaging manifest is pinned to the fixed development extension ID. The short-lived `sesame-browser-host` process validates and relays a closed protocol, and it does not open or decrypt the vault itself. Vault matching and approval belong to the running Sesame app.

## Fill flow

1. The user opens the extension popup, clicks the inline overlay on a focused sign-in field, or presses `Ctrl+Shift+L`. A capability probe reports whether the native host and desktop broker are present and whether the vault is unlocked.
2. The extension inspects the active tab for one plausible sign-in surface. It supports conservatively classified username-only, password-only, and combined login steps, and fails closed on multiple forms, registration fields, and password-change fields.
3. The user clicks **Fill this page**. The helper then checks autocomplete hints, static form attributes, and labels on related submit controls to reject signup and password-change surfaces. It never reads current input values or sends those markers away. A page loading, or the popup opening, is never enough on its own to start a fill.
4. The extension binds the request to the active tab, window, exact normalized origin, and a random token held in that document's isolated execution world.
5. The native host relays `{version, type: "fill", requestId, origin, fields}` to the running desktop app over the local named pipe. `fields` is `username`, `password`, or `both`, based on the bound step. The request carries no page contents or current input values.
6. Sesame compares the requested origin with saved login URLs, preferring exact origins. A bare hostname and its single `www` form may match when scheme and effective port are identical, and the approval dialog identifies this convenience match and shows the saved origin. Parent domains, other subdomains, different schemes, and different ports are not treated as equivalent.
7. Before bringing its window forward, Sesame stores the bounded, secret-free approval metadata as a pending desktop request. The renderer receives an immediate event and also reconciles that pending request, so a listener race or renderer reload cannot leave a live approval invisible. The user selects a login when needed and explicitly approves the request. Approval expires after 30 seconds.
8. Before releasing a credential, the desktop rechecks the pipe peer, vault session, request binding, selected entry, and the same strict origin relationship. A lock, vault change, disconnect, timeout, replay, or changed login fails closed.
9. The extension rechecks the active tab, window, origin, same-document token, and prepared step mode. It writes only the field values present in that step and dispatches ordinary `input` and `change` events.
10. Sesame never submits the form, clicks a button, presses Enter, or sends a synthetic keyboard action. The user reviews the page and signs in.

Only one pending fill request is allowed between the browser and desktop. Chrome closes an action popup when focus moves to the desktop approval, so a request that has already started continues in the extension background worker. Losing the native connection cancels it, and a fill request is never automatically retried. The active tab, exact origin, and per-document token are checked again before either field is changed.

## Registration flow

Registration is handled separately from saved-login filling. Page inspection tells registration apart from sign-in and password-change surfaces using visible password-field counts and standard field metadata. An explicit **Create password** action generates a 20-character password with `crypto.getRandomValues`, fills up to three password and confirmation fields belonging to one form, and offers a temporary copy action. It does not read the email field, persist the generated password, click a button, or submit. Password-change forms remain blocked, so the helper cannot guess which existing credential is being replaced. The user saves the completed login in Sesame after registration succeeds.

## Wire contract

Every native message is versioned, request-bound, length-limited, and decoded with a closed schema.

The desktop-owned canonical contract is
`src-tauri/contracts/browser/v1/`. The independently buildable extension uses
the byte-identical, source-commit-stamped snapshot under
`extensions/sesame/contracts/browser/v1/`; it does not import the desktop
implementation or download a contract at build or runtime. Protocol v1 is the
declared minimum and current compatible host version.

- Capability request: `{version, type: "capabilities", requestId}`.
- Capability response: `{version, type: "capabilities", requestId, installed, desktopAvailable, locked, fillAvailable}`.
- Activation request: exactly `{version, type: "activate", requestId}`. It contains no site or credential fields. A running desktop focuses its main window; when the desktop is closed, the registered native helper may start only the sibling Sesame executable from its own install directory.
- Activation response: exactly `{version, type: "activated", requestId, opened}`. Activation never starts, retries, or resumes a fill request.
- Fill request: `{version, type: "fill", requestId, origin, fields}`. `origin` is a normalized origin, not a hostname or full URL. During migration, older version-1 helper requests without `fields` are interpreted as `both`.
- Successful fill response contains exactly the requested slice: `username`, `password`, or both credential fields, plus `version`, `type`, and `requestId`.
- Unavailable response: exactly `{version, type: "fill-unavailable", requestId, reason}`, where `reason` is from a small allowlist.
- Identity request: `{version, type: "identity", requestId, origin, fields}`,
  where `fields` is a unique comma-separated subset of the nine allowlisted
  identity keys. A successful response is exactly `{version, type:
  "identity", requestId, identity}`, with a nested `identity` object whose keys
  exactly match that request.
- Save request: `{version, type: "save", requestId, origin, kind, password}`
  with optional bounded `title` and `username`; `kind` is exactly `new` or
  `update`. Success is exactly `{version, type: "saved", requestId, saved:
  true}`.
- Protocol errors use a length-limited `error` response and never carry credentials.

Credential fields are length-limited and an empty password is rejected. A response with an unknown or extra field, including vault data or a TOTP value, is rejected. Capability responses cannot carry credentials.

## Local transport

On Windows, the desktop broker creates a pipe bound to the current Windows account and logon session. Its protected access-control list permits only that account and LocalSystem, rejects remote clients, requests the first pipe instance, and uses bounded frames and timeouts. Both sides verify the expected executable path and logon session of the process at the other end before accepting credential traffic.

These checks reduce accidental exposure and cross-process confusion. They do not make the pipe a security boundary against malware already running as the same Windows user. A compromised browser, extension process, desktop process, operating system, or same-user process with equivalent access is outside the supported threat model.

## Secret handling limits

Passwords are returned only after desktop approval and only for the pending request. The extension does not write credentials to extension storage, the clipboard, diagnostics, or logs. Candidate lists remain in the desktop app and contain only login id, title, and username.

While the approved fill is delivered, credentials necessarily exist briefly as Rust and JavaScript values. Rust response buffers use zeroizing wrappers where practical, but JavaScript strings cannot be reliably wiped. The design therefore promises no persistence or intentional logging, rather than perfect memory erasure.

## Development and release limits

The current helper targets unpacked Chrome and Edge on Windows. Ordinary site filling is restricted to HTTPS origins under the narrow bare-hostname/`www` equivalence described above; any loopback-only development exception is not a shipping guarantee. Firefox packaging, signed-store distribution, installer upgrade/removal tests, clean-profile verification, browser-version compatibility testing, accessibility testing, and an independent security assessment remain release gates.

Do not publish or recommend this development helper for primary credentials. Test it with disposable entries and keep an independent encrypted backup.
