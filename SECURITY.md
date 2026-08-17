# Security policy

This repository holds the Sesame browser extension for Chrome and Edge. It is
part of a password manager in private beta and has not had an independent
security audit.

The extension is the only Sesame surface that runs inside a page it does not
control. When you report or fix anything here, treat every page as hostile.

## Reporting a vulnerability

**Do not open a public issue, discussion, or pull request for a security
problem.** A public report reaches attackers before it reaches beta users who
have real credentials in a vault.

Use GitHub private vulnerability reporting: open the repository's **Security**
tab and choose **Report a vulnerability**. It creates a private advisory
visible only to the maintainers.

If you cannot use GitHub, open a request on the [support
page](https://usesesame.app/support) asking for a security contact. Do not put
vulnerability details in that first message. The support intake deliberately
refuses secret-shaped content and is read by a wider group than an advisory.

### What to include

- What an attacker gains, in one sentence.
- The extension version and store listing, and the desktop app version.
- The browser and its version.
- The steps to reproduce it, in order.
- Whether it needs an installed native host, a running desktop app, an unlocked
  vault, or an approved fill.

### What not to include

Never send a real password, vault, export, PIN, recovery kit, backup code, TOTP
seed, or account token. Use fictional data in every reproduction.

### What happens next

- We acknowledge within 5 working days.
- We give an assessment and a rough timeline within 10 working days.
- We tell you when a fix ships and credit you in the advisory unless you prefer
  otherwise.

This is a small project. If you have not heard back in the windows above, send
a follow-up rather than assuming the report was received.

## Supported versions

Only the current store release receives fixes. The extension version is
independent from the desktop version.

| Version | Supported |
| --- | --- |
| Current Chrome and Edge store release | Yes |
| Any earlier build | No. Update instead |

## Scope

In scope:

- Anything that releases a credential or identity field to a page the user did
  not approve, or to the wrong document, tab, window, or origin.
- Anything that persists a credential anywhere that survives the approved
  step: `chrome.storage`, a badge, a diagnostic, a console, an error message,
  or a rendered DOM node.
- Escaping the closed shadow root of the inline control, or letting page script
  drive the control, the popup, or the fill flow.
- Origin normalization failures: a page that gets a credential for a different
  origin, a punycode or trailing-dot confusion, or a redirect that changes the
  bound document after approval.
- Native-messaging protocol handling: accepting an unsafe response shape,
  accepting a mismatched `requestId`, or accepting a protocol version outside
  the declared compatibility range in `contracts/browser/v1/contract.json`.
- Permission escalation: obtaining host permissions the user did not grant, or
  keeping the inline control active on an origin the user paused.
- The store manifests: an unexpected permission, an unexpected content-script
  match, or a build that ships the pinned integration identity.

Out of scope, and owned by the desktop repository instead:

- The vault, its cryptography, unlock, backup, import, and clipboard handling.
- The native messaging host binary, its registration, and the desktop approval
  prompt. The host ships with the desktop product, not with this extension.
- Update discovery, release signing, and the installer.

Report those against `usesesame/sesame-desktop`. If a finding crosses the
boundary, report it once against the extension and say so; we will route it.

Also out of scope here:

- Anything documented as not protected against in the desktop threat model. An
  attacker who already has code execution as the logged-in Windows user is
  outside the model.
- Missing hardening with no demonstrated impact: header audits, version
  disclosure, and scanner output with no exploit path.
- Social engineering of maintainers or beta testers, physical attacks, and
  denial of service through traffic volume.

## Safe harbour

We will not pursue or support legal action against research that:

- stays within the scope above,
- uses only your own accounts and your own test vaults,
- avoids accessing, altering, or retaining anyone else's data,
- avoids degrading the service for other users, and
- gives us reasonable time to ship a fix before public disclosure.

If you are unsure whether something is in bounds, report it and ask. A
good-faith report that turns out to be out of scope is not held against you.

## Known limits

Stated plainly so a report does not spend effort on a known position:

- Sesame has not had an independent security audit.
- The extension never opens a vault on its own. Without a running desktop app
  and an explicit approval it can do nothing with a credential.
- Firefox is not supported. It needs a separate manifest and a different
  native-host allowlist format.
- The extension does not submit forms, click through login steps, intercept
  passkeys, collect browsing history, or run analytics.
