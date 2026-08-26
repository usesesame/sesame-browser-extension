// Binds prepare/fill to the same document; never submits.
import { isVisibleElement, isVisibleInput } from '../shared/dom'
export interface Credential {
  username: string
  password: string
}

export type FillOutcome =
  | { ok: true; usernameFilled: boolean; passwordFilled: boolean }
  | { ok: false; code: string }

type FillPhase = 'prepare' | 'fill' | 'clear'
type PendingFill = { token: string; origin: string; mode: 'username-only' | 'password' }
type IsolatedWorld = typeof globalThis & { __sesamePendingFillV1?: PendingFill }
type Candidate = { field: HTMLInputElement; explicit: boolean }
type PasswordGroup = { owner: HTMLFormElement | HTMLInputElement; fields: HTMLInputElement[] }

const PENDING_KEY = '__sesamePendingFillV1'

export function fillLoginSurface(
  expectedOrigin: string,
  documentToken: string,
  credential: Credential | null,
  phase: FillPhase = 'fill',
): FillOutcome {
  if (typeof expectedOrigin !== 'string' || location.origin !== expectedOrigin) {
    return failure('origin-mismatch')
  }
  if (typeof documentToken !== 'string' || documentToken.length < 16 || documentToken.length > 128) {
    return failure('stale-document')
  }

  const isolated = globalThis as IsolatedWorld
  let preparedMode: PendingFill['mode'] | undefined
  if (phase === 'clear') {
    const pending = isolated[PENDING_KEY]
    if (pending?.token === documentToken && pending.origin === expectedOrigin) {
      clearPending(isolated)
    }
    return success(false, false)
  }
  if (phase === 'fill') {
    const pending = isolated[PENDING_KEY]
    clearPending(isolated)
    if (!pending || pending.token !== documentToken || pending.origin !== expectedOrigin) {
      return failure('stale-document')
    }
    preparedMode = pending.mode
  }

  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input')).filter((input) => isVisibleInput(input))
  const passwordFields = inputs.filter((input) => input.type.toLowerCase() === 'password')
  if (passwordFields.length === 0) {
    return fillUsernameOnlySurface(inputs, expectedOrigin, documentToken, credential, phase, preparedMode, isolated)
  }
  if (preparedMode && preparedMode !== 'password') return failure('stale-document')

  if (passwordFields.some(isNewPasswordField)) {
    return failure('signup-or-password-change')
  }

  const groups: PasswordGroup[] = []
  for (const field of passwordFields) {
    const owner = field.form ?? field
    let group = groups.find((candidate) => candidate.owner === owner)
    if (!group) {
      group = { owner, fields: [] }
      groups.push(group)
    }
    group.fields.push(field)
  }

  const candidates: Candidate[] = []
  for (const group of groups) {
    if (group.fields.length > 1) return failure('signup-or-password-change')
    const currentPassword = group.fields.filter((field) => tokens(field.autocomplete).includes('current-password'))
    if (currentPassword.length === 1) {
      candidates.push({ field: currentPassword[0], explicit: true })
    } else if (currentPassword.length > 1) {
      return failure('multiple-matches')
    } else if (group.fields.length === 1) {
      candidates.push({ field: group.fields[0], explicit: false })
    }
  }

  if (candidates.length !== 1) return failure('multiple-matches')
  const selected = candidates[0]
  const passwordField = selected.field
  let surface: HTMLElement | null = passwordField.form
  let associatedInputs: HTMLInputElement[] | undefined

  if (passwordField.form) {
    associatedInputs = inputs.filter((field) => field.form === passwordField.form)
  } else {
    let container = passwordField.parentElement
    while (container && container !== document.body && container !== document.documentElement) {
      const contained = inputs.filter((field) => container!.contains(field))
      const containedPasswords = contained.filter((field) => field.type.toLowerCase() === 'password')
      if (containedPasswords.length === 1 && contained.some((field) => usernameScore(field, passwordField) >= 0)) {
        associatedInputs = contained
        surface = container
        break
      }
      container = container.parentElement
    }
    if (!associatedInputs) {
      const passwordIndex = inputs.indexOf(passwordField)
      const nearestBefore = inputs
        .map((field, index) => ({ field, index }))
        .filter(({ field, index }) => !field.form
          && index < passwordIndex
          && usernameScore(field, passwordField) >= 0)
        .at(-1)?.field
      associatedInputs = nearestBefore ? [nearestBefore, passwordField] : [passwordField]
      surface = passwordField.parentElement
    }
  }

  const passwordIndex = inputs.indexOf(passwordField)
  const usernameField = associatedInputs
    .map((field) => ({ field, index: inputs.indexOf(field), score: usernameScore(field, passwordField) }))
    .filter((candidate) => candidate.score >= 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      const leftBefore = left.index < passwordIndex
      const rightBefore = right.index < passwordIndex
      if (leftBefore !== rightBefore) return leftBefore ? -1 : 1
      return Math.abs(passwordIndex - left.index) - Math.abs(passwordIndex - right.index)
    })[0]?.field

  const relatedControls = surface && typeof surface.querySelectorAll === 'function'
    ? Array.from(surface.querySelectorAll<HTMLElement>('button, input[type="submit"], input[type="button"]'))
      .filter(isVisibleElement)
    : []
  const surfaceHint = [
    descriptor(surface),
    descriptor(passwordField),
    descriptor(usernameField),
    ...relatedControls.map((control) => descriptor(control, true)),
  ].join(' ')
  if (isUnsafeSurface(surfaceHint)) return failure('signup-or-password-change')
  if (!selected.explicit && !/log[\s_-]?in|sign[\s_-]?in|authenticate|authentication|session/.test(surfaceHint)) {
    return failure('signup-or-password-change')
  }

  if (phase === 'prepare') {
    Object.defineProperty(isolated, PENDING_KEY, {
      configurable: true,
      value: { token: documentToken, origin: expectedOrigin, mode: 'password' },
      writable: true,
    })
    return success(Boolean(usernameField), true)
  }

  if (!credential
    || typeof credential.username !== 'string'
    || typeof credential.password !== 'string'
    || credential.password.length === 0) {
    return failure('fill-failed')
  }

  const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (typeof nativeValueSetter !== 'function') return failure('field-write-failed')

  let usernameFilled = false
  let passwordFilled = false
  try {
    if (usernameField && credential.username) {
      usernameFilled = setValue(usernameField, credential.username, nativeValueSetter)
    }
    passwordFilled = setValue(passwordField, credential.password, nativeValueSetter)
  } finally {
    credential.username = ''
    credential.password = ''
    clearPending(isolated)
  }

  return passwordFilled
    ? success(usernameFilled, true)
    : failure('field-write-failed')
}

