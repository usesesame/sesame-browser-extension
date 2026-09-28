import type { IdentityFieldKey } from '../protocol/native'
import { tokens } from './field-writer'

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

const EMAIL = /\be ?mail\b/
const PHONE = /\b(?:phone|mobile|telephone|tel|cell)\b/
const POSTAL_CODE = /\b(?:zip|postal|post) ?code\b|\bzip\b|\bpostal\b/
const COUNTRY = /\bcountry\b/
const COUNTRY_CODE = /\bcountry ?code\b/
const REGION = /\b(?:state|province|region|county)\b/
const CITY = /\b(?:city|town|locality)\b/
const ADDRESS_LINE_2 = /\baddress ?(?:line ?)?2\b|\b(?:apt|apartment|suite|unit)\b/
const ADDRESS_LINE_1 = /\baddress ?(?:line ?)?1\b|\b(?:street|mailing|shipping|billing|home) ?address\b|\baddress\b/
const NOT_A_STREET_ADDRESS = /\b(?:wallet|contract|ip|mac|email|e mail|web|url|bitcoin|btc|eth|ethereum|crypto|token|public|server|network|domain|dns|socket|proxy|memory|remote|host|peer|node) ?(?:address|addr)\b/
const FULL_NAME = /\b(?:full|your|contact|customer|display|legal) ?name\b|\bname\b/
const NOT_A_PERSON_NAME = /\b(?:user|login|account|nick|screen|company|business|product|file|domain|host|brand|card|cardholder|first|last|middle|given|family|sur|event|team|group|project|task|device|server|page|site|section|category|field|label|list) ?name\b/
const IDENTITY_INPUT_TYPES = new Set(['text', 'email', 'tel', 'url', 'number'])

export function identityFieldForAutocomplete(value: string): IdentityFieldKey | undefined {
  for (const token of tokens(value)) {
    const key = AUTOCOMPLETE_TO_FIELD[token]
    if (key) return key
  }
  return undefined
}

export function identityFieldForInput(input: HTMLInputElement): IdentityFieldKey | undefined {
  if (!IDENTITY_INPUT_TYPES.has(input.type.toLowerCase())) return undefined
  const explicit = identityFieldForAutocomplete(input.autocomplete)
  if (explicit) return explicit
  const hint = inputHint(input).replace(/[\s_-]+/g, ' ')
  if (EMAIL.test(hint)) return 'email'
  if (PHONE.test(hint)) return 'phone'
  if (POSTAL_CODE.test(hint)) return 'postalCode'
  if (COUNTRY.test(hint) && !COUNTRY_CODE.test(hint)) return 'country'
  if (REGION.test(hint)) return 'region'
  if (CITY.test(hint)) return 'city'
  if (ADDRESS_LINE_2.test(hint)) return 'addressLine2'
  if (ADDRESS_LINE_1.test(hint) && !NOT_A_STREET_ADDRESS.test(hint)) return 'addressLine1'
  if (NOT_A_PERSON_NAME.test(hint)) return undefined
  return FULL_NAME.test(hint) ? 'fullName' : undefined
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
