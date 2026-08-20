import type { CardFieldKey } from '../protocol/native'
import { tokens } from './field-writer'

const AUTOCOMPLETE_TO_FIELDS: Readonly<Record<string, readonly CardFieldKey[]>> = Object.freeze({
  'cc-name': ['cardholderName'],
  'cc-number': ['number'],
  'cc-exp-month': ['expiryMonth'],
  'cc-exp-year': ['expiryYear'],
  'cc-exp': ['expiryMonth', 'expiryYear'],
  'cc-csc': ['securityCode'],
})

export function cardFieldsForAutocomplete(value: string): CardFieldKey[] {
  return tokens(value).flatMap((token) => AUTOCOMPLETE_TO_FIELDS[token] ?? [])
}

export function hasCombinedExpiryAutocomplete(value: string): boolean {
  return tokens(value).includes('cc-exp')
}
