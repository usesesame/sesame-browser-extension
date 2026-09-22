import { describe, expect, it } from 'vitest'
import { cardFillMessage, fillMessage, identityFillMessage } from '../../src/content/overlay'

describe('inline fill messages', () => {
  it('explains a cancelled login fill instead of going silent', () => {
    expect(fillMessage({ code: 'cancelled' })).toBe('Fill was cancelled. Nothing was filled.')
  })

  it('never leaves a known failure without copy', () => {
    const codes = [
      'origin-mismatch',
      'no-match',
      'vault-locked',
      'locked',
      'desktop-unavailable',
      'host-not-found',
      'host-disconnected',
      'host-exited',
      'host-communication-failed',
      'timeout',
      'approval-declined',
      'approval-unavailable',
      'approval-timeout',
      'stale-request',
      'page-changed',
      'stale-document',
      'field-write-failed',
      'no-fields',
      'signup-form',
      'password-change',
      'multiple-surfaces',
    ]
    for (const code of codes) {
      expect(fillMessage({ code }).length, code).toBeGreaterThan(0)
    }
  })

  it('keeps card and identity failures non-empty', () => {
    expect(cardFillMessage({ ok: false, code: 'cancelled' })).toBe('Card fill was declined.')
    expect(cardFillMessage({ ok: false, code: 'untrusted-frame' }).length).toBeGreaterThan(0)
    expect(identityFillMessage({ ok: false, code: 'no-fields' }).length).toBeGreaterThan(0)
    expect(identityFillMessage({ ok: false, code: 'field-write-failed' }).length).toBeGreaterThan(0)
  })
})
