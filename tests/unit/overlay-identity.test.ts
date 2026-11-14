// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachInlineButton, overlayHost } from '../../src/content/overlay'
import { stubVisibilityObserver, trustedClick, visibilityObserver } from './release-visibility-stub'

function giveInputsLayout() {
  for (const input of document.querySelectorAll('input')) {
    input.setAttribute('style', 'opacity:1;display:block;visibility:visible')
    input.getBoundingClientRect = () => ({ width: 180, height: 32, top: 10, left: 10, bottom: 42, right: 190, x: 10, y: 10, toJSON: () => ({}) }) as DOMRect
  }
}

function captureShadow(): ShadowRoot[] {
  const roots: ShadowRoot[] = []
  const original = Element.prototype.attachShadow
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
    const root = original.call(this, { ...init, mode: 'open' })
    roots.push(root)
    return root
  })
  return roots
}

function actionLabels(roots: ShadowRoot[]): string[] {
  return roots.flatMap((root) => [...root.querySelectorAll('button')])
    .filter((button) => !button.hidden && button.title !== 'Dismiss')
    .map((button) => button.textContent ?? '')
}

function buttonIn(roots: ShadowRoot[], label: string): HTMLButtonElement {
  return roots.flatMap((root) => [...root.querySelectorAll('button')])
    .find((button) => button.textContent === label) as HTMLButtonElement
}

function selectIn(roots: ShadowRoot[]): HTMLSelectElement {
  return roots.flatMap((root) => [...root.querySelectorAll('select')])[0] as HTMLSelectElement
}

function focusInput(selector: string) {
  document.querySelector(selector)!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
}

async function armRelease(roots: ShadowRoot[], label: string) {
  visibilityObserver().report({ isVisible: true, isIntersecting: true })
  await vi.waitFor(() => expect(buttonIn(roots, label).disabled).toBe(false))
}

function baseOptions() {
  return {
    onFillRequest: vi.fn(),
    onConnectionCheck: vi.fn(),
    onOpenDesktop: vi.fn(),
    onFillIdentityRequest: vi.fn(),
    onFillCardRequest: vi.fn(),
    onFillOneTimeCodeRequest: vi.fn(),
  }
}

function renderShippingForm() {
  document.body.innerHTML = `<form>
    <input name="full_name" autocomplete="name" />
    <input type="email" name="email" autocomplete="email" />
    <input name="address" autocomplete="address-line1" />
    <button type="submit">Pay now</button>
  </form>`
  giveInputsLayout()
}

beforeEach(() => {
  vi.restoreAllMocks()
  overlayHost()?.remove()
  document.body.innerHTML = ''
  stubVisibilityObserver()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the inline control on an identity form', () => {
  it('offers one primary identity fill on a shipping form', async () => {
    const roots = captureShadow()
    renderShippingForm()
    const options = baseOptions()
    const detach = attachInlineButton(options)
    focusInput('input[name="full_name"]')

    expect(actionLabels(roots)).toEqual(['Fill identity'])
    const identity = buttonIn(roots, 'Fill identity')
    expect(identity.className).toBe('fill')
    expect(buttonIn(roots, 'Fill with Sesame').hidden).toBe(true)
    expect(selectIn(roots).hidden).toBe(true)
    expect(buttonIn(roots, 'Copy password').hidden).toBe(true)
    expect(options.onConnectionCheck).not.toHaveBeenCalled()

    await armRelease(roots, 'Fill identity')
    trustedClick(identity)
    await vi.waitFor(() => expect(options.onFillIdentityRequest).toHaveBeenCalledTimes(1))
    expect(options.onFillRequest).not.toHaveBeenCalled()
    detach()
  })

  it('keeps the login fill and adds the identity fill for a lone email field', () => {
    const roots = captureShadow()
    document.body.innerHTML = `<form>
      <input type="email" name="email" autocomplete="email" />
      <button type="submit">Continue</button>
    </form>`
    giveInputsLayout()
    const detach = attachInlineButton(baseOptions())
    focusInput('input[name="email"]')

    expect(actionLabels(roots)).toEqual(['Fill with Sesame', 'Fill identity'])
    expect(buttonIn(roots, 'Fill identity').className).toBe('identity')
    detach()
  })

  it('stays hidden for a lone field that only looks like a name', () => {
    const roots = captureShadow()
    document.body.innerHTML = '<form><input name="name" /><button type="submit">Create</button></form>'
    giveInputsLayout()
    const detach = attachInlineButton(baseOptions())
    focusInput('input[name="name"]')

    expect(actionLabels(roots)).toEqual([])
    detach()
  })

  it('offers the identity fill on a contact form without autocomplete hints', () => {
    const roots = captureShadow()
    document.body.innerHTML = `<form>
      <label>Your name <input name="contact_name" /></label>
      <label>Phone <input name="contact_phone" /></label>
    </form>`
    giveInputsLayout()
    const detach = attachInlineButton(baseOptions())
    focusInput('input[name="contact_name"]')

    expect(actionLabels(roots)).toEqual(['Fill identity'])
    detach()
  })

  it('shows no identity button on a sign-in form with a password', () => {
    const roots = captureShadow()
    document.body.innerHTML = `<form>
      <input type="email" name="email" autocomplete="email" />
      <input type="password" name="password" autocomplete="current-password" />
      <button type="submit">Sign in</button>
    </form>`
    giveInputsLayout()
    const detach = attachInlineButton(baseOptions())
    focusInput('input[name="email"]')

    expect(actionLabels(roots)).toEqual(['Fill with Sesame'])
    expect(buttonIn(roots, 'Fill identity').hidden).toBe(true)
    detach()
  })

  it('keeps the registration controls and adds the identity button on a sign-up form', () => {
    const roots = captureShadow()
    document.body.innerHTML = `<form>
      <input name="full_name" autocomplete="name" />
      <input type="email" name="email" autocomplete="email" />
      <input type="password" name="new_password" autocomplete="new-password" />
      <input type="password" name="confirm_password" autocomplete="new-password" />
      <button type="submit">Create account</button>
    </form>`
    giveInputsLayout()
    const detach = attachInlineButton(baseOptions())
    focusInput('input[name="new_password"]')

    expect(actionLabels(roots)).toEqual(['Create password with Sesame', 'Fill identity'])
    expect(selectIn(roots).hidden).toBe(false)
    expect(buttonIn(roots, 'Fill identity').className).toBe('identity')
    detach()
  })

  it.each([
    ['a search field', '<input type="search" name="site_search" />'],
    ['a promo code field', '<input type="text" name="promo_code" />'],
  ])('shows nothing for %s', (_name, markup) => {
    const roots = captureShadow()
    document.body.innerHTML = markup
    giveInputsLayout()
    const detach = attachInlineButton(baseOptions())
    focusInput('input')

    expect(overlayHost()).toBeNull()
    expect(roots).toEqual([])
    detach()
  })

  it('refuses an identity click before the overlay is confirmed visible', async () => {
    const roots = captureShadow()
    renderShippingForm()
    const options = baseOptions()
    const detach = attachInlineButton(options)
    focusInput('input[name="full_name"]')

    const identity = buttonIn(roots, 'Fill identity')
    expect(identity.disabled).toBe(true)
    trustedClick(identity)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(options.onFillIdentityRequest).not.toHaveBeenCalled()
    expect(identity.disabled).toBe(true)
    detach()
  })
})
