import type { CardFieldKey } from '../protocol/native'
import { tokens } from './field-writer'
import { isVisibleInput } from '../shared/dom'
import { declaresOneTimeCode, looksLikeOneTimeCode } from './code-hints'
import { collectInputs, labelsForInput } from './input-scan'

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

const CARD_NUMBER_HINT = /\b(?:card|credit|debit|cc)[\s_-]*(?:number|no)\b|\bcardnumber\b/
const NOT_A_PAYMENT_CARD = /\b(?:gift|promo|promotion|coupon|voucher|discount|loyalty|reward)/
const CARD_SECURITY_CODE = /\b(?:cvc|cvv|csc)\b|\bcard[\s_-]*(?:security|verification)[\s_-]*(?:code|number)\b|\bcard[\s_-]*code\b/
const SECURITY_CODE = /\bsecurity[\s_-]*code\b/
const SHORT_SECURITY_CODE_LENGTH = 3

export function cardFieldsForInput(input: HTMLInputElement): CardFieldKey[] {
  const explicit = cardFieldsForAutocomplete(input.autocomplete)
  if (explicit.length > 0) return explicit
  if (declaresOneTimeCode(input.autocomplete)) return []
  const hint = inputHint(input)
  if (NOT_A_PAYMENT_CARD.test(hint)) return []
  if (CARD_NUMBER_HINT.test(hint)) return ['number']
  if (CARD_SECURITY_CODE.test(hint)) return ['securityCode']
  if (SECURITY_CODE.test(hint) && !looksLikeOneTimeCode(hint) && hasCardAround(input)) return ['securityCode']
  if (/\b(?:cardholder|card[\s_-]*holder|name[\s_-]*on[\s_-]*card)\b/.test(hint)) return ['cardholderName']
  if (/\b(?:expiry|expiration|exp)[\s_-]*month\b/.test(hint)) return ['expiryMonth']
  if (/\b(?:expiry|expiration|exp)[\s_-]*year\b/.test(hint)) return ['expiryYear']
  if (/\b(?:expiry|expiration|exp(?:iration)?[\s_-]*date|valid[\s_-]*thru)\b/.test(hint)) return ['expiryMonth', 'expiryYear']
  return []
}

function hasCardAround(input: HTMLInputElement): boolean {
  if (input.maxLength === SHORT_SECURITY_CODE_LENGTH) return true
  const scope: ParentNode = input.form ?? (input.getRootNode() as ParentNode)
  if (typeof scope.querySelectorAll !== 'function') return false
  return Array.from(scope.querySelectorAll('input')).some((other) => other !== input
    && (cardFieldsForAutocomplete(other.autocomplete).includes('number') || CARD_NUMBER_HINT.test(inputHint(other))))
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

export interface CardSurfaceTargets {
  fields: Partial<Record<CardFieldKey, HTMLInputElement>>
  combinedExpiry?: HTMLInputElement
}

// The one scan of the page's card inputs: inspection (is this form fillable)
// and the write (which input gets which value) both derive from this result,
// so they cannot disagree about what the page contains.
export function scanCardSurface(): CardSurfaceTargets {
  const targets: CardSurfaceTargets = { fields: {} }
  const scan = collectInputs(document)
  if (scan.truncated) return targets
  for (const input of scan.inputs.filter((input) => isVisibleInput(input))) {
    if (hasCombinedExpiryField(input) && !targets.combinedExpiry) {
      targets.combinedExpiry = input
    }
    for (const field of cardFieldsForInput(input)) {
      if (!hasCombinedExpiryField(input) && !targets.fields[field]) targets.fields[field] = input
    }
  }
  return targets
}

export function cardFieldKeysForTargets(targets: CardSurfaceTargets): CardFieldKey[] {
  const keys = Object.keys(targets.fields) as CardFieldKey[]
  if (targets.combinedExpiry) {
    if (!keys.includes('expiryMonth')) keys.push('expiryMonth')
    if (!keys.includes('expiryYear')) keys.push('expiryYear')
  }
  return keys
}

function inputHint(input: HTMLInputElement): string {
  return [
    input.name,
    input.id,
    input.placeholder,
    input.getAttribute('aria-label'),
    input.getAttribute('title'),
    ...labelsForInput(input).map((label) => label.textContent),
  ].join(' ').toLowerCase()
}
