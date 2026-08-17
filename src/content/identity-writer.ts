// Gated by the prepare/fill/clear token binding; the form is never submitted.
import type { IdentityFieldKey, IdentityFields } from '../protocol/native'
import { isVisible, setValue, tokens } from './field-writer'

export type IdentityFillOutcome =
  | { ok: true; filledFields: IdentityFieldKey[] }
  | { ok: false; code: string }

type FillPhase = 'prepare' | 'fill' | 'clear'
type PendingIdentityFill = { token: string; origin: string; fields: IdentityFieldKey[] }
type IsolatedWorld = typeof globalThis & { __sesamePendingIdentityFillV1?: PendingIdentityFill }

const PENDING_KEY = '__sesamePendingIdentityFillV1'

const AUTOCOMPLETE_TO_FIELD: Readonly<Record<string, IdentityFieldKey>> = Object.freeze({
  name: 'fullName',
  email: 'email',
  tel: 'phone',
  'address-line1': 'addressLine1',
  'address-line2': 'addressLine2',
  'address-level2': 'city',
  'address-level1': 'region',
  'postal-code': 'postalCode',
  country: 'country',
  'country-name': 'country',
})

export function fillIdentitySurface(
  expectedOrigin: string,
  documentToken: string,
  values: IdentityFields | null,
  phase: FillPhase = 'fill',
): IdentityFillOutcome {
  if (typeof expectedOrigin !== 'string' || location.origin !== expectedOrigin) {
    return failure('origin-mismatch')
  }
  if (typeof documentToken !== 'string' || documentToken.length < 16 || documentToken.length > 128) {
    return failure('stale-document')
  }

  const isolated = globalThis as IsolatedWorld
  if (phase === 'clear') {
    const pending = isolated[PENDING_KEY]
    if (pending?.token === documentToken && pending.origin === expectedOrigin) clearPending(isolated)
    return success([])
  }

  const fieldMap = detectIdentityFields()

  if (phase === 'prepare') {
    const fields = Object.keys(fieldMap) as IdentityFieldKey[]
    if (fields.length === 0) return failure('no-fields')
    Object.defineProperty(isolated, PENDING_KEY, {
      configurable: true,
      writable: true,
      value: { token: documentToken, origin: expectedOrigin, fields },
    })
    return success(fields)
  }

  const pending = isolated[PENDING_KEY]
  clearPending(isolated)
  if (!pending || pending.token !== documentToken || pending.origin !== expectedOrigin) {
    return failure('stale-document')
  }
  if (!values) return failure('fill-failed')

  const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (typeof nativeValueSetter !== 'function') return failure('field-write-failed')

  const filledFields: IdentityFieldKey[] = []
  try {
    for (const key of pending.fields) {
      const value = values[key]
      const field = fieldMap[key]
      if (!value || !field) continue
      if (setValue(field, value, nativeValueSetter)) filledFields.push(key)
    }
  } finally {
    for (const key of Object.keys(values) as IdentityFieldKey[]) values[key] = ''
    clearPending(isolated)
  }
  return filledFields.length > 0 ? success(filledFields) : failure('field-write-failed')
}

function detectIdentityFields(): Partial<Record<IdentityFieldKey, HTMLInputElement>> {
  const fieldMap: Partial<Record<IdentityFieldKey, HTMLInputElement>> = {}
  for (const input of Array.from(document.querySelectorAll<HTMLInputElement>('input')).filter(isVisible)) {
    if (input.type.toLowerCase() === 'password') continue
    for (const token of tokens(input.autocomplete)) {
      const key = AUTOCOMPLETE_TO_FIELD[token]
      if (key && !fieldMap[key]) fieldMap[key] = input
    }
  }
  return fieldMap
}

function clearPending(isolated: IsolatedWorld): void {
  try {
    delete isolated[PENDING_KEY]
  } catch {
    isolated[PENDING_KEY] = undefined
  }
}

function success(filledFields: IdentityFieldKey[]): IdentityFillOutcome {
  return { ok: true, filledFields }
}

function failure(code: string): IdentityFillOutcome {
  return { ok: false, code }
}
