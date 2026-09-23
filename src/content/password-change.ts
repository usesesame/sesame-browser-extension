import { isVisibleInput } from '../shared/dom'
import { isRecord } from '../shared/values'
import { setValue, type Credential } from './field-writer'
import { inspectPasswordSurface, isCurrentPasswordField, isRegistrationField, visiblePasswordFields } from './registration'

export type PasswordChangeOutcome =
  | { version: 1; ok: true; code: 'password-change-filled'; currentFilled: number; newFilled: number }
  | { version: 1; ok: false; code: string }

type PendingPasswordChange = { token: string; origin: string }
type IsolatedWorld = typeof globalThis & { __sesamePendingPasswordChangeV1?: PendingPasswordChange }

const PASSWORD_CHANGE_VERSION = 1
const PENDING_KEY = '__sesamePendingPasswordChangeV1'

// Writes stored and generated values only, never reads a field, never submits.
export function fillPasswordChangeSurface(
  expectedOrigin: string,
  documentToken: string,
  credential: Credential | null,
  newPassword: string | null,
  phase: 'prepare' | 'fill' | 'clear' = 'fill',
): PasswordChangeOutcome {
  if (typeof expectedOrigin !== 'string' || location.origin !== expectedOrigin) {
    return failure('origin-mismatch')
  }
  if (typeof documentToken !== 'string' || documentToken.length < 16 || documentToken.length > 128) {
    return failure('stale-document')
  }

  const isolated = globalThis as IsolatedWorld

  if (phase === 'clear') {
    const pending = isolated[PENDING_KEY]
    if (pending?.token === documentToken && pending.origin === expectedOrigin) {
      clearPending(isolated)
    }
    return success(0, 0)
  }

  if (phase === 'fill') {
    const pending = isolated[PENDING_KEY]
    clearPending(isolated)
    if (!pending || pending.token !== documentToken || pending.origin !== expectedOrigin) {
      return failure('stale-document')
    }
  }

  if (inspectPasswordSurface() !== 'password-change') {
    return failure('not-password-change-form')
  }

  const passwords = visiblePasswordFields().filter((field) => isVisibleInput(field))
  const current = passwords.filter(isCurrentPasswordField)
  const next = passwords.filter((field) => isRegistrationField(field) && !isCurrentPasswordField(field))
  if (passwords.some((field) => !isCurrentPasswordField(field) && !isRegistrationField(field))) {
    return failure('multiple-matches')
  }
  if (current.length !== 1 || next.length < 1 || next.length > 2) {
    return failure('multiple-matches')
  }
  const owners = new Set([...current, ...next].map((field) => field.form ?? field.parentElement ?? field))
  if (owners.size !== 1) {
    return failure('multiple-matches')
  }

  if (phase === 'prepare') {
    Object.defineProperty(isolated, PENDING_KEY, {
      configurable: true,
      value: { token: documentToken, origin: expectedOrigin },
      writable: true,
    })
    return success(current.length, next.length)
  }

  if (!credential || typeof credential.password !== 'string' || credential.password.length === 0) {
    return failure('fill-failed')
  }
  if (typeof newPassword !== 'string' || newPassword.length < 16 || newPassword.length > 128) {
    return failure('password-change-fill-failed')
  }

  const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (typeof nativeValueSetter !== 'function') {
    return failure('field-write-failed')
  }

  let currentFilled = 0
  let newFilled = 0
  try {
    if (!setValue(current[0], credential.password, nativeValueSetter)) {
      return failure('field-write-failed')
    }
    currentFilled = 1
    for (const field of next) {
      if (!setValue(field, newPassword, nativeValueSetter)) {
        return failure('field-write-failed')
      }
      newFilled += 1
    }
  } finally {
    credential.username = ''
    credential.password = ''
    clearPending(isolated)
  }
  return success(currentFilled, newFilled)
}

export function normalizePasswordChangeOutcome(value: unknown): PasswordChangeOutcome {
  if (!isRecord(value) || value.version !== PASSWORD_CHANGE_VERSION) {
    return failure('password-change-fill-failed')
  }
  if (
    value.ok === true
    && value.code === 'password-change-filled'
    && value.currentFilled === 1
    && Number.isInteger(value.newFilled)
    && (value.newFilled as number) >= 1
    && (value.newFilled as number) <= 2
  ) {
    return success(1, value.newFilled as number)
  }
  const safeCodes = new Set([
    'field-write-failed', 'multiple-matches', 'not-password-change-form', 'origin-mismatch',
    'password-change-fill-failed', 'stale-document', 'fill-failed', 'no-fields',
  ])
  if (value.ok === false && typeof value.code === 'string' && safeCodes.has(value.code)) {
    return failure(value.code)
  }
  return failure('password-change-fill-failed')
}

function clearPending(isolated: IsolatedWorld): void {
  try {
    delete isolated[PENDING_KEY]
  } catch {
    isolated[PENDING_KEY] = undefined
  }
}

function success(currentFilled: number, newFilled: number): PasswordChangeOutcome {
  return {
    version: PASSWORD_CHANGE_VERSION,
    ok: true,
    code: 'password-change-filled',
    currentFilled,
    newFilled,
  }
}

function failure(code: string): PasswordChangeOutcome {
  return { version: PASSWORD_CHANGE_VERSION, ok: false, code }
}
