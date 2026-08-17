// Diagnostics exclude hostnames, URLs, and credentials.
import { NATIVE_HOST, PROTOCOL_VERSION } from './native'

export interface Diagnostic {
  code: string
  checkedAt: string
  extensionVersion: string
  protocolVersion: string
  host: string
  latencyMs?: number
  attempts?: number
}

export function makeDiagnostic(code: string, latencyMs?: number, attempts?: number): Diagnostic {
  return {
    code,
    checkedAt: new Date().toISOString(),
    extensionVersion: typeof chrome !== 'undefined'
      ? chrome.runtime.getManifest().version
      : 'unknown',
    protocolVersion: String(PROTOCOL_VERSION),
    host: NATIVE_HOST,
    latencyMs,
    attempts,
  }
}

export const USER_MESSAGES: Record<string, [string, string]> = {
  'host-not-found': ['Desktop helper not found', 'Open or restart Sesame. This extension will reconnect automatically.'],
  'host-forbidden': ['Connection needs a refresh', 'Reload the unpacked extension once, then restart Sesame.'],
  'host-exited': ['Desktop helper stopped', 'Keep Sesame open. We will try the connection again.'],
  'host-communication-failed': ['Connection was interrupted', 'Keep Sesame open. We will try the connection again.'],
  'host-disconnected': ['Desktop helper disconnected', 'Keep Sesame open. We will try the connection again.'],
  'protocol-mismatch': ['Update needed', 'The desktop app and extension use different connection versions.'],
  'request-mismatch': ['Response could not be verified', 'Reload the extension and try once more.'],
  'unsafe-response': ['Response was blocked', 'Sesame rejected an unexpected response to protect your vault.'],
  'invalid-response': ['Desktop response was not understood', 'Restart Sesame and try again.'],
  'host-rejected-request': ['Desktop helper declined the check', 'Update or restart Sesame and try again.'],
  'host-unavailable': ['Desktop helper is unavailable', 'Open or restart Sesame.'],
  'timeout': ['Sesame is taking too long', 'Keep the desktop app open. We will retry automatically.'],
  'native-runtime-error': ['Browser connection failed', 'Reload this extension and try again.'],
  'desktop-unavailable': ['Open Sesame', 'The browser helper is installed, but the desktop app is not running.'],
  'fill-in-progress': ['A fill request is already open', 'Wait for the current request to finish.'],
  'cancelled': ['Request cancelled', 'The popup closed or the page changed.'],
  'page-changed': ['The page changed', 'Open Sesame again to retry.'],
  'page-restricted': ['This page cannot be filled', 'Browser-owned pages and stores cannot be filled.'],
  'no-fields': ['No sign-in fields found', 'Sesame did not detect a username or password field on this page.'],
}

export function userMessage(code: string): [string, string] {
  return USER_MESSAGES[code] ?? USER_MESSAGES['native-runtime-error']
}
