import { isUsernameField } from './field-detector'
import type { FillPhase } from './field-writer'
import { isVisibleInput } from '../shared/dom'
import { isRecord } from '../shared/values'
import { collectInputs, collectInputsOfType } from './input-scan'

const REGISTRATION_VERSION = 1

export type RegistrationOutcome =
  | { version: 1; ok: true; code: 'registration-filled'; fieldsFilled: number; maxLength?: number }
  | { version: 1; ok: false; code: string }

export type PasswordSurfaceKind = 'none' | 'login' | 'registration' | 'password-change' | 'ambiguous'

export function inspectRegistrationSurface(): boolean {
  return inspectPasswordSurface() === 'registration'
}

export function inspectPasswordSurface(): PasswordSurfaceKind {
  return classifyPasswordFields(visiblePasswordFields())
}

export function classifyPasswordFields(fields: HTMLInputElement[]): PasswordSurfaceKind {
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
  if (!fitsPasswordLimit(password, passwordFields)) return failure('password-limit-too-short')

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

type PendingRegistration = { token: string; origin: string }
type RegistrationWorld = typeof globalThis & { __sesamePendingRegistrationV1?: PendingRegistration }
const PENDING_REGISTRATION_KEY = '__sesamePendingRegistrationV1'

function clearPendingRegistration(world: RegistrationWorld): void {
  try {
    delete world[PENDING_REGISTRATION_KEY]
  } catch {
    world[PENDING_REGISTRATION_KEY] = undefined
  }
}

export function fillGeneratedRegistration(
  expectedOrigin: string,
  documentToken: string,
  password: string | null,
  phase: FillPhase = 'fill',
): RegistrationOutcome {
  if (typeof expectedOrigin !== 'string' || location.origin !== expectedOrigin) return failure('origin-mismatch')
  if (typeof documentToken !== 'string' || documentToken.length < 16 || documentToken.length > 128) {
    return failure('stale-document')
  }
  const world = globalThis as RegistrationWorld
  if (phase === 'clear') {
    const pending = world[PENDING_REGISTRATION_KEY]
    if (pending?.token === documentToken && pending.origin === expectedOrigin) clearPendingRegistration(world)
    return failure('registration-fill-failed')
  }
  if (phase === 'prepare') {
    if (inspectPasswordSurface() !== 'registration') return failure('not-registration-form')
    Object.defineProperty(world, PENDING_REGISTRATION_KEY, {
      configurable: true,
      value: { token: documentToken, origin: expectedOrigin },
      writable: true,
    })
    const maxLength = passwordLengthLimit(visiblePasswordFields())
    return maxLength === undefined
      ? { version: REGISTRATION_VERSION, ok: true, code: 'registration-filled', fieldsFilled: 1 }
      : { version: REGISTRATION_VERSION, ok: true, code: 'registration-filled', fieldsFilled: 1, maxLength }
  }
  const pending = world[PENDING_REGISTRATION_KEY]
  clearPendingRegistration(world)
  if (!pending || pending.token !== documentToken || pending.origin !== expectedOrigin) return failure('stale-document')
  return fillRegistrationSurface(expectedOrigin, password ?? '')
}

export function captureSignupUsername(): string {
  if (inspectPasswordSurface() !== 'registration') return ''
  const passwordFields = visiblePasswordFields()
  if (passwordFields.length === 0) return ''
  const owner = passwordFields[0].form ?? passwordFields[0].parentElement ?? passwordFields[0]
  const scan = collectInputs(document)
  if (scan.truncated) return ''
  const usernameField = scan.inputs
    .filter((field) => field.type !== 'password' && isVisibleInput(field, { rejectAriaHiddenAncestor: true, minimumSize: 1 }) && isUsernameField(field))
    .find((field) => (field.form ?? field.parentElement ?? field) === owner)
  return usernameField?.value ?? ''
}

export interface SignupCapture {
  origin: string
  username: string
  password: string
}

export function captureSignupSubmission(): SignupCapture | null {
  if (inspectPasswordSurface() !== 'registration') return null
  const passwordFields = visiblePasswordFields()
  if (passwordFields.length === 0) return null
  const password = passwordFields[0].value
  if (password.length === 0) return null

  const owner = passwordFields[0].form ?? passwordFields[0].parentElement ?? passwordFields[0]
  const scan = collectInputs(document)
  if (scan.truncated) return null
  const usernameField = scan.inputs
    .filter((field) => field.type !== 'password' && isVisibleInput(field, { rejectAriaHiddenAncestor: true, minimumSize: 1 }) && isUsernameField(field))
    .find((field) => (field.form ?? field.parentElement ?? field) === owner)

  return { origin: location.origin, username: usernameField?.value ?? '', password }
}

export interface UpdateCapture {
  origin: string
  username: string
  password: string
}

export function captureUpdateSubmission(): UpdateCapture | null {
  if (inspectPasswordSurface() !== 'password-change') return null
  const passwordFields = visiblePasswordFields()
  const newPasswordField = passwordFields.find(isRegistrationField)
  if (!newPasswordField) return null
  const password = newPasswordField.value
  if (password.length === 0) return null

  const owner = newPasswordField.form ?? newPasswordField.parentElement ?? newPasswordField
  const scan = collectInputs(document)
  if (scan.truncated) return null
  const usernameField = scan.inputs
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
    && (value.fieldsFilled as number) <= 3
    && (value.maxLength === undefined || isPasswordLengthLimit(value.maxLength))) {
    const outcome: RegistrationOutcome = {
      version: REGISTRATION_VERSION,
      ok: true,
      code: 'registration-filled',
      fieldsFilled: value.fieldsFilled as number,
    }
    if (value.maxLength !== undefined) outcome.maxLength = value.maxLength as number
    return outcome
  }
  const safeCodes = new Set([
    'field-write-failed', 'multiple-matches', 'no-fields', 'not-registration-form',
    'origin-mismatch', 'password-change-form', 'password-limit-too-short', 'registration-fill-failed', 'stale-document',
  ])
  return failure(typeof value.code === 'string' && safeCodes.has(value.code)
    ? value.code
    : 'registration-fill-failed')
}

