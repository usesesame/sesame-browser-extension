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

export function formatCheckTime(value: unknown, now: Date = new Date()): string {
  const date = typeof value === 'string' ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return 'Unknown'
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
  if (date.toDateString() === now.toDateString()) return `Today, ${time}`
  const day = date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return `${day}, ${time}`
}

export function safeDiagnosticText(diagnostic: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  const report = {
    ...diagnostic,
    ...extra,
    pageAccess: 'active-tab-only',
    fieldValuesRead: false,
    secretsIncluded: false,
  }
  return Object.entries(report).map(([key, value]) => `${key}=${String(value)}`).join('\n')
}

export function userMessage(code: string): [string, string] {
  const presentation = presentConnection(code)
  return [presentation.title, presentation.message]
}
