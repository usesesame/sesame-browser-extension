// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fillCardSurface } from '../../src/content/card-writer'
import { isVisible } from '../../src/content/field-writer'

const origin = 'https://checkout.example.test'
const token = 'card-fill-token-1234'

function prepareInput(markup: string): HTMLInputElement {
  document.body.innerHTML = markup
  const input = document.querySelector('input')!
  input.getBoundingClientRect = () => ({
    width: 200, height: 30, top: 0, left: 0, right: 200, bottom: 30, x: 0, y: 0, toJSON: () => ({}),
  }) as DOMRect
  return input
}

beforeEach(() => {
  vi.stubGlobal('location', { protocol: 'https:', origin })
  vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible', opacity: '1' }))
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fillCardSurface', () => {
  it('requests and fills both expiry values for a combined expiry field', () => {
    const input = prepareInput('<input autocomplete="cc-exp" maxlength="5">')
    expect(input.autocomplete).toBe('cc-exp')
    expect(isVisible(input)).toBe(true)
    expect(fillCardSurface(origin, token, null, 'prepare')).toEqual({
      ok: true,
      filledFields: ['expiryMonth', 'expiryYear'],
    })

    const card = { expiryMonth: '12', expiryYear: '2030' }
    expect(fillCardSurface(origin, token, card)).toEqual({
      ok: true,
      filledFields: ['expiryMonth', 'expiryYear'],
    })
    expect(input.value).toBe('12/30')
    expect(card).toEqual({ expiryMonth: '', expiryYear: '' })
  })

  it('uses a four-digit year when the input permits it', () => {
    const input = prepareInput('<input autocomplete="cc-exp" maxlength="7">')
    fillCardSurface(origin, token, null, 'prepare')

    const card = { expiryMonth: '1', expiryYear: '2030' }
    fillCardSurface(origin, token, card)

    expect(input.value).toBe('01/2030')
    expect(card).toEqual({ expiryMonth: '', expiryYear: '' })
  })
})
