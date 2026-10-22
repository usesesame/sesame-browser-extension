// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cardFieldsForInput } from '../../src/content/card-fields'
import { isUsernameField } from '../../src/content/field-detector'
import { identityFieldForInput } from '../../src/content/identity-fields'
import { inspectOneTimeCodeSurface } from '../../src/content/one-time-code'

function render(html: string): HTMLInputElement[] {
  document.body.innerHTML = html
  const inputs = Array.from(document.querySelectorAll('input'))
  for (const input of inputs) {
    input.getBoundingClientRect = () => ({
      width: 200, height: 30, top: 0, left: 0, right: 200, bottom: 30, x: 0, y: 0, toJSON: () => ({}),
    }) as DOMRect
  }
  return inputs
}

const first = (html: string) => render(html)[0]

beforeEach(() => {
  vi.stubGlobal('location', { protocol: 'https:', origin: 'https://example.test' })
  vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible', opacity: '1' }))
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('text message codes are not card fields', () => {
  it('trusts a one-time-code autocomplete over a security code name', () => {
    expect(cardFieldsForInput(first('<input name="security_code" autocomplete="one-time-code">'))).toEqual([])
  })

  it('leaves a security code with no card around it to the one-time code surface', () => {
    const input = first('<label for="c">Security code</label><input id="c" name="code" maxlength="6" inputmode="numeric">')
    expect(cardFieldsForInput(input)).toEqual([])
    expect(inspectOneTimeCodeSurface()).toMatchObject({ ok: true, kind: 'single' })
  })

  it('leaves a code that says it was sent by text message to the one-time code surface', () => {
    const input = first('<input aria-label="Security code from the text message we sent" maxlength="6">')
    expect(cardFieldsForInput(input)).toEqual([])
  })

  it('leaves named verification and passcode fields alone', () => {
    for (const hint of ['SMS verification code', 'Authenticator code', 'One-time passcode', 'Two-factor code']) {
      expect(cardFieldsForInput(first(`<input aria-label="${hint}">`)), hint).toEqual([])
    }
  })

  it('still reads a security code beside a card number as the card code', () => {
    const [, code] = render('<form><input name="cardnumber"><input aria-label="Security code" maxlength="4"></form>')
    expect(cardFieldsForInput(code)).toEqual(['securityCode'])
  })

  it('still reads a three digit security code and the card words as the card code', () => {
    expect(cardFieldsForInput(first('<input aria-label="Security code" maxlength="3">'))).toEqual(['securityCode'])
    expect(cardFieldsForInput(first('<input aria-label="Card verification code">'))).toEqual(['securityCode'])
    expect(cardFieldsForInput(first('<input name="cvv">'))).toEqual(['securityCode'])
  })

  it('keeps an explicit card autocomplete even when the hint mentions a code', () => {
    expect(cardFieldsForInput(first('<input aria-label="Verification code" autocomplete="cc-csc">'))).toEqual(['securityCode'])
  })

  it('does not read a gift card or promo code as a card security code', () => {
    expect(cardFieldsForInput(first('<input aria-label="Gift card code">'))).toEqual([])
  })
})

describe('card verification fields are not one-time codes', () => {
  it('leaves a card verification code to the card surface', () => {
    render('<input type="text" aria-label="Card verification code" maxlength="3">')
    expect(inspectOneTimeCodeSurface()).toEqual({ ok: false, code: 'no-fields' })
  })

  it('leaves a field named cvv to the card surface', () => {
    render('<input type="tel" name="cvv" placeholder="Verification">')
    expect(inspectOneTimeCodeSurface()).toEqual({ ok: false, code: 'no-fields' })
  })
})

describe('text message codes are not identity or sign-in fields', () => {
  it('does not read a code sent to a phone as the phone number', () => {
    expect(identityFieldForInput(first('<input type="tel" aria-label="Enter the code sent to your phone">'))).toBeUndefined()
    expect(identityFieldForInput(first('<input type="text" name="mobile_verification_code">'))).toBeUndefined()
    expect(identityFieldForInput(first('<input type="text" autocomplete="one-time-code" name="phone">'))).toBeUndefined()
  })

  it('still reads a phone number', () => {
    expect(identityFieldForInput(first('<input type="tel" aria-label="Mobile number">'))).toBe('phone')
    expect(identityFieldForInput(first('<input type="tel" aria-label="Mobile number for text message alerts">'))).toBe('phone')
  })

  it('does not read a code sent by email as the email address', () => {
    expect(identityFieldForInput(first('<input type="text" aria-label="Code we emailed you">'))).toBeUndefined()
    expect(isUsernameField(first('<input type="text" aria-label="Enter the code from your email, 2FA">'))).toBe(false)
    expect(isUsernameField(first('<input type="text" name="email_passcode">'))).toBe(false)
    expect(isUsernameField(first('<input type="text" aria-label="Authenticator code">'))).toBe(false)
  })

  it('still reads an email field', () => {
    expect(identityFieldForInput(first('<input type="email" aria-label="Email address">'))).toBe('email')
    expect(isUsernameField(first('<input type="text" aria-label="Email or username">'))).toBe(true)
  })
})
