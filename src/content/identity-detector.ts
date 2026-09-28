// Reports only origin and field kinds; never reads input values or page text.
import type { IdentityFieldKey } from '../protocol/native'
import { isVisibleInput } from '../shared/dom'
import { collectInputs } from './input-scan'
import { identityFieldForInput } from './identity-fields'

export interface IdentitySurface {
  ok: true
  origin: string
}

export type IdentityInspection =
  | { ok: true; surface: IdentitySurface; fields: IdentityFieldKey[] }
  | { ok: false; code: 'no-fields' }

export function inspectIdentitySurface(): IdentityInspection {
  const fields = new Set<IdentityFieldKey>()
  const scan = collectInputs(document)
  if (scan.truncated) return { ok: false, code: 'no-fields' }
  for (const input of scan.inputs.filter((input) => isVisibleInput(input, { excludePassword: true }))) {
    const key = identityFieldForInput(input)
    if (key) fields.add(key)
  }
  if (fields.size === 0) return { ok: false, code: 'no-fields' }
  return { ok: true, surface: { ok: true, origin: window.location.origin }, fields: Array.from(fields) }
}

export function inspectIdentitySurfaceScoped(owner: Element): IdentityFieldKey[] {
  const fields = new Set<IdentityFieldKey>()
  const scan = collectInputs(document)
  if (scan.truncated) return []
  for (const input of scan.inputs.filter((input) => isVisibleInput(input, { excludePassword: true }))) {
    if ((input.form ?? input.parentElement ?? input) !== owner) continue
    const key = identityFieldForInput(input)
    if (key) fields.add(key)
  }
  return Array.from(fields)
}
