// Reports only origin and field kinds; never reads input values or page text.
import type { IdentityFieldKey } from '../protocol/native'
import { identityFieldKeysForTargets, identityTargetsInSurface } from './identity-fields'

export interface IdentitySurface {
  ok: true
  origin: string
}

export type IdentityInspection =
  | { ok: true; surface: IdentitySurface; fields: IdentityFieldKey[] }
  | { ok: false; code: 'no-fields' }

export function inspectIdentitySurface(): IdentityInspection {
  const scan = identityTargetsInSurface()
  if (scan.truncated) return { ok: false, code: 'no-fields' }
  const fields = identityFieldKeysForTargets(scan.targets)
  if (fields.length === 0) return { ok: false, code: 'no-fields' }
  return { ok: true, surface: { ok: true, origin: window.location.origin }, fields }
}

export function identityFieldsForAnchor(anchor: HTMLInputElement): IdentityFieldKey[] {
  return identityFieldKeysForTargets(identityTargetsInSurface(anchor).targets)
}
