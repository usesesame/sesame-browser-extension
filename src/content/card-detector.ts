import type { CardFieldKey } from '../protocol/native'
import { cardFieldsForInput } from './card-fields'

export interface CardInspection {
  ok: true
  origin: string
  fields: CardFieldKey[]
  embedded: boolean
}

export type CardInspectionResult = CardInspection | { ok: false; code: 'no-fields' | 'untrusted-frame' | 'insecure-page' }

export function inspectCardSurface(): CardInspectionResult {
  if (location.protocol !== 'https:') return { ok: false, code: 'insecure-page' }
  const fields = new Set<CardFieldKey>()
  for (const input of Array.from(document.querySelectorAll<HTMLInputElement>('input')).filter(isVisible)) {
    for (const field of cardFieldsForInput(input)) fields.add(field)
  }
  return fields.size > 0
    ? { ok: true, origin: window.location.origin, fields: Array.from(fields), embedded: window.top !== window }
    : { ok: false, code: 'no-fields' }
}

function isVisible(input: HTMLInputElement): boolean {
  if (input.disabled || input.readOnly || input.type === 'hidden') return false
  const style = getComputedStyle(input)
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
  const rect = input.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}
