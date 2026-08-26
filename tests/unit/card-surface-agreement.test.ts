// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inspectCardSurface } from '../../src/content/card-detector'
import { fillCardSurface } from '../../src/content/card-writer'

const origin = 'https://checkout.example.test'
const token = 'card-fill-token-1234'

beforeEach(() => {
  vi.stubGlobal('location', { protocol: 'https:', origin })
  vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible', opacity: '1' }))
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubBounds(): void {
  for (const input of document.querySelectorAll('input')) {
    input.getBoundingClientRect = () => ({
      width: 200, height: 30, top: 0, left: 0, right: 200, bottom: 30, x: 0, y: 0, toJSON: () => ({}),
    }) as DOMRect
  }
}

describe('card inspection and card fill agree on what a page has', () => {
  it('both see a combined expiry field as expiryMonth and expiryYear', () => {
    document.body.innerHTML = '<input autocomplete="cc-number"><input autocomplete="cc-exp" maxlength="5">'
    stubBounds()

    const inspection = inspectCardSurface()
    const prepared = fillCardSurface(origin, token, null, 'prepare')

    expect(inspection).toEqual({ ok: true, origin, fields: expect.arrayContaining(['number', 'expiryMonth', 'expiryYear']), embedded: false })
    expect(prepared.ok).toBe(true)
    expect(new Set((inspection as { fields: string[] }).fields)).toEqual(new Set((prepared as { filledFields: string[] }).filledFields))
  })

  it('report the same fillability when no card fields are present', () => {
    document.body.innerHTML = '<input type="text" name="promo-code">'
    stubBounds()

    expect(inspectCardSurface()).toEqual({ ok: false, code: 'no-fields' })
    expect(fillCardSurface(origin, token, null, 'prepare')).toEqual({ ok: false, code: 'no-fields' })
  })
})
