// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { identityFieldForInput } from '../../src/content/identity-fields'
import { inspectIdentitySurface } from '../../src/content/identity-detector'
import { fillIdentitySurface } from '../../src/content/identity-writer'

function layout(element: Element) {
  element.getBoundingClientRect = () => ({
    width: 200, height: 30, top: 0, left: 0, right: 200, bottom: 30, x: 0, y: 0, toJSON: () => ({}),
  }) as DOMRect
}

function render(html: string): HTMLInputElement[] {
  document.body.innerHTML = html
  const inputs = Array.from(document.querySelectorAll('input'))
  for (const input of inputs) layout(input)
  return inputs
}

const first = (html: string) => render(html)[0]

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('identity autocomplete mapping', () => {
  it('wins over a conflicting hint', () => {
    expect(identityFieldForInput(first('<input autocomplete="email" name="phone" />'))).toBe('email')
    expect(identityFieldForInput(first('<input autocomplete="tel" name="email" />'))).toBe('phone')
    expect(identityFieldForInput(first('<input autocomplete="address-level1" id="city" />'))).toBe('region')
  })
})

describe('identity hint fallback', () => {
  it('matches realistic name and id hints', () => {
    expect(identityFieldForInput(first('<input name="full_name" />'))).toBe('fullName')
    expect(identityFieldForInput(first('<input id="your-name" />'))).toBe('fullName')
    expect(identityFieldForInput(first('<input name="name" />'))).toBe('fullName')
    expect(identityFieldForInput(first('<input name="user_email" />'))).toBe('email')
    expect(identityFieldForInput(first('<input id="email_address" />'))).toBe('email')
    expect(identityFieldForInput(first('<input name="mobile_phone" />'))).toBe('phone')
    expect(identityFieldForInput(first('<input placeholder="Telephone" />'))).toBe('phone')
    expect(identityFieldForInput(first('<input name="address_line_1" />'))).toBe('addressLine1')
    expect(identityFieldForInput(first('<input id="street_address" />'))).toBe('addressLine1')
    expect(identityFieldForInput(first('<input name="address" />'))).toBe('addressLine1')
    expect(identityFieldForInput(first('<input name="address_line_2" />'))).toBe('addressLine2')
    expect(identityFieldForInput(first('<input placeholder="Apt, suite, unit" />'))).toBe('addressLine2')
    expect(identityFieldForInput(first('<input name="city" />'))).toBe('city')
    expect(identityFieldForInput(first('<input name="state" />'))).toBe('region')
    expect(identityFieldForInput(first('<input name="province" />'))).toBe('region')
    expect(identityFieldForInput(first('<input id="zip_code" />'))).toBe('postalCode')
    expect(identityFieldForInput(first('<input name="postal_code" />'))).toBe('postalCode')
    expect(identityFieldForInput(first('<input name="country" />'))).toBe('country')
  })

  it('reads a bound label', () => {
    render('<label for="fn">Full name</label><input id="fn" />')
    expect(identityFieldForInput(document.querySelector('input')!)).toBe('fullName')
  })

  it('reads a wrapping label', () => {
    render('<label>Postal code<input /></label>')
    expect(identityFieldForInput(document.querySelector('input')!)).toBe('postalCode')
  })

  it('leaves search, coupon, account, and password fields alone', () => {
    expect(identityFieldForInput(first('<input type="search" name="q" placeholder="Search" />'))).toBeUndefined()
    expect(identityFieldForInput(first('<input name="coupon_code" placeholder="Coupon" />'))).toBeUndefined()
    expect(identityFieldForInput(first('<input type="password" name="password" />'))).toBeUndefined()
    expect(identityFieldForInput(first('<input name="user_name" />'))).toBeUndefined()
    expect(identityFieldForInput(first('<input name="company_name" />'))).toBeUndefined()
    expect(identityFieldForInput(first('<input name="card_name" />'))).toBeUndefined()
  })

  it('leaves split first and last name fields to a single full-name field', () => {
    expect(identityFieldForInput(first('<input name="first_name" />'))).toBeUndefined()
    expect(identityFieldForInput(first('<input name="last_name" />'))).toBeUndefined()
  })

  it('does not read a wallet, contract, or network address as a street address', () => {
    expect(identityFieldForInput(first('<input name="wallet_address" />'))).toBeUndefined()
    expect(identityFieldForInput(first('<input id="contract-address" />'))).toBeUndefined()
    expect(identityFieldForInput(first('<input name="ip_address" />'))).toBeUndefined()
    expect(identityFieldForInput(first('<input name="mac_address" />'))).toBeUndefined()
    expect(identityFieldForInput(first('<input name="bitcoin_address" />'))).toBeUndefined()
    expect(identityFieldForInput(first('<input name="eth_address" />'))).toBeUndefined()
    expect(identityFieldForInput(first('<input placeholder="Web address" />'))).toBeUndefined()
    expect(identityFieldForInput(first('<input name="server_address" />'))).toBeUndefined()
  })

  it('still reads a shipping, billing, street, or numbered address', () => {
    expect(identityFieldForInput(first('<input name="shipping_address" />'))).toBe('addressLine1')
    expect(identityFieldForInput(first('<input name="billing_address" />'))).toBe('addressLine1')
    expect(identityFieldForInput(first('<input placeholder="Street address" />'))).toBe('addressLine1')
    expect(identityFieldForInput(first('<input placeholder="Address line 1" />'))).toBe('addressLine1')
    expect(identityFieldForInput(first('<input name="mailing_address" />'))).toBe('addressLine1')
    expect(identityFieldForInput(first('<input name="home_address" />'))).toBe('addressLine1')
  })

  it('trusts an explicit autocomplete token over an address qualifier', () => {
    expect(identityFieldForInput(first('<input autocomplete="address-line1" name="wallet_address" />')))
      .toBe('addressLine1')
  })

  it('leaves a phone country code alone but reads a country field', () => {
    expect(identityFieldForInput(first('<input name="country_code" />'))).toBeUndefined()
    expect(identityFieldForInput(first('<input name="country" />'))).toBe('country')
  })

  it('leaves a non-person name field alone', () => {
    expect(identityFieldForInput(first('<input name="event_name" />'))).toBeUndefined()
    expect(identityFieldForInput(first('<input name="project_name" />'))).toBeUndefined()
    expect(identityFieldForInput(first('<input name="team_name" />'))).toBeUndefined()
  })

  it('reads only text-like inputs', () => {
    expect(identityFieldForInput(first('<input type="checkbox" name="email" />'))).toBeUndefined()
    expect(identityFieldForInput(first('<input type="radio" name="city" />'))).toBeUndefined()
    expect(identityFieldForInput(first('<input type="search" name="city" />'))).toBeUndefined()
    expect(identityFieldForInput(first('<input type="number" name="postal_code" />'))).toBe('postalCode')
  })
})

