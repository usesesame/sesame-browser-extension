import { IDENTITY_FIELD_KEYS, type IdentityFieldKey, type IdentityFields } from './native'

export interface LoginSurface {
  ok: true
  origin: string
  usernameField?: FieldRef
  passwordField?: FieldRef
  form?: FormRef
}

export interface FieldRef {
  tag: string
  type: string
  id?: string
  name?: string
  autocomplete?: string
  placeholder?: string
  label?: string
  index: number
}

export interface FormRef {
  id?: string
  action?: string
  method?: string
  index: number
}

export type PageInspection =
  | { ok: true; surface: LoginSurface; hasPasswordField: boolean; hasUsernameField: boolean }
  | { ok: false; code: string }

export type FillOutcome =
  | { ok: true; usernameFilled: boolean; passwordFilled: boolean }
  | { ok: false; code: string }

export type FillCommand =
  | { phase: 'prepare'; origin: string; documentToken: string }
  | { phase: 'fill'; origin: string; documentToken: string; credential?: Credential }
  | { phase: 'clear'; origin: string; documentToken: string }

export interface Credential {
  username: string
  password: string
}

export function normalizeInspection(raw: unknown): PageInspection | { ok: false; code: string } {
  if (!isRecord(raw)) {
    return { ok: false, code: 'invalid-inspection' }
  }
  if (raw.ok !== true) {
    return raw.ok === false && raw.code === 'no-fields' && hasExactKeys(raw, new Set(['ok', 'code']))
      ? { ok: false, code: 'no-fields' }
      : { ok: false, code: 'invalid-inspection' }
  }
  if (!hasExactKeys(raw, new Set(['ok', 'surface', 'hasPasswordField', 'hasUsernameField']))) {
    return { ok: false, code: 'invalid-inspection' }
  }
  const surface = raw.surface
  if (!isRecord(surface)
    || !hasExactKeys(surface, new Set(['ok', 'origin']))
    || surface.ok !== true
    || typeof surface.origin !== 'string'
    || !isSafeWebOrigin(surface.origin)) {
    return { ok: false, code: 'invalid-inspection' }
  }
  if (typeof raw.hasPasswordField !== 'boolean' || typeof raw.hasUsernameField !== 'boolean') {
    return { ok: false, code: 'invalid-inspection' }
  }
  return {
    ok: true,
    surface: { ok: true, origin: surface.origin },
    hasPasswordField: raw.hasPasswordField,
    hasUsernameField: raw.hasUsernameField,
  }
}

export function normalizeFillOutcome(raw: unknown): FillOutcome | { ok: false; code: string } {
  if (!isRecord(raw)) {
    return { ok: false, code: 'invalid-outcome' }
  }
  if (raw.ok !== true) {
    const allowedFailures = new Set([
      'field-write-failed', 'fill-failed', 'multiple-matches', 'no-fields',
      'origin-mismatch', 'signup-or-password-change', 'stale-document',
    ])
    return raw.ok === false
      && typeof raw.code === 'string'
      && allowedFailures.has(raw.code)
      && hasExactKeys(raw, new Set(['ok', 'code']))
      ? { ok: false, code: raw.code }
      : { ok: false, code: 'invalid-outcome' }
  }
  if (!hasExactKeys(raw, new Set(['ok', 'usernameFilled', 'passwordFilled']))
    || typeof raw.usernameFilled !== 'boolean'
    || typeof raw.passwordFilled !== 'boolean') {
    return { ok: false, code: 'invalid-outcome' }
  }
  return {
    ok: true,
    usernameFilled: raw.usernameFilled,
    passwordFilled: raw.passwordFilled,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  const keys = Object.keys(value)
  return keys.length === allowed.size && keys.every((key) => allowed.has(key))
}

function isSafeWebOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return url.origin === value
      && (url.protocol === 'https:'
        || (url.protocol === 'http:'
          && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')))
  } catch {
    return false
  }
}

export function redactCredential<T extends { credential?: Credential }>(value: T): T {
  if (value.credential) {
    value.credential.username = ''
    value.credential.password = ''
  }
  return value
}

export interface IdentitySurface {
  ok: true
  origin: string
}

export type IdentityPageInspection =
  | { ok: true; surface: IdentitySurface; fields: IdentityFieldKey[] }
  | { ok: false; code: string }

export type IdentityFillOutcome =
  | { ok: true; filledFields: IdentityFieldKey[] }
  | { ok: false; code: string }

export function normalizeIdentityInspection(raw: unknown): IdentityPageInspection {
  if (!isRecord(raw)) return { ok: false, code: 'invalid-inspection' }
  if (raw.ok !== true) {
    return raw.ok === false && raw.code === 'no-fields' && hasExactKeys(raw, new Set(['ok', 'code']))
      ? { ok: false, code: 'no-fields' }
      : { ok: false, code: 'invalid-inspection' }
  }
  if (!hasExactKeys(raw, new Set(['ok', 'surface', 'fields']))) {
    return { ok: false, code: 'invalid-inspection' }
  }
  const surface = raw.surface
  if (!isRecord(surface)
    || !hasExactKeys(surface, new Set(['ok', 'origin']))
    || surface.ok !== true
    || typeof surface.origin !== 'string'
    || !isSafeWebOrigin(surface.origin)) {
    return { ok: false, code: 'invalid-inspection' }
  }
  if (!Array.isArray(raw.fields)
    || raw.fields.length === 0
    || raw.fields.some((field) => typeof field !== 'string' || !IDENTITY_FIELD_KEYS.includes(field as IdentityFieldKey))) {
    return { ok: false, code: 'invalid-inspection' }
  }
  return {
    ok: true,
    surface: { ok: true, origin: surface.origin },
    fields: Array.from(new Set(raw.fields as IdentityFieldKey[])),
  }
}

export function normalizeIdentityFillOutcome(raw: unknown): IdentityFillOutcome {
  if (!isRecord(raw)) return { ok: false, code: 'invalid-outcome' }
  if (raw.ok !== true) {
    const allowedFailures = new Set([
      'field-write-failed', 'fill-failed', 'no-fields', 'origin-mismatch', 'stale-document',
    ])
    return raw.ok === false
      && typeof raw.code === 'string'
      && allowedFailures.has(raw.code)
      && hasExactKeys(raw, new Set(['ok', 'code']))
      ? { ok: false, code: raw.code }
      : { ok: false, code: 'invalid-outcome' }
  }
  if (!hasExactKeys(raw, new Set(['ok', 'filledFields']))
    || !Array.isArray(raw.filledFields)
    || raw.filledFields.some((field) => typeof field !== 'string' || !IDENTITY_FIELD_KEYS.includes(field as IdentityFieldKey))) {
    return { ok: false, code: 'invalid-outcome' }
  }
  return { ok: true, filledFields: raw.filledFields as IdentityFieldKey[] }
}

export function redactIdentity<T extends { identity?: IdentityFields }>(value: T): T {
  if (value.identity) {
    for (const key of Object.keys(value.identity) as IdentityFieldKey[]) value.identity[key] = ''
  }
  return value
}
