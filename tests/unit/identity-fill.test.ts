// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { identityFieldsForAnchor, inspectIdentitySurface } from '../../src/content/identity-detector'
import { recordIdentityFillAnchor } from '../../src/content/identity-fields'
import { fillIdentitySurface } from '../../src/content/identity-writer'

const origin = window.location.origin
const otherOrigin = 'https://other.example.test'
const token = 'identity-fill-token-1234'

function layout(element: Element): void {
  element.getBoundingClientRect = () => ({
    width: 200, height: 30, top: 0, left: 0, right: 200, bottom: 30, x: 0, y: 0, toJSON: () => ({}),
  }) as DOMRect
}

function render(html: string): void {
  document.body.innerHTML = html
  for (const element of document.querySelectorAll('input, select, textarea')) layout(element)
}

function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (!found) throw new Error(`missing ${selector}`)
  return found
}

function elements<T extends Element>(selector: string): T[] {
  return Array.from(document.querySelectorAll<T>(selector))
}

function blurActiveElement(): void {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
}

beforeEach(() => {
  document.body.innerHTML = ''
  fillIdentitySurface(origin, token, null, 'clear')
})

describe('split names', () => {
  it('splits a saved full name across given and family fields', () => {
    render('<form><input autocomplete="given-name" /><input autocomplete="family-name" /></form>')
    const [given, family] = elements<HTMLInputElement>('input')

    expect(fillIdentitySurface(origin, token, null, 'prepare')).toEqual({
      ok: true,
      filledFields: ['fullName'],
    })
    const identity = { fullName: 'Ada Lovelace' }
    expect(fillIdentitySurface(origin, token, identity)).toEqual({
      ok: true,
      filledFields: ['fullName'],
    })
    expect(given.value).toBe('Ada')
    expect(family.value).toBe('Lovelace')
    expect(identity).toEqual({ fullName: '' })
  })

  it('fills only the given name when the saved name is one word', () => {
    render('<form><input name="first_name" /><input name="last_name" /></form>')
    const [given, family] = elements<HTMLInputElement>('input')

    expect(fillIdentitySurface(origin, token, null, 'prepare')).toEqual({
      ok: true,
      filledFields: ['fullName'],
    })
    expect(fillIdentitySurface(origin, token, { fullName: 'Ada' })).toEqual({
      ok: true,
      filledFields: ['fullName'],
    })
    expect(given.value).toBe('Ada')
    expect(family.value).toBe('')
  })

  it('leaves a middle name field empty', () => {
    render('<form><input name="first_name" /><input name="middle_name" /><input name="last_name" /></form>')
    const [given, middle, family] = elements<HTMLInputElement>('input')

    expect(fillIdentitySurface(origin, token, null, 'prepare')).toEqual({
      ok: true,
      filledFields: ['fullName'],
    })
    expect(fillIdentitySurface(origin, token, { fullName: 'Ada Lovelace' })).toEqual({
      ok: true,
      filledFields: ['fullName'],
    })
    expect(given.value).toBe('Ada')
    expect(middle.value).toBe('')
    expect(family.value).toBe('Lovelace')
  })
})

