// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { cardFieldsForAutocomplete, cardFieldsForInput, hasCombinedExpiryAutocomplete } from '../../src/content/card-fields'
import { inspectLoginSurface, isUsernameField, isVisible } from '../../src/content/field-detector'

// happy-dom performs no layout, so every element measures zero.
function layout(element: Element, box: { width: number; height: number }) {
  element.getBoundingClientRect = () => ({
    width: box.width, height: box.height, top: 0, left: 0, right: box.width, bottom: box.height,
    x: 0, y: 0, toJSON: () => ({}),
  }) as DOMRect
}

function render(html: string): HTMLInputElement[] {
  document.body.innerHTML = html
  const inputs = Array.from(document.querySelectorAll('input'))
  for (const input of inputs) layout(input, { width: 200, height: 30 })
  return inputs
}

const first = (html: string) => render(html)[0]

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('isUsernameField', () => {
  it('trusts an explicit autocomplete token', () => {
    expect(isUsernameField(first('<input type="text" autocomplete="username">'))).toBe(true)
    expect(isUsernameField(first('<input type="text" autocomplete="email">'))).toBe(true)
  })

  it('accepts an email input whatever it is called', () => {
    expect(isUsernameField(first('<input type="email">'))).toBe(true)
  })

  it('reads the placeholder, which is often the only thing a field carries', () => {
    expect(isUsernameField(first('<input type="text" placeholder="Email address">'))).toBe(true)
    expect(isUsernameField(first('<input type="text" placeholder="Username">'))).toBe(true)
  })

  it('reads an aria-label', () => {
    expect(isUsernameField(first('<input type="text" aria-label="Username">'))).toBe(true)
  })

  it('reads a label bound by for, and a label wrapping the input', () => {
    render('<label for="u">Username</label><input id="u" type="text">')
    expect(isUsernameField(document.querySelector('input')!)).toBe(true)

    render('<label>Email<input type="text"></label>')
    expect(isUsernameField(document.querySelector('input')!)).toBe(true)
  })

  it('still reads name and id', () => {
    expect(isUsernameField(first('<input type="text" name="login">'))).toBe(true)
    expect(isUsernameField(first('<input type="text" id="account">'))).toBe(true)
  })

  it('leaves a search box alone even when its name contains user', () => {
    expect(isUsernameField(first('<input type="text" name="user_query">'))).toBe(false)
    expect(isUsernameField(first('<input type="search" name="username">'))).toBe(false)
    expect(isUsernameField(first('<input type="text" placeholder="Search users">'))).toBe(false)
  })

  it('leaves a one-time code alone, which is never a stored username', () => {
    expect(isUsernameField(first('<input type="text" autocomplete="one-time-code">'))).toBe(false)
    expect(isUsernameField(first('<input type="text" name="login_otp">'))).toBe(false)
    expect(isUsernameField(first('<input type="text" placeholder="Verification code">'))).toBe(false)
  })

  it('does not claim an unrelated field', () => {
    expect(isUsernameField(first('<input type="text" name="first_name">'))).toBe(false)
    expect(isUsernameField(first('<input type="password">'))).toBe(false)
  })
})

describe('isVisible', () => {
  it('accepts an ordinary rendered field', () => {
    expect(isVisible(first('<input type="text">'))).toBe(true)
  })

  it('rejects fields the page has taken out of use', () => {
    expect(isVisible(first('<input type="text" disabled>'))).toBe(false)
    expect(isVisible(first('<input type="text" readonly>'))).toBe(false)
    expect(isVisible(first('<input type="hidden">'))).toBe(false)
  })

  it('rejects a sign-up honeypot hidden from assistive technology', () => {
    render('<div aria-hidden="true"><input type="text" name="email"></div>')
    const input = document.querySelector('input')!
    layout(input, { width: 200, height: 30 })
    expect(isVisible(input)).toBe(false)
  })

  it('rejects a one-pixel field, which no person is filling in', () => {
    const input = first('<input type="text">')
    layout(input, { width: 1, height: 1 })
    expect(isVisible(input)).toBe(false)
  })

  it('rejects a field with no box at all', () => {
    const input = first('<input type="text">')
    layout(input, { width: 0, height: 0 })
    expect(isVisible(input)).toBe(false)
  })
})

describe('inspectLoginSurface', () => {
  it('reports a sign-in form as having both fields', () => {
    render('<form><input type="text" placeholder="Email"><input type="password"></form>')
    const inspection = inspectLoginSurface()
    expect(inspection.ok).toBe(true)
    if (!inspection.ok) return
    expect(inspection.hasUsernameField).toBe(true)
    expect(inspection.hasPasswordField).toBe(true)
  })

  it('reports a page with no credential fields', () => {
    render('<form><input type="text" name="q" placeholder="Search"></form>')
    expect(inspectLoginSurface()).toEqual({ ok: false, code: 'no-fields' })
  })

  it('reports the origin and nothing drawn from the page', () => {
    render('<input type="text" placeholder="Email"><input type="password">')
    const inspection = inspectLoginSurface()
    if (!inspection.ok) throw new Error('expected a surface')
    expect(Object.keys(inspection.surface).sort()).toEqual(['ok', 'origin'])
    expect(inspection.surface.origin).toBe(window.location.origin)
  })
})

describe('card autocomplete fields', () => {
  it('requests both expiry parts for one combined expiry input', () => {
    expect(cardFieldsForAutocomplete('section-payment cc-exp')).toEqual(['expiryMonth', 'expiryYear'])
    expect(hasCombinedExpiryAutocomplete('section-payment cc-exp')).toBe(true)
  })

  it('keeps separate expiry inputs distinct', () => {
    expect(cardFieldsForAutocomplete('cc-exp-month')).toEqual(['expiryMonth'])
    expect(cardFieldsForAutocomplete('cc-exp-year')).toEqual(['expiryYear'])
    expect(hasCombinedExpiryAutocomplete('cc-exp-year')).toBe(false)
  })

  it('recognises explicit payment labels when a site omits autocomplete', () => {
    expect(cardFieldsForInput(first('<input name="cardnumber">'))).toEqual(['number'])
    expect(cardFieldsForInput(first('<input aria-label="CVC">'))).toEqual(['securityCode'])
    expect(cardFieldsForInput(first('<input placeholder="MM / YY" aria-label="Expiration date">')))
      .toEqual(['expiryMonth', 'expiryYear'])
  })
})
