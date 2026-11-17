// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fillPasswordChangeSurface, normalizePasswordChangeOutcome } from '../../src/content/password-change'
import { fillGeneratedRegistration, normalizeRegistrationOutcome } from '../../src/content/registration'

const origin = 'https://accounts.example.test'
const token = 'password-change-token-1234'
const fallback = { version: 1, ok: false, code: 'password-change-fill-failed' }

const changeForm = `
  <form id="change">
    <input type="password" name="current_password" autocomplete="current-password">
    <input type="password" name="new_password" autocomplete="new-password">
    <input type="password" name="confirm_password">
  </form>
`

function prepareInputs(markup: string): HTMLInputElement[] {
  document.body.innerHTML = markup
  const inputs = Array.from(document.querySelectorAll('input'))
  for (const input of inputs) {
    input.getBoundingClientRect = () => ({
      width: 200, height: 30, top: 0, left: 0, right: 200, bottom: 30, x: 0, y: 0, toJSON: () => ({}),
    }) as DOMRect
  }
  return inputs
}

beforeEach(() => {
  vi.stubGlobal('location', { protocol: 'https:', origin })
  vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible', opacity: '1' }))
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(globalThis, '__sesamePendingPasswordChangeV1')
  Reflect.deleteProperty(globalThis, '__sesamePendingRegistrationV1')
})

describe('fillPasswordChangeSurface', () => {
  it('fills the current field with the stored password and the new fields with the generated one', () => {
    const inputs = prepareInputs(changeForm)
    expect(fillPasswordChangeSurface(origin, token, null, null, 'prepare')).toEqual({
      version: 1, ok: true, code: 'password-change-filled', currentFilled: 1, newFilled: 2,
    })

    const credential = { username: 'casey@example.test', password: 'stored-password-1' }
    const generated = 'generated-password-1234'
    expect(fillPasswordChangeSurface(origin, token, credential, generated)).toEqual({
      version: 1, ok: true, code: 'password-change-filled', currentFilled: 1, newFilled: 2,
    })

    expect(inputs[0].value).toBe('stored-password-1')
    expect(inputs[1].value).toBe(generated)
    expect(inputs[2].value).toBe(generated)
    expect(inputs[0].value).not.toBe(generated)
    expect(inputs[1].value).not.toBe('stored-password-1')
    expect(inputs[2].value).not.toBe('stored-password-1')
    expect(credential).toEqual({ username: '', password: '' })
  })

  it('never writes the generated password into a current field that also looks new', () => {
    const inputs = prepareInputs(`
      <form id="new_password_form">
        <input type="password" name="current_password" autocomplete="current-password">
        <input type="password" name="new_password" autocomplete="new-password">
        <input type="password" name="confirm_password">
      </form>
    `)
    expect(fillPasswordChangeSurface(origin, token, null, null, 'prepare')).toEqual({
      version: 1, ok: true, code: 'password-change-filled', currentFilled: 1, newFilled: 2,
    })
    expect(fillPasswordChangeSurface(
      origin, token, { username: 'casey', password: 'stored-password-1' }, 'generated-password-1234',
    )).toEqual({ version: 1, ok: true, code: 'password-change-filled', currentFilled: 1, newFilled: 2 })

    expect(inputs[0].value).toBe('stored-password-1')
    expect(inputs[1].value).toBe('generated-password-1234')
    expect(inputs[2].value).toBe('generated-password-1234')
  })

  it('refuses a registration-only surface', () => {
    prepareInputs(`
      <form id="register">
        <input type="password" name="new_password" autocomplete="new-password">
        <input type="password" name="confirm_password">
      </form>
    `)
    expect(fillPasswordChangeSurface(origin, token, null, null, 'prepare')).toEqual({
      version: 1, ok: false, code: 'not-password-change-form',
    })
  })

  it('refuses current and new fields in different forms', () => {
    prepareInputs(`
      <form id="current"><input type="password" name="current_password" autocomplete="current-password"></form>
      <form id="next"><input type="password" name="new_password" autocomplete="new-password"></form>
    `)
    expect(fillPasswordChangeSurface(origin, token, null, null, 'prepare')).toEqual({
      version: 1, ok: false, code: 'multiple-matches',
    })
  })

  it('refuses a fill without a matching prepare token', () => {
    prepareInputs(changeForm)
    expect(fillPasswordChangeSurface(
      origin, token, { username: 'casey', password: 'stored-password-1' }, 'generated-password-1234',
    )).toEqual({ version: 1, ok: false, code: 'stale-document' })

    expect(fillPasswordChangeSurface(origin, token, null, null, 'prepare')).toEqual({
      version: 1, ok: true, code: 'password-change-filled', currentFilled: 1, newFilled: 2,
    })
    expect(fillPasswordChangeSurface(
      origin, 'password-change-token-9999', { username: 'casey', password: 'stored-password-1' }, 'generated-password-1234',
    )).toEqual({ version: 1, ok: false, code: 'stale-document' })
  })

  it('refuses a mismatched origin', () => {
    prepareInputs(changeForm)
    expect(fillPasswordChangeSurface('https://other.example.test', token, null, null, 'prepare')).toEqual({
      version: 1, ok: false, code: 'origin-mismatch',
    })
  })

  it('refuses a fill after clear dropped the pending', () => {
    prepareInputs(changeForm)
    expect(fillPasswordChangeSurface(origin, token, null, null, 'prepare')).toEqual({
      version: 1, ok: true, code: 'password-change-filled', currentFilled: 1, newFilled: 2,
    })
    expect(fillPasswordChangeSurface(origin, token, null, null, 'clear')).toEqual({
      version: 1, ok: true, code: 'password-change-filled', currentFilled: 0, newFilled: 0,
    })
    expect(fillPasswordChangeSurface(
      origin, token, { username: 'casey', password: 'stored-password-1' }, 'generated-password-1234',
    )).toEqual({ version: 1, ok: false, code: 'stale-document' })
  })
})

