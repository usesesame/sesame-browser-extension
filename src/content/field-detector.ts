// Reports only origin and bounded booleans; never reads input values or page text.
export interface LoginSurface {
  ok: true
  origin: string
}

export type LoginInspection =
  | { ok: true; surface: LoginSurface; hasUsernameField: boolean; hasPasswordField: boolean }
  | { ok: false; code: 'no-fields' }

export function inspectLoginSurface(): LoginInspection {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input'))
    .filter(isVisible)
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

export function isUsernameField(input: HTMLInputElement): boolean {
  const type = input.type.toLowerCase()
  const autocomplete = input.autocomplete.toLowerCase().split(/\s+/)
  const hints = `${input.name} ${input.id}`.toLowerCase()
  return autocomplete.includes('username')
    || autocomplete.includes('email')
    || type === 'email'
    || ((type === 'text' || type === 'tel') && /user|login|email|account|identifier/.test(hints))
}

export function isVisible(input: HTMLInputElement): boolean {
  if (input.disabled || input.readOnly || input.type === 'hidden') return false
  const style = getComputedStyle(input)
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
  const rect = input.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}
