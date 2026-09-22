import { describe, expect, it } from 'vitest'
import { presentConnection, READY_PRESENTATION } from '../../src/protocol/connection-presentation'

const KNOWN_CODES = [
  'host-not-found',
  'host-forbidden',
  'host-exited',
  'host-communication-failed',
  'host-disconnected',
  'protocol-mismatch',
  'timeout',
  'desktop-unavailable',
  'vault-locked',
  'extension-response-timeout',
  'extension-error',
  'request-mismatch',
  'unsafe-response',
  'invalid-response',
  'host-rejected-request',
  'host-unavailable',
  'native-runtime-error',
]

describe('connection presentation', () => {
  it('offers an install action when no native host is registered', () => {
    const presentation = presentConnection('host-not-found')
    expect(presentation.state).toBe('missing-host')
    expect(presentation.action).toBe('install')
    expect(presentation.actionLabel).toBe('Get Sesame')
    expect(presentation.message).not.toMatch(/Windows/)
    expect(presentation.canRetry).toBe(true)
  })

  it('offers a reload action when the host refuses the extension', () => {
    expect(presentConnection('host-forbidden')).toMatchObject({
      state: 'forbidden-host',
      action: 'reload',
      actionLabel: 'Reload extension',
    })
  })

  it('offers an update action for a protocol mismatch', () => {
    expect(presentConnection('protocol-mismatch')).toMatchObject({
      state: 'incompatible',
      action: 'update',
      actionLabel: 'Update Sesame',
    })
  })

  it('offers to open the desktop when the helper is installed but not running', () => {
    expect(presentConnection('desktop-unavailable')).toMatchObject({
      state: 'desktop-closed',
      action: 'open-desktop',
      actionLabel: 'Open Sesame',
    })
  })

  it('keeps a stopped host distinct from a missing installation', () => {
    expect(presentConnection('host-exited')).toMatchObject({ state: 'host-stopped', action: 'open-desktop' })
    expect(presentConnection('host-communication-failed').state).toBe('host-stopped')
    expect(presentConnection('host-disconnected').state).toBe('host-stopped')
  })

  it('names the unlock action for a locked vault', () => {
    const presentation = presentConnection('vault-locked')
    expect(presentation.state).toBe('locked')
    expect(presentation.action).toBe('open-desktop')
    expect(presentation.actionLabel).toBe('Unlock Sesame')
  })

  it('offers retry without navigation for timeouts and unknown codes', () => {
    expect(presentConnection('timeout')).toMatchObject({ state: 'timeout', action: 'retry' })
    expect(presentConnection('something-new')).toMatchObject({ state: 'failed', action: 'retry' })
    expect(presentConnection(undefined).action).toBe('retry')
  })

  it('treats a connected result as ready with no action', () => {
    expect(presentConnection('connected')).toBe(READY_PRESENTATION)
    expect(READY_PRESENTATION.canRetry).toBe(false)
  })

  it('gives every known code non-empty copy', () => {
    for (const code of KNOWN_CODES) {
      const presentation = presentConnection(code)
      expect(presentation.title.length, code).toBeGreaterThan(0)
      expect(presentation.message.length, code).toBeGreaterThan(0)
    }
  })
})