describe('select menus', () => {
  it('selects a country option by name through its two letter code', () => {
    render('<form><select autocomplete="country" name="country"><option value="">Choose a country</option><option value="CA">Canada</option><option value="US">USA</option></select></form>')
    const select = element<HTMLSelectElement>('select')
    const events: string[] = []
    select.addEventListener('input', () => events.push('input'))
    select.addEventListener('change', () => events.push('change'))

    expect(fillIdentitySurface(origin, token, null, 'prepare')).toEqual({
      ok: true,
      filledFields: ['country'],
    })
    const identity = { country: 'United States' }
    expect(fillIdentitySurface(origin, token, identity)).toEqual({
      ok: true,
      filledFields: ['country'],
    })
    expect(select.value).toBe('US')
    expect(events).toEqual(['input', 'change'])
    expect(identity).toEqual({ country: '' })
  })

  it('selects a country option by a two letter code', () => {
    render('<form><select name="country"><option value="">Choose a country</option><option value="usa">United States</option><option value="gbr">United Kingdom</option></select></form>')
    const select = element<HTMLSelectElement>('select')

    expect(fillIdentitySurface(origin, token, null, 'prepare')).toEqual({
      ok: true,
      filledFields: ['country'],
    })
    expect(fillIdentitySurface(origin, token, { country: 'US' })).toEqual({
      ok: true,
      filledFields: ['country'],
    })
    expect(select.value).toBe('usa')
  })

  it('selects a region option by text', () => {
    render('<form><select autocomplete="address-level1" name="state"><option value="">Choose a state</option><option value="NY">New York</option></select></form>')
    const select = element<HTMLSelectElement>('select')

    expect(fillIdentitySurface(origin, token, null, 'prepare')).toEqual({
      ok: true,
      filledFields: ['region'],
    })
    expect(fillIdentitySurface(origin, token, { region: 'new york' })).toEqual({
      ok: true,
      filledFields: ['region'],
    })
    expect(select.value).toBe('NY')
  })

  it('leaves a select untouched and uncounted when no option matches', () => {
    render('<form><select name="country"><option value="GB">United Kingdom</option><option value="US">United States</option></select><input type="email" name="email" /></form>')
    const select = element<HTMLSelectElement>('select')
    select.value = 'GB'

    expect(fillIdentitySurface(origin, token, null, 'prepare')).toEqual({
      ok: true,
      filledFields: ['country', 'email'],
    })
    const identity = { country: 'Narnia', email: 'ada@example.com' }
    expect(fillIdentitySurface(origin, token, identity)).toEqual({
      ok: true,
      filledFields: ['email'],
    })
    expect(select.value).toBe('GB')
    expect(element<HTMLInputElement>('input').value).toBe('ada@example.com')
    expect(identity).toEqual({ country: '', email: '' })
  })

  it('skips disabled and hidden selects', () => {
    render('<form><select name="country" disabled><option value="">Choose a country</option><option value="US">United States</option></select><select name="state" style="display: none"><option value="">Choose a state</option><option value="NY">New York</option></select><select name="region" hidden><option value="">Choose a region</option><option value="CA">California</option></select><input type="email" name="email" /></form>')
    const [country, region, hiddenRegion] = elements<HTMLSelectElement>('select')

    expect(inspectIdentitySurface()).toEqual({
      ok: true,
      surface: { ok: true, origin },
      fields: ['email'],
    })
    expect(fillIdentitySurface(origin, token, null, 'prepare')).toEqual({
      ok: true,
      filledFields: ['email'],
    })
    expect(fillIdentitySurface(origin, token, {
      country: 'United States',
      region: 'California',
      email: 'ada@example.com',
    })).toEqual({ ok: true, filledFields: ['email'] })
    expect(country.value).toBe('')
    expect(region.value).toBe('')
    expect(hiddenRegion.value).toBe('')
    expect(element<HTMLInputElement>('input').value).toBe('ada@example.com')
  })

  it('fills a country select inside an open shadow root', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = host.attachShadow({ mode: 'open' })
    const select = document.createElement('select')
    select.name = 'country'
    const placeholder = document.createElement('option')
    placeholder.value = ''
    placeholder.textContent = 'Choose a country'
    const option = document.createElement('option')
    option.value = 'US'
    option.textContent = 'United States'
    select.append(placeholder, option)
    root.append(select)
    layout(select)

    expect(fillIdentitySurface(origin, token, null, 'prepare')).toEqual({
      ok: true,
      filledFields: ['country'],
    })
    expect(fillIdentitySurface(origin, token, { country: 'US' })).toEqual({
      ok: true,
      filledFields: ['country'],
    })
    expect(select.value).toBe('US')
  })
})

