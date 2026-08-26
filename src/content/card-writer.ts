import type { CardFieldKey, CardFields } from '../protocol/native'
import { setValue } from './field-writer'
import { cardFieldKeysForTargets, scanCardSurface } from './card-fields'

type PendingCardFill = { token: string; origin: string; fields: CardFieldKey[] }
type Phase = 'prepare' | 'fill' | 'clear'
const PENDING_KEY = '__sesamePendingCardFillV2'

export function fillCardSurface(origin: string, token: string, values: CardFields | null, phase: Phase = 'fill'): { ok: true; filledFields: CardFieldKey[] } | { ok: false; code: string } {
  if (location.protocol !== 'https:') return { ok: false, code: 'insecure-page' }
  if (location.origin !== origin || token.length < 16 || token.length > 128) return { ok: false, code: 'stale-document' }
  const isolated = globalThis as typeof globalThis & { [PENDING_KEY]?: PendingCardFill }
  if (phase === 'clear') { delete isolated[PENDING_KEY]; return { ok: true, filledFields: [] } }
  const targets = scanCardSurface()
  if (phase === 'prepare') {
    const requested = cardFieldKeysForTargets(targets)
    if (!requested.length) return { ok: false, code: 'no-fields' }
    isolated[PENDING_KEY] = { token, origin, fields: requested }
    return { ok: true, filledFields: requested }
  }
  const pending = isolated[PENDING_KEY]
  delete isolated[PENDING_KEY]
  if (!pending || pending.token !== token || pending.origin !== origin || !values) return { ok: false, code: 'stale-document' }
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (typeof setter !== 'function') return { ok: false, code: 'field-write-failed' }
  const filledFields: CardFieldKey[] = []
  try {
    for (const field of pending.fields) {
      const value = values[field]
      const target = targets.fields[field]
      if (value && target && setValue(target, value, setter)) filledFields.push(field)
    }
    const expiryMonth = values.expiryMonth
    const expiryYear = values.expiryYear
    if (targets.combinedExpiry && expiryMonth && expiryYear
      && setValue(targets.combinedExpiry, combinedExpiryValue(targets.combinedExpiry, expiryMonth, expiryYear), setter)) {
      if (!filledFields.includes('expiryMonth')) filledFields.push('expiryMonth')
      if (!filledFields.includes('expiryYear')) filledFields.push('expiryYear')
    }
  } finally {
    for (const field of Object.keys(values) as CardFieldKey[]) values[field] = ''
  }
  return filledFields.length ? { ok: true, filledFields } : { ok: false, code: 'field-write-failed' }
}

function combinedExpiryValue(input: HTMLInputElement, month: string, year: string): string {
  const normalizedMonth = month.replace(/\D/g, '').padStart(2, '0')
  const normalizedYear = year.replace(/\D/g, '')
  const displayYear = input.maxLength > 0 && input.maxLength <= 5
    ? normalizedYear.slice(-2)
    : normalizedYear
  return `${normalizedMonth}/${displayYear}`
}
