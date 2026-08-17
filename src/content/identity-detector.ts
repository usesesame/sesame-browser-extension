// Reports only origin and field kinds; never reads input values or page text.
import type { IdentityFieldKey } from '../protocol/native'

export interface IdentitySurface {
  ok: true
  origin: string
}

export type IdentityInspection =
  | { ok: true; surface: IdentitySurface; fields: IdentityFieldKey[] }
  | { ok: false; code: 'no-fields' }

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

export function inspectIdentitySurface(): IdentityInspection {
  const fields = new Set<IdentityFieldKey>()
  for (const input of Array.from(document.querySelectorAll<HTMLInputElement>('input')).filter(isVisible)) {
    for (const token of input.autocomplete.toLowerCase().split(/\s+/)) {
      const key = AUTOCOMPLETE_TO_FIELD[token]
      if (key) fields.add(key)
    }
  }
  if (fields.size === 0) return { ok: false, code: 'no-fields' }
  return { ok: true, surface: { ok: true, origin: window.location.origin }, fields: Array.from(fields) }
}

export function inspectIdentitySurfaceScoped(owner: Element): IdentityFieldKey[] {
  const fields = new Set<IdentityFieldKey>()
  for (const input of Array.from(document.querySelectorAll<HTMLInputElement>('input')).filter(isVisible)) {
    if ((input.form ?? input.parentElement ?? input) !== owner) continue
    for (const token of input.autocomplete.toLowerCase().split(/\s+/)) {
      const key = AUTOCOMPLETE_TO_FIELD[token]
      if (key) fields.add(key)
    }
  }
  return Array.from(fields)
}

function isVisible(input: HTMLInputElement): boolean {
  if (input.disabled || input.readOnly || input.type === 'hidden' || input.type === 'password') return false
  const style = getComputedStyle(input)
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
  const rect = input.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}