describe('street address textarea', () => {
  it('fills both address lines and dispatches input and change', () => {
    render('<form><textarea autocomplete="street-address"></textarea></form>')
    const textarea = element<HTMLTextAreaElement>('textarea')
    const events: string[] = []
    textarea.addEventListener('input', () => events.push('input'))
    textarea.addEventListener('change', () => events.push('change'))

    expect(inspectIdentitySurface()).toEqual({
      ok: true,
      surface: { ok: true, origin },
      fields: ['addressLine1', 'addressLine2'],
    })
    expect(fillIdentitySurface(origin, token, null, 'prepare')).toEqual({
      ok: true,
      filledFields: ['addressLine1', 'addressLine2'],
    })
    const identity = { addressLine1: '1 Example Street', addressLine2: 'Flat 2' }
    expect(fillIdentitySurface(origin, token, identity)).toEqual({
      ok: true,
      filledFields: ['addressLine1', 'addressLine2'],
    })
    expect(textarea.value).toBe('1 Example Street\nFlat 2')
    expect(events).toEqual(['input', 'change'])
    expect(identity).toEqual({ addressLine1: '', addressLine2: '' })
  })

  it('fills one line when address line two is absent', () => {
    render('<form><textarea name="street_address"></textarea></form>')
    const textarea = element<HTMLTextAreaElement>('textarea')

    expect(fillIdentitySurface(origin, token, null, 'prepare')).toEqual({
      ok: true,
      filledFields: ['addressLine1', 'addressLine2'],
    })
    expect(fillIdentitySurface(origin, token, { addressLine1: '1 Example Street' })).toEqual({
      ok: true,
      filledFields: ['addressLine1'],
    })
    expect(textarea.value).toBe('1 Example Street')
  })
})

describe('confirm email', () => {
  it('fills every email field in the chosen surface', () => {
    render('<form><input type="email" name="email" /><input type="email" name="confirm_email" /></form>')
    const [email, confirm] = elements<HTMLInputElement>('input')

    expect(fillIdentitySurface(origin, token, null, 'prepare')).toEqual({
      ok: true,
      filledFields: ['email'],
    })
    expect(fillIdentitySurface(origin, token, { email: 'ada@example.com' })).toEqual({
      ok: true,
      filledFields: ['email'],
    })
    expect(email.value).toBe('ada@example.com')
    expect(confirm.value).toBe('ada@example.com')
  })

  it('fills the first email and later confirmation fields but not another address', () => {
    render(`
      <form>
        <input type="email" name="email" />
        <input type="email" name="backup_email" />
        <input type="email" name="repeat_email" />
      </form>`)
    const [email, backup, repeat] = elements<HTMLInputElement>('input')

    expect(fillIdentitySurface(origin, token, null, 'prepare')).toEqual({
      ok: true,
      filledFields: ['email'],
    })
    expect(fillIdentitySurface(origin, token, { email: 'ada@example.com' })).toEqual({
      ok: true,
      filledFields: ['email'],
    })
    expect(email.value).toBe('ada@example.com')
    expect(backup.value).toBe('')
    expect(repeat.value).toBe('ada@example.com')
  })

  it('fills the first email when a friend email field comes first', () => {
    render(`
      <form>
        <input type="email" name="friend_email" />
        <input type="email" name="email" />
      </form>`)
    const [friend, email] = elements<HTMLInputElement>('input')

    expect(inspectIdentitySurface()).toEqual({
      ok: true,
      surface: { ok: true, origin },
      fields: ['email'],
    })
    expect(fillIdentitySurface(origin, token, null, 'prepare')).toEqual({
      ok: true,
      filledFields: ['email'],
    })
    expect(fillIdentitySurface(origin, token, { email: 'ada@example.com' })).toEqual({
      ok: true,
      filledFields: ['email'],
    })
    expect(friend.value).toBe('')
    expect(email.value).toBe('ada@example.com')
  })
})

