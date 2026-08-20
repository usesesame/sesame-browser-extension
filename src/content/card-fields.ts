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

export function cardFieldsForInput(input: HTMLInputElement): CardFieldKey[] {
  const explicit = cardFieldsForAutocomplete(input.autocomplete)
  if (explicit.length > 0) return explicit
  const hint = inputHint(input)
  if (/\b(?:card|credit|debit|cc)[\s_-]*(?:number|no)\b|\bcardnumber\b/.test(hint)) return ['number']
  if (/\b(?:cvc|cvv)\b|\bsecurity[\s_-]*code\b|\bcard[\s_-]*code\b/.test(hint)) return ['securityCode']
  if (/\b(?:cardholder|card[\s_-]*holder|name[\s_-]*on[\s_-]*card)\b/.test(hint)) return ['cardholderName']
  if (/\b(?:expiry|expiration|exp)[\s_-]*month\b/.test(hint)) return ['expiryMonth']
  if (/\b(?:expiry|expiration|exp)[\s_-]*year\b/.test(hint)) return ['expiryYear']
  if (/\b(?:expiry|expiration|exp(?:iration)?[\s_-]*date|valid[\s_-]*thru)\b/.test(hint)) return ['expiryMonth', 'expiryYear']
  return []
}

export function hasCombinedExpiryAutocomplete(value: string): boolean {
  return tokens(value).includes('cc-exp')
}

export function hasCombinedExpiryField(input: HTMLInputElement): boolean {
  if (hasCombinedExpiryAutocomplete(input.autocomplete)) return true
  const hint = inputHint(input)
  return /\b(?:expiry|expiration|exp(?:iration)?[\s_-]*date|valid[\s_-]*thru)\b/.test(hint)
    && !/\b(?:month|year)\b/.test(hint)
}

function inputHint(input: HTMLInputElement): string {
  return [
    input.name,
    input.id,
    input.placeholder,
    input.getAttribute('aria-label'),
    input.getAttribute('title'),
    ...Array.from(input.labels ?? []).map((label) => label.textContent),
  ].join(' ').toLowerCase()
}
