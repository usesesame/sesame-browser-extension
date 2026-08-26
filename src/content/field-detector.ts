// Reports only origin and bounded booleans; never reads input values or page text.
import { isVisibleInput } from '../shared/dom'
export interface LoginSurface {
  ok: true
  origin: string
}

export type LoginInspection =
  | { ok: true; surface: LoginSurface; hasUsernameField: boolean; hasPasswordField: boolean }
  | { ok: false; code: 'no-fields' }

export function inspectLoginSurface(): LoginInspection {
  // A sign-up honeypot is a real input no person can see, and filling it is what the page is watching for.
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input'))
    .filter((input) => isVisibleInput(input, { rejectAriaHiddenAncestor: true, minimumSize: 1 }))
  const passwordFields = inputs.filter((input) => input.type.toLowerCase() === 'password')
  const usernameFields = inputs.filter(isUsernameField)

  if (passwordFields.length === 0 && usernameFields.length === 0) {
    return { ok: false, code: 'no-fields' }
  }

  return {
    ok: true,
    surface: { ok: true, origin: window.location.origin },
    hasUsernameField: usernameFields.length > 0,
    hasPasswordField: passwordFields.length > 0,
  }
}

const USERNAME_HINT = /user|login|signin|sign-in|email|e-mail|account|identifier|handle/
const NOT_USERNAME_HINT = /search|query|filter|find|coupon|promo|voucher|captcha|one-?time|verification|security-?code|otp/

function labelText(input: HTMLInputElement): string {
  const parts: string[] = []
  if (input.id) {
    for (const label of document.querySelectorAll(`label[for="${CSS.escape(input.id)}"]`)) {
      parts.push(label.textContent ?? '')
    }
  }
  const wrapping = input.closest('label')
  if (wrapping) parts.push(wrapping.textContent ?? '')
  return parts.join(' ')
}

export function isUsernameField(input: HTMLInputElement): boolean {
  const type = input.type.toLowerCase()
  const autocomplete = input.autocomplete.toLowerCase().split(/\s+/)
  if (autocomplete.includes('one-time-code') || type === 'search') return false

  const hints = [
    input.name,
    input.id,
    input.placeholder,
    input.getAttribute('aria-label') ?? '',
    labelText(input),
  ].join(' ').toLowerCase()

  if (NOT_USERNAME_HINT.test(hints)) return false
  if (autocomplete.includes('username') || autocomplete.includes('email')) return true
  if (type === 'email') return true
  return (type === 'text' || type === 'tel') && USERNAME_HINT.test(hints)
}

