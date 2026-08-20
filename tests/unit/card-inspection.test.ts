import { describe, expect, it } from 'vitest'
import { normalizeCardInspection } from '../../src/background/coordinator'

const origin = 'https://checkout.example.test'

describe('normalizeCardInspection', () => {
  it('accepts only a closed top-level inspection bound to the active origin', () => {
    expect(normalizeCardInspection({ ok: true, origin, fields: ['number', 'securityCode'] }, origin))
      .toEqual({ state: 'ready', fields: ['number', 'securityCode'] })
    expect(normalizeCardInspection({ ok: true, origin, fields: ['number'], extra: true }, origin))
      .toEqual({ state: 'unavailable', code: 'no-fields' })
    expect(normalizeCardInspection({ ok: true, origin: 'https://other.example.test', fields: ['number'] }, origin))
      .toEqual({ state: 'unavailable', code: 'no-fields' })
  })

  it('does not accept duplicate or unrecognised payment fields', () => {
    expect(normalizeCardInspection({ ok: true, origin, fields: ['number', 'number'] }, origin))
      .toEqual({ state: 'unavailable', code: 'no-fields' })
    expect(normalizeCardInspection({ ok: true, origin, fields: ['number', 'pin'] }, origin))
      .toEqual({ state: 'unavailable', code: 'no-fields' })
  })

  it('surfaces an explicitly detected embedded payment frame', () => {
    expect(normalizeCardInspection({ ok: false, code: 'untrusted-frame' }, origin))
      .toEqual({ state: 'unavailable', code: 'untrusted-frame' })
  })
})