function fillUsernameOnlySurface(
  inputs: HTMLInputElement[],
  expectedOrigin: string,
  documentToken: string,
  credential: Credential | null,
  phase: FillPhase,
  preparedMode: PendingFill['mode'] | undefined,
  isolated: IsolatedWorld,
): FillOutcome {
  if (preparedMode && preparedMode !== 'username-only') return failure('stale-document')
  const candidates = inputs.filter(isUsernameOnlyCandidate)
  if (candidates.length === 0) return failure('no-fields')
  if (candidates.length !== 1) return failure('multiple-matches')
  const usernameField = candidates[0]
  const surface = usernameField.form ?? usernameField.parentElement
  const relatedControls = surface && typeof surface.querySelectorAll === 'function'
    ? Array.from(surface.querySelectorAll<HTMLElement>('button, input[type="submit"], input[type="button"]'))
      .filter(isVisibleElement)
    : []
  const surfaceHint = [
    descriptor(surface as HTMLElement | null),
    descriptor(usernameField),
    ...relatedControls.map((control) => descriptor(control, true)),
  ].join(' ')
  if (isUnsafeSurface(surfaceHint)) return failure('signup-or-password-change')
  const explicitUsername = tokens(usernameField.autocomplete).some((token) => token === 'username' || token === 'email')
    || usernameField.type.toLowerCase() === 'email'
  if (!explicitUsername || !/log[\s_-]?in|sign[\s_-]?in|authenticate|authentication|account|identifier|session|continue|next/.test(surfaceHint)) {
    return failure('signup-or-password-change')
  }

  if (phase === 'prepare') {
    Object.defineProperty(isolated, PENDING_KEY, {
      configurable: true,
      value: { token: documentToken, origin: expectedOrigin, mode: 'username-only' },
      writable: true,
    })
    return success(true, false)
  }
  if (!credential || typeof credential.username !== 'string' || credential.username.length === 0) {
    return failure('fill-failed')
  }
  const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (typeof nativeValueSetter !== 'function') return failure('field-write-failed')
  try {
    const usernameFilled = setValue(usernameField, credential.username, nativeValueSetter)
    return usernameFilled ? success(true, false) : failure('field-write-failed')
  } finally {
    credential.username = ''
    credential.password = ''
    clearPending(isolated)
  }
}

