// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attachInlineButton,
  overlayHost,
  REGISTRATION_CHOICES,
  registrationChoiceOptions,
} from '../../src/content/overlay'
import { EFF_WORDLIST } from '../../src/content/eff-wordlist'

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

function focusFirstInput() {
  document.querySelector('input')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
}

function selectIn(roots: ShadowRoot[]): HTMLSelectElement {
  return roots.flatMap((root) => [...root.querySelectorAll('select')])[0] as HTMLSelectElement
}

function buttonIn(roots: ShadowRoot[], label: string): HTMLButtonElement {
  return roots.flatMap((root) => [...root.querySelectorAll('button')])
    .find((button) => button.textContent === label) as HTMLButtonElement
}

function passwordFields(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]'))
}

function renderRegistration() {
  document.body.innerHTML = '<input type="password" name="new_password" /><input type="password" name="confirm_password" />'
  giveInputsLayout()
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

describe('the registration password format choice', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    overlayHost()?.remove()
    document.body.innerHTML = ''
  })

  it('offers every format on a registration form', () => {
    const roots = captureShadow()
    renderRegistration()
    const detach = attachInlineButton(baseOptions())
    focusFirstInput()

    const select = selectIn(roots)
    expect(select.hidden).toBe(false)
    expect([...select.options].map((option) => option.value))
      .toEqual(REGISTRATION_CHOICES.map(([value]) => value))
    expect([...select.options].map((option) => option.textContent))
      .toEqual(REGISTRATION_CHOICES.map(([, label]) => label))
    expect(select.value).toBe('characters:20')
    detach()
  })

  it('hides the format choice on a sign-in form', () => {
    const roots = captureShadow()
    document.body.innerHTML = '<input type="text" autocomplete="username" /><input type="password" name="password" />'
    giveInputsLayout()
    const detach = attachInlineButton(baseOptions())
    focusFirstInput()

    expect(selectIn(roots).hidden).toBe(true)
    detach()
  })

  it('creates the chosen length when the control is used', async () => {
    const roots = captureShadow()
    renderRegistration()
    const detach = attachInlineButton(baseOptions())
    focusFirstInput()

    buttonIn(roots, 'Create password with Sesame').click()

    await vi.waitFor(() => expect(passwordFields()[0].value).toHaveLength(20))
    expect(passwordFields()[1].value).toBe(passwordFields()[0].value)
    detach()
  })

  it('creates a passphrase when that format is chosen', async () => {
    const roots = captureShadow()
    renderRegistration()
    const detach = attachInlineButton(baseOptions())
    focusFirstInput()

    const select = selectIn(roots)
    select.value = 'passphrase:5'
    select.dispatchEvent(new Event('change'))
    buttonIn(roots, 'Create password with Sesame').click()

    await vi.waitFor(() => expect(passwordFields()[0].value.split('-')).toHaveLength(5))
    for (const word of passwordFields()[0].value.split('-')) expect(EFF_WORDLIST).toContain(word)
    detach()
  })

  it('persists no format choice to extension storage', async () => {
    const storage = { local: { set: vi.fn(), get: vi.fn() } }
    vi.stubGlobal('chrome', { storage })
    const roots = captureShadow()
    renderRegistration()
    const detach = attachInlineButton(baseOptions())
    focusFirstInput()

    const select = selectIn(roots)
    select.value = 'characters:32'
    select.dispatchEvent(new Event('change'))
    buttonIn(roots, 'Create password with Sesame').click()

    await vi.waitFor(() => expect(passwordFields()[0].value).toHaveLength(32))
    expect(storage.local.set).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
    detach()
  })
})

describe('registrationChoiceOptions', () => {
  it('maps every offered value to a generator option', () => {
    expect(registrationChoiceOptions('characters:16')).toEqual({ mode: 'characters', length: 16 })
    expect(registrationChoiceOptions('characters:20')).toEqual({ mode: 'characters', length: 20 })
    expect(registrationChoiceOptions('characters:24')).toEqual({ mode: 'characters', length: 24 })
    expect(registrationChoiceOptions('characters:32')).toEqual({ mode: 'characters', length: 32 })
    expect(registrationChoiceOptions('passphrase:5')).toEqual({ mode: 'passphrase', words: 5 })
    expect(registrationChoiceOptions('passphrase:6')).toEqual({ mode: 'passphrase', words: 6 })
    expect(registrationChoiceOptions('passphrase:7')).toEqual({ mode: 'passphrase', words: 7 })
  })

  it('falls back to the default format for an unknown value', () => {
    expect(registrationChoiceOptions('unknown')).toEqual({})
  })
})
