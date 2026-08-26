import type { CardFieldKey } from '../protocol/native'
import { cardFieldKeysForTargets, scanCardSurface } from './card-fields'

export interface CardInspection {
  ok: true
  origin: string
  fields: CardFieldKey[]
  embedded: boolean
}

export type CardInspectionResult = CardInspection | { ok: false; code: 'no-fields' | 'untrusted-frame' | 'insecure-page' }

export function inspectCardSurface(): CardInspectionResult {
  if (location.protocol !== 'https:') return { ok: false, code: 'insecure-page' }
  const fields = cardFieldKeysForTargets(scanCardSurface())
  return fields.length > 0
    ? { ok: true, origin: window.location.origin, fields, embedded: window.top !== window }
    : { ok: false, code: 'no-fields' }
}