export function tokens(value: unknown): string[] {
  return String(value ?? '').toLowerCase().split(/\s+/).filter(Boolean)
}

function isNewPasswordField(field: HTMLInputElement): boolean {
  if (tokens(field.autocomplete).includes('new-password')) return true
  const hint = `${field.name} ${field.id} ${field.form?.name ?? ''} ${field.form?.id ?? ''}`.toLowerCase()
  return /new[-_ ]?pass|confirm|register|sign[-_ ]?up|create[-_ ]?pass/.test(hint)
}

function usernameScore(input: HTMLInputElement, passwordField: HTMLInputElement): number {
  const candidate = usernameCandidate(input)
  if (input === passwordField || !candidate) return -1
  const { type, autocomplete, hint } = candidate
  let score = type === 'email' ? 60 : 10
  if (autocomplete.includes('email')) score += 50
  if (autocomplete.includes('username')) score += 100
  if (/user|login|email|account|identifier/.test(hint)) score += 35
  return score
}

function isUsernameOnlyCandidate(input: HTMLInputElement): boolean {
  return usernameCandidate(input) !== undefined
}

function usernameCandidate(input: HTMLInputElement): { type: string; autocomplete: string[]; hint: string } | undefined {
  const type = input.type.toLowerCase()
  if (!['email', 'text', 'tel'].includes(type)) return undefined
  const autocomplete = tokens(input.autocomplete)
  if (autocomplete.some((token) => [
    'cc-number', 'current-password', 'new-password', 'one-time-code', 'organization', 'search',
  ].includes(token))) return undefined
  const hint = `${input.name} ${input.id}`.toLowerCase()
  if (!autocomplete.includes('username') && !autocomplete.includes('email') && type !== 'email'
    && !/user|login|email|account|identifier/.test(hint)) return undefined
  return { type, autocomplete, hint }
}

function descriptor(element: HTMLElement | null | undefined, includeControlLabel = false): string {
  if (!element) return ''
  const named = element as HTMLElement & { name?: string; action?: string }
  const attribute = (name: string) => typeof element.getAttribute === 'function'
    ? element.getAttribute(name)
    : ''
  return [
    named.name,
    element.id,
    named.action,
    element.className,
    attribute('aria-label'),
    attribute('title'),
    includeControlLabel ? element.textContent : '',
    includeControlLabel ? attribute('value') : '',
  ].map((value) => String(value ?? '')).join(' ').toLowerCase()
}

function isUnsafeSurface(value: string): boolean {
  return /sign[\s_-]?up|register|create[\s_-]?(?:account|password)|new[\s_-]?pass|confirm|reset|forgot|change[\s_-]?pass|set[\s_-]?pass/.test(value)
}

export function setValue(
  field: HTMLInputElement,
  value: string,
  nativeValueSetter: (this: HTMLInputElement, value: string) => void,
): boolean {
  try {
    try {
      field.focus({ preventScroll: true })
    } catch {
      field.focus()
    }
    nativeValueSetter.call(field, value)
    const inputEvent = typeof InputEvent === 'function'
      ? new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText' })
      : new Event('input', { bubbles: true, composed: true })
    field.dispatchEvent(inputEvent)
    field.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
    return true
  } catch {
    return false
  }
}

function clearPending(isolated: IsolatedWorld): void {
  try {
    delete isolated[PENDING_KEY]
  } catch {
    isolated[PENDING_KEY] = undefined
  }
}

function success(usernameFilled: boolean, passwordFilled: boolean): FillOutcome {
  return { ok: true, usernameFilled, passwordFilled }
}

function failure(code: string): FillOutcome {
  return { ok: false, code }
}