describe('identity surface inspection', () => {
  it('reports the fallback fields in document order', () => {
    render('<form><input name="full_name" /><input id="user_email" /><input name="address_line_1" /><input name="city" /></form>')
    expect(inspectIdentitySurface()).toEqual({
      ok: true,
      surface: { ok: true, origin: window.location.origin },
      fields: ['fullName', 'email', 'addressLine1', 'city'],
    })
  })

  it('reports no fields when only unrelated inputs are visible', () => {
    render('<input type="search" name="q" /><input type="password" name="password" />')
    expect(inspectIdentitySurface()).toEqual({ ok: false, code: 'no-fields' })
  })
})

describe('identity writing agrees with detection', () => {
  it('prepares and fills fallback fields', () => {
    const inputs = render('<form><input name="full_name" /><input id="user_email" /></form>')
    const origin = window.location.origin
    const token = 'identity-fill-token-1234'

    expect(fillIdentitySurface(origin, token, null, 'prepare')).toEqual({
      ok: true,
      filledFields: ['fullName', 'email'],
    })
    const identity = { fullName: 'Jamie Example', email: 'jamie@example.test' }
    expect(fillIdentitySurface(origin, token, identity)).toEqual({
      ok: true,
      filledFields: ['fullName', 'email'],
    })
    expect(inputs[0].value).toBe('Jamie Example')
    expect(inputs[1].value).toBe('jamie@example.test')
    expect(identity).toEqual({ fullName: '', email: '' })
  })
})