export function visiblePasswordFields(): HTMLInputElement[] {
  const scan = collectInputsOfType(document, 'password')
  if (scan.truncated) return []
  return scan.inputs.filter((field) => {
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

export function isCurrentPasswordField(field: HTMLInputElement): boolean {
  const hints = `${field.name} ${field.id} ${field.autocomplete}`.toLowerCase()
  return tokens(field.autocomplete).includes('current-password') || /(?:current|old)[-_ ]?pass/.test(hints)
}

export function isRegistrationField(field: HTMLInputElement): boolean {
  const hints = `${field.name} ${field.id} ${field.autocomplete} ${field.form?.name ?? ''} ${field.form?.id ?? ''}`.toLowerCase()
  return tokens(field.autocomplete).includes('new-password')
    || /new[-_ ]?pass|confirm|register|sign[-_ ]?up|create[-_ ]?(?:account|pass)/.test(hints)
}

export function passwordLengthLimit(fields: readonly HTMLInputElement[]): number | undefined {
  const limits = fields.map((field) => field.maxLength).filter(isPasswordLengthLimit)
  return limits.length > 0 ? Math.min(...limits) : undefined
}

export function fitsPasswordLimit(password: string, fields: readonly HTMLInputElement[]): boolean {
  const limit = passwordLengthLimit(fields)
  return limit === undefined || password.length <= limit
}

export function isPasswordLengthLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 524_288
}

function tokens(value: unknown): string[] {
  return String(value ?? '').toLowerCase().split(/\s+/).filter(Boolean)
}

function failure(code: string): RegistrationOutcome {
  return { version: REGISTRATION_VERSION, ok: false, code }
}
