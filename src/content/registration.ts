import { isUsernameField } from './field-detector'
import { isVisibleInput } from '../shared/dom'
import { isRecord } from '../shared/values'

const REGISTRATION_VERSION = 1

export type RegistrationOutcome =
  | { version: 1; ok: true; code: 'registration-filled'; fieldsFilled: number }
  | { version: 1; ok: false; code: string }

type RandomBytes = (buffer: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>
export type PasswordSurfaceKind = 'none' | 'login' | 'registration' | 'password-change' | 'ambiguous'

export function makeRegistrationPassword(
  length = 20,
  getRandomValues: RandomBytes = (buffer) => crypto.getRandomValues(buffer),
): string {
  if (!Number.isInteger(length) || length < 16 || length > 64) {
    throw new RangeError('registration password length must be between 16 and 64')
  }
  const groups = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    'abcdefghijkmnopqrstuvwxyz',
    '23456789',
    '!@#$%^&*()-_=+',
  ]
  const alphabet = groups.join('')
  const characters = groups.map((group) => group[secureRandomIndex(group.length, getRandomValues)])
  while (characters.length < length) {
    characters.push(alphabet[secureRandomIndex(alphabet.length, getRandomValues)])
  }
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = secureRandomIndex(index + 1, getRandomValues)
    ;[characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]]
  }
  return characters.join('')
}

export function inspectRegistrationSurface(): boolean {
  return inspectPasswordSurface() === 'registration'
}

export function inspectPasswordSurface(): PasswordSurfaceKind {
  const fields = visiblePasswordFields()
  if (fields.length === 0) return 'none'
  if (fields.length > 3) return 'ambiguous'
  const hasCurrent = fields.some(isCurrentPasswordField)
  const hasRegistration = fields.some(isRegistrationField)
  if (hasCurrent && hasRegistration) return 'password-change'
  if (hasCurrent && fields.length > 1) return 'ambiguous'
  if (hasRegistration || fields.length > 1) {
    const owners = new Set(fields.map((field) => field.form ?? field.parentElement ?? field))
    return owners.size === 1 ? 'registration' : 'ambiguous'
  }
  return 'login'
}

// Writes a newly generated value only, never reads a field, never submits.
export function fillRegistrationSurface(expectedOrigin: string, password: string): RegistrationOutcome {
  if (typeof expectedOrigin !== 'string' || location.origin !== expectedOrigin) {
    return failure('origin-mismatch')
  }
  if (typeof password !== 'string' || password.length < 16 || password.length > 128) {
    return failure('registration-fill-failed')
  }

  const passwordFields = visiblePasswordFields()
  if (passwordFields.length === 0) return failure('no-fields')
  if (passwordFields.length > 3) return failure('multiple-matches')
  if (passwordFields.some(isCurrentPasswordField)) return failure('password-change-form')
  if (!(passwordFields.length > 1 || passwordFields.some(isRegistrationField))) {
    return failure('not-registration-form')
  }

  const owners = new Set(passwordFields.map((field) => field.form ?? field.parentElement ?? field))
  if (owners.size > 1) return failure('multiple-matches')

  const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (typeof nativeValueSetter !== 'function') return failure('field-write-failed')

  let fieldsFilled = 0
  for (const field of passwordFields) {
    try {
      try {
        field.focus({ preventScroll: true })
      } catch {
        field.focus()
      }
      nativeValueSetter.call(field, password)
      const inputEvent = typeof InputEvent === 'function'
        ? new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText' })
        : new Event('input', { bubbles: true, composed: true })
      field.dispatchEvent(inputEvent)
      field.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
      fieldsFilled += 1
    } catch {
      return failure('field-write-failed')
    }
  }
  return { version: REGISTRATION_VERSION, ok: true, code: 'registration-filled', fieldsFilled }
}

export interface SignupCapture {
  origin: string
  username: string
  password: string
}

