// Diagnostics exclude hostnames, URLs, and credentials.
import { NATIVE_HOST, PROTOCOL_VERSION } from './native'
import { presentConnection } from './connection-presentation'

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

export function userMessage(code: string): [string, string] {
  const presentation = presentConnection(code)
  return [presentation.title, presentation.message]
}