describe('normalizePasswordChangeOutcome', () => {
  it('accepts known shapes and rejects unknown codes and out-of-range counts', () => {
    expect(normalizePasswordChangeOutcome({
      version: 1, ok: true, code: 'password-change-filled', currentFilled: 1, newFilled: 2,
    })).toEqual({ version: 1, ok: true, code: 'password-change-filled', currentFilled: 1, newFilled: 2 })
    expect(normalizePasswordChangeOutcome({ version: 1, ok: false, code: 'stale-document' }))
      .toEqual({ version: 1, ok: false, code: 'stale-document' })
    expect(normalizePasswordChangeOutcome({ version: 1, ok: false, code: 'mystery' })).toEqual(fallback)
    expect(normalizePasswordChangeOutcome({
      version: 1, ok: true, code: 'password-change-filled', currentFilled: 2, newFilled: 0,
    })).toEqual(fallback)
    expect(normalizePasswordChangeOutcome({
      version: 1, ok: true, code: 'password-change-filled', currentFilled: 0, newFilled: 3,
    })).toEqual(fallback)
    expect(normalizePasswordChangeOutcome({
      version: 1, ok: true, code: 'password-change-filled', currentFilled: 0, newFilled: 0,
    })).toEqual(fallback)
  })
})

describe('the password limit of the fields that take the new password', () => {
  it('reports the smallest limit of the new and confirmation fields and ignores the current field', () => {
    prepareInputs(`
      <form id="change">
        <input type="password" name="current_password" autocomplete="current-password" maxlength="8">
        <input type="password" name="new_password" autocomplete="new-password" maxlength="32">
        <input type="password" name="confirm_password" maxlength="18">
      </form>
    `)
    expect(fillPasswordChangeSurface(origin, token, null, null, 'prepare')).toEqual({
      version: 1, ok: true, code: 'password-change-filled', currentFilled: 1, newFilled: 2, maxLength: 18,
    })
  })

  it('reports no limit when no new field sets one', () => {
    prepareInputs(changeForm)
    expect(fillPasswordChangeSurface(origin, token, null, null, 'prepare')).not.toHaveProperty('maxLength')
  })

  it('refuses to write a new password longer than a field limit and clears the stored one', () => {
    const inputs = prepareInputs(`
      <form id="change">
        <input type="password" name="current_password" autocomplete="current-password">
        <input type="password" name="new_password" autocomplete="new-password">
        <input type="password" name="confirm_password">
      </form>
    `)
    expect(fillPasswordChangeSurface(origin, token, null, null, 'prepare').ok).toBe(true)
    inputs[2].maxLength = 16
    const credential = { username: 'casey', password: 'stored-password-1' }
    expect(fillPasswordChangeSurface(origin, token, credential, 'generated-password-1234')).toEqual({
      version: 1, ok: false, code: 'password-limit-too-short',
    })
    expect(inputs.map((input) => input.value)).toEqual(['', '', ''])
    expect(credential).toEqual({ username: '', password: '' })
  })

  it('reports the smallest limit of every sign-up password field', () => {
    prepareInputs(`
      <form id="register">
        <input type="password" name="new_password" autocomplete="new-password" maxlength="30">
        <input type="password" name="confirm_password" maxlength="20">
      </form>
    `)
    expect(fillGeneratedRegistration(origin, token, null, 'prepare')).toEqual({
      version: 1, ok: true, code: 'registration-filled', fieldsFilled: 1, maxLength: 20,
    })
  })

  it('refuses to write a sign-up password longer than a field limit', () => {
    const inputs = prepareInputs(`
      <form id="register">
        <input type="password" name="new_password" autocomplete="new-password">
        <input type="password" name="confirm_password">
      </form>
    `)
    expect(fillGeneratedRegistration(origin, token, null, 'prepare')).not.toHaveProperty('maxLength')
    inputs[1].maxLength = 16
    expect(fillGeneratedRegistration(origin, token, 'generated-password-1234')).toEqual({
      version: 1, ok: false, code: 'password-limit-too-short',
    })
    expect(inputs.map((input) => input.value)).toEqual(['', ''])
  })

  it('passes a sound limit through the normalizers and drops a planted one', () => {
    expect(normalizePasswordChangeOutcome({
      version: 1, ok: true, code: 'password-change-filled', currentFilled: 1, newFilled: 1, maxLength: 18,
    })).toEqual({ version: 1, ok: true, code: 'password-change-filled', currentFilled: 1, newFilled: 1, maxLength: 18 })
    expect(normalizePasswordChangeOutcome({
      version: 1, ok: true, code: 'password-change-filled', currentFilled: 1, newFilled: 1, maxLength: 0,
    })).toEqual(fallback)
    expect(normalizePasswordChangeOutcome({ version: 1, ok: false, code: 'password-limit-too-short' }))
      .toEqual({ version: 1, ok: false, code: 'password-limit-too-short' })
    expect(normalizeRegistrationOutcome({
      version: 1, ok: true, code: 'registration-filled', fieldsFilled: 1, maxLength: 20,
    })).toEqual({ version: 1, ok: true, code: 'registration-filled', fieldsFilled: 1, maxLength: 20 })
    expect(normalizeRegistrationOutcome({
      version: 1, ok: true, code: 'registration-filled', fieldsFilled: 1, maxLength: '20',
    })).toEqual({ version: 1, ok: false, code: 'registration-fill-failed' })
  })
})
