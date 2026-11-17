// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attachInlineButton,
  overlayHost,
  REGISTRATION_CHOICES,
  createMessage,
  registrationChoiceStyle,
} from '../../src/content/overlay'
import { stubVisibilityObserver, trustedClick, visibilityObserver } from './release-visibility-stub'
import { captureShadow, giveInputsLayout } from './overlay-fixtures'

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

async function armRelease(roots: ShadowRoot[], label: string) {
  visibilityObserver().report({ isVisible: true, isIntersecting: true })
  await vi.waitFor(() => expect(buttonIn(roots, label).disabled).toBe(false))
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
    onCreatePasswordRequest: vi.fn().mockResolvedValue({ ok: true }),
  }
}

describe('the registration password format choice', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    overlayHost()?.remove()
    document.body.innerHTML = ''
    stubVisibilityObserver()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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

  it('asks the desktop for the chosen length and writes nothing itself', async () => {
    const roots = captureShadow()
    renderRegistration()
    const options = baseOptions()
    const detach = attachInlineButton(options)
    focusFirstInput()

    await armRelease(roots, 'Create password with Sesame')
    trustedClick(buttonIn(roots, 'Create password with Sesame'))

    await vi.waitFor(() => expect(options.onCreatePasswordRequest).toHaveBeenCalledWith({ style: 'characters', size: 20 }))
    expect(passwordFields().every((field) => field.value === '')).toBe(true)
    expect(roots.flatMap((root) => [...root.querySelectorAll('button')]).some((button) => /copy/i.test(button.textContent ?? ''))).toBe(false)
    detach()
  })

  it('asks the desktop for a passphrase when that format is chosen', async () => {
    const roots = captureShadow()
    renderRegistration()
    const options = baseOptions()
    const detach = attachInlineButton(options)
    focusFirstInput()

    const select = selectIn(roots)
    select.value = 'passphrase:5'
    select.dispatchEvent(new Event('change'))
    await armRelease(roots, 'Create password with Sesame')
    trustedClick(buttonIn(roots, 'Create password with Sesame'))

    await vi.waitFor(() => expect(options.onCreatePasswordRequest).toHaveBeenCalledWith({ style: 'passphrase', size: 5 }))
    detach()
  })

  it('tells the person to update an older desktop and fills nothing', async () => {
    const roots = captureShadow()
    renderRegistration()
    const options = baseOptions()
    options.onCreatePasswordRequest.mockResolvedValue({ ok: false, code: 'pending-version-unsupported' })
    const detach = attachInlineButton(options)
    focusFirstInput()

    await armRelease(roots, 'Create password with Sesame')
    trustedClick(buttonIn(roots, 'Create password with Sesame'))

    await vi.waitFor(() => expect(roots.flatMap((root) => [...root.querySelectorAll('.status')]).map((node) => node.textContent))
      .toContain('Update the Sesame desktop app to create passwords here.'))
    expect(passwordFields().every((field) => field.value === '')).toBe(true)
    detach()
  })

  it('persists no format choice to extension storage', async () => {
    const storage = { local: { set: vi.fn(), get: vi.fn() } }
    vi.stubGlobal('chrome', { storage })
    const roots = captureShadow()
    renderRegistration()
    const options = baseOptions()
    const detach = attachInlineButton(options)
    focusFirstInput()

    const select = selectIn(roots)
    select.value = 'characters:32'
    select.dispatchEvent(new Event('change'))
    await armRelease(roots, 'Create password with Sesame')
    trustedClick(buttonIn(roots, 'Create password with Sesame'))

    await vi.waitFor(() => expect(options.onCreatePasswordRequest).toHaveBeenCalledWith({ style: 'characters', size: 32 }))
    expect(storage.local.set).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
    detach()
  })
})

describe('registrationChoiceStyle', () => {
  it('maps every offered value to a desktop password style', () => {
    expect(registrationChoiceStyle('characters:16')).toEqual({ style: 'characters', size: 16 })
    expect(registrationChoiceStyle('characters:20')).toEqual({ style: 'characters', size: 20 })
    expect(registrationChoiceStyle('characters:24')).toEqual({ style: 'characters', size: 24 })
    expect(registrationChoiceStyle('characters:32')).toEqual({ style: 'characters', size: 32 })
    expect(registrationChoiceStyle('passphrase:5')).toEqual({ style: 'passphrase', size: 5 })
    expect(registrationChoiceStyle('passphrase:6')).toEqual({ style: 'passphrase', size: 6 })
    expect(registrationChoiceStyle('passphrase:7')).toEqual({ style: 'passphrase', size: 7 })
  })

  it('falls back to the default style for an unknown value', () => {
    expect(registrationChoiceStyle('unknown')).toEqual({ style: 'characters', size: 20 })
  })
})

describe('createMessage', () => {
  it('answers every outcome in a short plain sentence', () => {
    for (const result of [{ ok: true }, { ok: false, code: 'vault-locked' }, { ok: false, code: 'approval-declined' }, { ok: false, code: 'other' }, undefined]) {
      const text = createMessage(result)
      expect(text).not.toMatch(/[—–()]/)
      expect(text.endsWith('.')).toBe(true)
    }
  })
})
