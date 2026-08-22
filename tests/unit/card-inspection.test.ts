import { describe, expect, it } from 'vitest'
import { normalizeCardInspection } from '../../src/background/coordinator'

const origin = 'https://checkout.example.test'

describe('normalizeCardInspection', () => {
  it('accepts a closed top-level inspection bound to the active origin', () => {
    expect(normalizeCardInspection({ ok: true, origin, fields: ['number', 'securityCode'], embedded: false }, origin))
      .toEqual({ state: 'ready', origin, fields: ['number', 'securityCode'], frameIds: [0], embedded: false })
    expect(normalizeCardInspection({ ok: true, origin, fields: ['number'], embedded: false, extra: true }, origin))
      .toEqual({ state: 'unavailable', code: 'no-fields' })
    expect(normalizeCardInspection({ ok: true, origin: 'https://other.example.test', fields: ['number'], embedded: false }, origin))
      .toEqual({ state: 'unavailable', code: 'no-fields' })
  })

  it('accepts a js.stripe.com payment-frame inspection when its frame id is known', () => {
    expect(normalizeCardInspection({ ok: true, origin: 'https://js.stripe.com', fields: ['number'], embedded: true }, origin, 12))
      .toEqual({ state: 'ready', origin: 'https://js.stripe.com', fields: ['number'], frameIds: [12], embedded: true })
  })

  it('rejects an inspection without a browser-provided frame id', () => {
    expect(normalizeCardInspection({ ok: true, origin: 'https://js.stripe.com', fields: ['number'], embedded: true }, origin, -1))
      .toEqual({ state: 'unavailable', code: 'no-fields' })
  })

  it('refuses every other embedded payment-frame origin', () => {
    expect(normalizeCardInspection({ ok: true, origin: 'https://checkout.example.test', fields: ['number'], embedded: true }, origin, 12))
      .toEqual({ state: 'unavailable', code: 'untrusted-frame' })
  })

  it('does not accept duplicate or unrecognised payment fields', () => {
    expect(normalizeCardInspection({ ok: true, origin, fields: ['number', 'number'], embedded: false }, origin))
      .toEqual({ state: 'unavailable', code: 'no-fields' })
    expect(normalizeCardInspection({ ok: true, origin, fields: ['number', 'pin'], embedded: false }, origin))
      .toEqual({ state: 'unavailable', code: 'no-fields' })
  })

  it('surfaces an explicitly detected embedded payment frame', () => {
    expect(normalizeCardInspection({ ok: false, code: 'untrusted-frame' }, origin))
      .toEqual({ state: 'unavailable', code: 'untrusted-frame' })
  })
})

describe('cardFillMessage', () => {
  it('counts what was filled, and names why nothing was', async () => {
    const { cardFillMessage } = await import('../../src/content/overlay')
    expect(cardFillMessage({ ok: true, filledFields: ['number'] })).toBe('Filled one card field.')
    expect(cardFillMessage({ ok: true, filledFields: ['number', 'securityCode'] })).toBe('Filled 2 card fields.')
    expect(cardFillMessage({ ok: false, code: 'no-fields' })).toBe('No card fields to fill on this form.')
    expect(cardFillMessage({ ok: false, code: 'untrusted-frame' }))
      .toBe('Sesame does not fill a card in this embedded frame.')
    expect(cardFillMessage({ ok: false, code: 'cancelled' })).toBe('Card fill was declined.')
    expect(cardFillMessage('nonsense')).toBe('Sesame could not fill this form.')
  })
})

// @vitest-environment happy-dom
describe('cardAnchorFields', () => {
  it('reads an unclaimed payment field, and never one a sign-in surface claimed', async () => {
    const { cardAnchorFields } = await import('../../src/content/overlay')
    document.body.innerHTML = '<input autocomplete="cc-number" />'
    const field = document.querySelector('input')!
    expect(cardAnchorFields(field, false)).toEqual(['number'])
    expect(cardAnchorFields(field, true)).toEqual([])
  })

  it('reads nothing from a field that is not a payment field', async () => {
    const { cardAnchorFields } = await import('../../src/content/overlay')
    document.body.innerHTML = '<input type="password" />'
    expect(cardAnchorFields(document.querySelector('input')!, false)).toEqual([])
  })
})