// The one read exception: on a genuine submit, only the registration form's own fields.
export function captureSignupSubmission(): SignupCapture | null {
  if (inspectPasswordSurface() !== 'registration') return null
  const passwordFields = visiblePasswordFields()
  if (passwordFields.length === 0) return null
  const password = passwordFields[0].value
  if (password.length === 0) return null

  const owner = passwordFields[0].form ?? passwordFields[0].parentElement ?? passwordFields[0]
  const usernameField = Array.from(document.querySelectorAll<HTMLInputElement>('input'))
    .filter((field) => field.type !== 'password' && isVisibleInput(field, { rejectAriaHiddenAncestor: true, minimumSize: 1 }) && isUsernameField(field))
    .find((field) => (field.form ?? field.parentElement ?? field) === owner)

  return { origin: location.origin, username: usernameField?.value ?? '', password }
}

export interface UpdateCapture {
  origin: string
  username: string
  password: string
}

// Same read-on-submit exception: reads only the new password field.
export function captureUpdateSubmission(): UpdateCapture | null {
  if (inspectPasswordSurface() !== 'password-change') return null
  const passwordFields = visiblePasswordFields()
  const newPasswordField = passwordFields.find(isRegistrationField)
  if (!newPasswordField) return null
  const password = newPasswordField.value
  if (password.length === 0) return null

  const owner = newPasswordField.form ?? newPasswordField.parentElement ?? newPasswordField
  const usernameField = Array.from(document.querySelectorAll<HTMLInputElement>('input'))
    .filter((field) => field.type !== 'password' && isVisibleInput(field, { rejectAriaHiddenAncestor: true, minimumSize: 1 }) && isUsernameField(field))
    .find((field) => (field.form ?? field.parentElement ?? field) === owner)

  return { origin: location.origin, username: usernameField?.value ?? '', password }
}

export function normalizeRegistrationOutcome(value: unknown): RegistrationOutcome {
  if (!isRecord(value) || value.version !== REGISTRATION_VERSION) {
    return failure('registration-fill-failed')
  }
  if (value.ok === true
    && value.code === 'registration-filled'
    && Number.isInteger(value.fieldsFilled)
    && (value.fieldsFilled as number) >= 1
    && (value.fieldsFilled as number) <= 3) {
    return {
      version: REGISTRATION_VERSION,
      ok: true,
      code: 'registration-filled',
      fieldsFilled: value.fieldsFilled as number,
    }
  }
  const safeCodes = new Set([
    'field-write-failed', 'multiple-matches', 'no-fields', 'not-registration-form',
    'origin-mismatch', 'password-change-form', 'registration-fill-failed',
  ])
  return failure(typeof value.code === 'string' && safeCodes.has(value.code)
    ? value.code
    : 'registration-fill-failed')
}

function visiblePasswordFields(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]'))
    .filter((field) => {
      if (field.disabled || field.readOnly) return false
      const style = getComputedStyle(field)
      const bounds = field.getBoundingClientRect()
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity) !== 0
        && bounds.width > 0
        && bounds.height > 0
    })
}

function isCurrentPasswordField(field: HTMLInputElement): boolean {
  const hints = `${field.name} ${field.id} ${field.autocomplete}`.toLowerCase()
  return tokens(field.autocomplete).includes('current-password') || /(?:current|old)[-_ ]?pass/.test(hints)
}

function isRegistrationField(field: HTMLInputElement): boolean {
  const hints = `${field.name} ${field.id} ${field.autocomplete} ${field.form?.name ?? ''} ${field.form?.id ?? ''}`.toLowerCase()
  return tokens(field.autocomplete).includes('new-password')
    || /new[-_ ]?pass|confirm|register|sign[-_ ]?up|create[-_ ]?(?:account|pass)/.test(hints)
}

function tokens(value: unknown): string[] {
  return String(value ?? '').toLowerCase().split(/\s+/).filter(Boolean)
}

function secureRandomIndex(maxExclusive: number, getRandomValues: RandomBytes): number {
  const limit = 256 - (256 % maxExclusive)
  const sample = new Uint8Array(1)
  do {
    getRandomValues(sample)
  } while (sample[0] >= limit)
  return sample[0] % maxExclusive
}

function failure(code: string): RegistrationOutcome {
  return { version: REGISTRATION_VERSION, ok: false, code }
}