describe('email fields outside a form', () => {
  it('fills a formless confirmation field and leaves an unrelated email field alone', () => {
    render('<div><input name="full_name" /><input type="email" name="email" /><input type="email" aria-label="Confirm email" /></div><footer><input type="email" name="newsletter" /></footer>')
    element<HTMLInputElement>('input[name="email"]').focus()

    fillIdentitySurface(origin, token, null, 'prepare')
    expect(fillIdentitySurface(origin, token, { fullName: 'Ada Lovelace', email: 'ada@example.com' })).toEqual({
      ok: true,
      filledFields: ['fullName', 'email'],
    })
    expect(element<HTMLInputElement>('input[aria-label="Confirm email"]').value).toBe('ada@example.com')
    expect(element<HTMLInputElement>('input[name="newsletter"]').value).toBe('')
  })
})

describe('surface selection', () => {
  const forms = '<form id="newsletter"><input type="email" name="newsletter_email" /></form><form id="checkout"><input name="full_name" /><input type="email" name="email" /><input name="city" /></form>'

  it('fills the focused checkout form and leaves a newsletter form alone', () => {
    render(forms)
    const checkoutEmail = element<HTMLInputElement>('#checkout input[type="email"]')
    checkoutEmail.focus()

    expect(inspectIdentitySurface()).toEqual({
      ok: true,
      surface: { ok: true, origin },
      fields: ['fullName', 'email', 'city'],
    })
    expect(fillIdentitySurface(origin, token, null, 'prepare')).toEqual({
      ok: true,
      filledFields: ['fullName', 'email', 'city'],
    })
    const identity = { fullName: 'Ada Lovelace', email: 'ada@example.com', city: 'London' }
    expect(fillIdentitySurface(origin, token, identity)).toEqual({
      ok: true,
      filledFields: ['fullName', 'email', 'city'],
    })
    expect(element<HTMLInputElement>('#newsletter input').value).toBe('')
    expect(element<HTMLInputElement>('#checkout input[name="full_name"]').value).toBe('Ada Lovelace')
    expect(checkoutEmail.value).toBe('ada@example.com')
    expect(element<HTMLInputElement>('#checkout input[name="city"]').value).toBe('London')
  })

  it('uses the focused field inside an open shadow root', () => {
    render('<form id="newsletter"><input type="email" name="newsletter_email" /></form>')
    const host = document.createElement('div')
    document.body.append(host)
    const root = host.attachShadow({ mode: 'open' })
    const form = document.createElement('form')
    const name = document.createElement('input')
    name.name = 'full_name'
    const email = document.createElement('input')
    email.type = 'email'
    email.name = 'email'
    form.append(name, email)
    root.append(form)
    layout(name)
    layout(email)
    email.focus()

    expect(inspectIdentitySurface()).toEqual({
      ok: true,
      surface: { ok: true, origin },
      fields: ['fullName', 'email'],
    })
    expect(fillIdentitySurface(origin, token, null, 'prepare')).toEqual({
      ok: true,
      filledFields: ['fullName', 'email'],
    })
    expect(fillIdentitySurface(origin, token, {
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
    })).toEqual({ ok: true, filledFields: ['fullName', 'email'] })
    expect(element<HTMLInputElement>('#newsletter input').value).toBe('')
    expect(name.value).toBe('Ada Lovelace')
    expect(email.value).toBe('ada@example.com')
  })

  it('picks the form with the most identity targets when nothing is focused', () => {
    render(forms)
    blurActiveElement()

    expect(inspectIdentitySurface()).toEqual({
      ok: true,
      surface: { ok: true, origin },
      fields: ['fullName', 'email', 'city'],
    })
    expect(fillIdentitySurface(origin, token, null, 'prepare')).toEqual({
      ok: true,
      filledFields: ['fullName', 'email', 'city'],
    })
    expect(fillIdentitySurface(origin, token, {
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
      city: 'London',
    })).toEqual({ ok: true, filledFields: ['fullName', 'email', 'city'] })
    expect(element<HTMLInputElement>('#newsletter input').value).toBe('')
    expect(element<HTMLInputElement>('#checkout input[type="email"]').value).toBe('ada@example.com')
  })

  it('scopes anchor fields to the anchor form', () => {
    render(forms)
    const checkoutEmail = element<HTMLInputElement>('#checkout input[type="email"]')
    expect(identityFieldsForAnchor(checkoutEmail)).toEqual(['fullName', 'email', 'city'])
  })

  it('follows a focused password field into its own form', () => {
    render(`
      <form id="other">
        <input name="city" /><input name="address" />
        <input name="postal_code" /><input name="country" />
      </form>
      <form id="signup">
        <input name="full_name" /><input type="email" name="email" />
        <input type="password" name="new_password" />
      </form>`)
    const password = element<HTMLInputElement>('#signup input[type="password"]')
    password.focus()
    recordIdentityFillAnchor(password)

    expect(fillIdentitySurface(origin, token, null, 'prepare')).toEqual({
      ok: true,
      filledFields: ['fullName', 'email'],
    })
    password.blur()
    expect(fillIdentitySurface(origin, token, {
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
    })).toEqual({ ok: true, filledFields: ['fullName', 'email'] })
    expect(element<HTMLInputElement>('#signup input[name="full_name"]').value).toBe('Ada Lovelace')
    expect(element<HTMLInputElement>('#signup input[type="email"]').value).toBe('ada@example.com')
    expect(element<HTMLInputElement>('#other input[name="city"]').value).toBe('')
  })

  it('stays inside the container around a formless anchor', () => {
    render(`
      <section id="contact"><input name="full_name" /><input type="email" name="email" /></section>
      <section id="shipping"><input name="city" /><input name="address" /></section>`)
    const email = element<HTMLInputElement>('#contact input[type="email"]')
    email.focus()

    expect(identityFieldsForAnchor(email)).toEqual(['fullName', 'email'])
    expect(fillIdentitySurface(origin, token, null, 'prepare')).toEqual({
      ok: true,
      filledFields: ['fullName', 'email'],
    })
    expect(fillIdentitySurface(origin, token, {
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
      city: 'London',
      addressLine1: '1 Example Street',
    })).toEqual({ ok: true, filledFields: ['fullName', 'email'] })
    expect(email.value).toBe('ada@example.com')
    expect(element<HTMLInputElement>('#shipping input[name="city"]').value).toBe('')
    expect(element<HTMLInputElement>('#shipping input[name="address"]').value).toBe('')
  })

  it('chooses the largest formless container when nothing is focused', () => {
    render(`
      <section id="small"><input type="email" name="email" /></section>
      <section id="large"><input name="full_name" /><input name="city" /></section>`)
    blurActiveElement()

    expect(inspectIdentitySurface()).toEqual({
      ok: true,
      surface: { ok: true, origin },
      fields: ['fullName', 'city'],
    })
    expect(fillIdentitySurface(origin, token, null, 'prepare')).toEqual({
      ok: true,
      filledFields: ['fullName', 'city'],
    })
  })
})

describe('identity fill guards', () => {
  it('rejects a fill prepared for a different origin', () => {
    render('<form><input name="email" /></form>')
    expect(fillIdentitySurface(otherOrigin, token, null, 'prepare')).toEqual({
      ok: false,
      code: 'origin-mismatch',
    })
  })

  it('rejects short and unissued document tokens', () => {
    render('<form><input name="email" /></form>')
    expect(fillIdentitySurface(origin, 'short-token', null, 'prepare')).toEqual({
      ok: false,
      code: 'stale-document',
    })
    const identity = { email: 'ada@example.com' }
    expect(fillIdentitySurface(origin, token, identity)).toEqual({
      ok: false,
      code: 'stale-document',
    })
    expect(identity).toEqual({ email: 'ada@example.com' })
  })

  it('rejects a fill bound to another document token', () => {
    render('<form><input name="email" /></form>')
    const otherToken = 'identity-fill-token-5678'
    expect(fillIdentitySurface(origin, otherToken, null, 'prepare')).toEqual({
      ok: true,
      filledFields: ['email'],
    })
    expect(fillIdentitySurface(origin, token, { email: 'ada@example.com' })).toEqual({
      ok: false,
      code: 'stale-document',
    })
  })
})
