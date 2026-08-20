// Wire protocol shared with the desktop host: byte-for-byte compatible, response schemas closed.
export const NATIVE_HOST = 'app.usesesame.browser'
export const PROTOCOL_VERSION = 1
export const CARD_PROTOCOL_VERSION = 2
export const NATIVE_FILL_TIMEOUT_MS = 30_000
export const NATIVE_PROBE_TIMEOUT_MS = 5_000
export const MAX_CREDENTIAL_FIELD = 4096
export type FillFields = 'username' | 'password' | 'both'

// Must stay byte-for-byte the same set as the desktop's IDENTITY_FIELD_KEYS.
export const IDENTITY_FIELD_KEYS = [
  'fullName', 'email', 'phone', 'addressLine1', 'addressLine2', 'city', 'region', 'postalCode', 'country',
] as const
export type IdentityFieldKey = (typeof IDENTITY_FIELD_KEYS)[number]

export const CARD_FIELD_KEYS = ['cardholderName', 'number', 'expiryMonth', 'expiryYear', 'securityCode'] as const
export type CardFieldKey = (typeof CARD_FIELD_KEYS)[number]
export type CardFields = Partial<Record<CardFieldKey, string>>

export function redactCard(fields: CardFields): void {
  for (const field of CARD_FIELD_KEYS) {
    if (fields[field] !== undefined) fields[field] = ''
  }
}

export type NativeRequest =
  | { version: number; type: 'capabilities'; requestId: string }
  | { version: number; type: 'activate'; requestId: string }
  | { version: number; type: 'fill'; requestId: string; origin: string; fields?: FillFields }
  | { version: number; type: 'identity'; requestId: string; origin: string; fields: string }
  | { version: 2; type: 'card'; requestId: string; origin: string; fields: string }
  | { version: number; type: 'save'; requestId: string; origin: string; kind: 'new' | 'update'; title?: string; username?: string; password: string }

export type NativeResult =
  | { ok: true; protocolVersion: number; capabilities: DesktopCapabilities }
  | { ok: true; opened: true }
  | { ok: true; credential: Credential }
  | { ok: true; identity: IdentityFields }
  | { ok: true; card: CardFields }
  | { ok: true; saved: true }
  | { ok: false; code: string }

export interface DesktopCapabilities {
  desktopAvailable: boolean
  locked: boolean
  fillAvailable: boolean
}

export interface Credential {
  username: string
  password: string
}

export type IdentityFields = Partial<Record<IdentityFieldKey, string>>

const CAPABILITY_KEYS = new Set([
  'version', 'type', 'requestId', 'installed', 'desktopAvailable', 'locked', 'fillAvailable',
])
const ACTIVATION_KEYS = new Set(['version', 'type', 'requestId', 'opened'])
const FILL_BOTH_KEYS = new Set(['version', 'type', 'requestId', 'username', 'password'])
const FILL_USERNAME_KEYS = new Set(['version', 'type', 'requestId', 'username'])
const FILL_PASSWORD_KEYS = new Set(['version', 'type', 'requestId', 'password'])
const UNAVAILABLE_KEYS = new Set(['version', 'type', 'requestId', 'reason'])
const SAVED_KEYS = new Set(['version', 'type', 'requestId', 'saved'])
const ERROR_KEYS = new Set(['version', 'type', 'requestId', 'message'])
const BASE_REQUEST_KEYS = new Set(['version', 'type', 'requestId'])
const FILL_REQUEST_KEYS = new Set(['version', 'type', 'requestId', 'origin'])
const FILL_FIELDS_REQUEST_KEYS = new Set(['version', 'type', 'requestId', 'origin', 'fields'])
const IDENTITY_REQUEST_KEYS = new Set(['version', 'type', 'requestId', 'origin', 'fields'])
const CARD_KEYS = new Set(['version', 'type', 'requestId', 'card'])
const SAVE_REQUEST_KEYS = new Set(['version', 'type', 'requestId', 'origin', 'kind', 'password'])
const UNAVAILABLE_CODES: Readonly<Record<string, string>> = Object.freeze({
  desktopUnavailable: 'desktop-unavailable',
  locked: 'vault-locked',
  noMatch: 'no-match',
  approvalUnavailable: 'approval-unavailable',
  approvalDeclined: 'approval-declined',
  approvalTimeout: 'approval-timeout',
  staleRequest: 'stale-request',
  invalidSelection: 'invalid-selection',
  multipleMatches: 'multiple-matches',
})
const ERROR_MESSAGES = new Set([
  'Unsupported protocol version.',
  'Invalid browser request.',
  'Unsupported browser request.',
  'Browser response unavailable.',
])

export function isCredential(value: unknown): value is Credential {
  if (!isRecord(value) || !hasExactKeys(value, new Set(['username', 'password']))) return false
  return typeof value.username === 'string'
    && typeof value.password === 'string'
    && value.username.length <= MAX_CREDENTIAL_FIELD
    && value.password.length > 0
    && value.password.length <= MAX_CREDENTIAL_FIELD
}

export function isCapabilities(value: unknown): value is DesktopCapabilities {
  if (!isRecord(value) || !hasExactKeys(value, new Set(['desktopAvailable', 'locked', 'fillAvailable']))) {
    return false
  }
  return typeof value.desktopAvailable === 'boolean'
    && typeof value.locked === 'boolean'
    && typeof value.fillAvailable === 'boolean'
    && value.fillAvailable === !value.locked
    && (value.desktopAvailable || value.locked)
}

export function isNativeRequest(value: unknown): value is NativeRequest {
  if (!isRecord(value) || (value.version !== PROTOCOL_VERSION && value.version !== CARD_PROTOCOL_VERSION) || !isRequestId(value.requestId)) {
    return false
  }
  if ((value.version === PROTOCOL_VERSION && value.type === 'card')
    || (value.version === CARD_PROTOCOL_VERSION && value.type !== 'card')) {
    return false
  }
  if (value.type === 'capabilities' || value.type === 'activate') {
    return hasExactKeys(value, BASE_REQUEST_KEYS)
  }
  if (value.type === 'fill') {
    const fieldsValid = value.fields === undefined
      || value.fields === 'username'
      || value.fields === 'password'
      || value.fields === 'both'
    return fieldsValid
      && isWireOrigin(value.origin)
      && hasExactKeys(value, value.fields === undefined ? FILL_REQUEST_KEYS : FILL_FIELDS_REQUEST_KEYS)
  }
  if (value.type === 'identity') {
    if (!hasExactKeys(value, IDENTITY_REQUEST_KEYS) || !isWireOrigin(value.origin) || typeof value.fields !== 'string') {
      return false
    }
    const fields = value.fields.split(',')
    return fields.length > 0
      && new Set(fields).size === fields.length
      && fields.every((field) => IDENTITY_FIELD_KEYS.includes(field as IdentityFieldKey))
  }
  if (value.type === 'card') {
    if (value.version !== CARD_PROTOCOL_VERSION || !hasExactKeys(value, IDENTITY_REQUEST_KEYS) || !isWireOrigin(value.origin) || typeof value.fields !== 'string') return false
    const fields = value.fields.split(',')
    return fields.length > 0 && new Set(fields).size === fields.length && fields.every((field) => CARD_FIELD_KEYS.includes(field as CardFieldKey))
  }
  if (value.type === 'save') {
    const allowed = new Set(SAVE_REQUEST_KEYS)
    if (value.title !== undefined) allowed.add('title')
    if (value.username !== undefined) allowed.add('username')
    return hasExactKeys(value, allowed)
      && isWireOrigin(value.origin)
      && (value.kind === 'new' || value.kind === 'update')
      && typeof value.password === 'string'
      && value.password.length > 0
      && value.password.length <= MAX_CREDENTIAL_FIELD
      && (value.username === undefined
        || (typeof value.username === 'string' && value.username.length <= MAX_CREDENTIAL_FIELD))
      && (value.title === undefined
        || (typeof value.title === 'string' && value.title.length > 0 && value.title.length <= 512))
  }
  return false
}

export function safeNativeResponse(raw: unknown, request: NativeRequest): NativeResult {
  if (!isRecord(raw)) return { ok: false, code: 'invalid-response' }
  if (raw.version !== request.version) return { ok: false, code: 'protocol-mismatch' }
  if (raw.requestId !== request.requestId) return { ok: false, code: 'request-mismatch' }

  if (raw.type === 'error') {
    if (!hasExactKeys(raw, ERROR_KEYS)) return { ok: false, code: 'unsafe-response' }
    return typeof raw.message === 'string' && ERROR_MESSAGES.has(raw.message)
      ? { ok: false, code: 'host-rejected-request' }
      : { ok: false, code: 'invalid-response' }
  }

  if (request.type === 'capabilities') {
    if (raw.type !== 'capabilities') return { ok: false, code: 'invalid-response' }
    if (!hasExactKeys(raw, CAPABILITY_KEYS)) return { ok: false, code: 'unsafe-response' }
    const capabilities = {
      desktopAvailable: raw.desktopAvailable,
      locked: raw.locked,
      fillAvailable: raw.fillAvailable,
    }
    if (raw.installed !== true || !isCapabilities(capabilities)) {
      return { ok: false, code: 'invalid-response' }
    }
    return { ok: true, protocolVersion: PROTOCOL_VERSION, capabilities }
  }

  if (request.type === 'activate') {
    if (raw.type !== 'activated' || !hasExactKeys(raw, ACTIVATION_KEYS)) {
      return { ok: false, code: 'invalid-response' }
    }
    return raw.opened === true
      ? { ok: true, opened: true }
      : raw.opened === false
        ? { ok: false, code: 'desktop-launch-failed' }
        : { ok: false, code: 'invalid-response' }
  }

  if (request.type === 'identity') {
    if (raw.type === 'identity-unavailable') {
      if (!hasExactKeys(raw, UNAVAILABLE_KEYS)) return { ok: false, code: 'unsafe-response' }
      if (typeof raw.reason !== 'string' || !UNAVAILABLE_CODES[raw.reason]) {
        return { ok: false, code: 'invalid-response' }
      }
      return { ok: false, code: UNAVAILABLE_CODES[raw.reason] }
    }
    if (raw.type !== 'identity') return { ok: false, code: 'invalid-response' }
    const requestedKeys = request.fields.split(',') as IdentityFieldKey[]
    if (requestedKeys.length === 0
      || new Set(requestedKeys).size !== requestedKeys.length
      || requestedKeys.some((key) => !IDENTITY_FIELD_KEYS.includes(key))) {
      return { ok: false, code: 'invalid-response' }
    }
    if (!hasExactKeys(raw, new Set(['version', 'type', 'requestId', 'identity']))) {
      return { ok: false, code: 'unsafe-response' }
    }
    if (!isRecord(raw.identity) || !hasExactKeys(raw.identity, new Set(requestedKeys))) {
      return { ok: false, code: 'unsafe-response' }
    }
    const identity: IdentityFields = {}
    for (const key of requestedKeys) {
      const value = raw.identity[key]
      if (typeof value !== 'string' || value.length > MAX_CREDENTIAL_FIELD) {
        return { ok: false, code: 'invalid-response' }
      }
      identity[key] = value
    }
    return { ok: true, identity }
  }

  if (request.type === 'card') {
    if (raw.type === 'card-unavailable') {
      if (!hasExactKeys(raw, UNAVAILABLE_KEYS)) return { ok: false, code: 'unsafe-response' }
      return typeof raw.reason === 'string' && UNAVAILABLE_CODES[raw.reason]
        ? { ok: false, code: UNAVAILABLE_CODES[raw.reason] }
        : { ok: false, code: 'invalid-response' }
    }
    if (raw.type !== 'card' || !hasExactKeys(raw, CARD_KEYS) || !isRecord(raw.card)) return { ok: false, code: 'unsafe-response' }
    const requested = request.fields.split(',') as CardFieldKey[]
    if (!hasExactKeys(raw.card, new Set(requested))) return { ok: false, code: 'unsafe-response' }
    const card: CardFields = {}
    for (const field of requested) {
      const value = raw.card[field]
      if (typeof value !== 'string' || value.length === 0 || value.length > MAX_CREDENTIAL_FIELD) return { ok: false, code: 'invalid-response' }
      card[field] = value
    }
    return { ok: true, card }
  }

  if (request.type === 'save') {
    if (raw.type === 'save-unavailable') {
      if (!hasExactKeys(raw, UNAVAILABLE_KEYS)) return { ok: false, code: 'unsafe-response' }
      if (typeof raw.reason !== 'string' || !UNAVAILABLE_CODES[raw.reason]) {
        return { ok: false, code: 'invalid-response' }
      }
      return { ok: false, code: UNAVAILABLE_CODES[raw.reason] }
    }
    if (raw.type !== 'saved') return { ok: false, code: 'invalid-response' }
    if (!hasExactKeys(raw, SAVED_KEYS)) return { ok: false, code: 'unsafe-response' }
    return raw.saved === true ? { ok: true, saved: true } : { ok: false, code: 'invalid-response' }
  }

  if (raw.type === 'fill-unavailable') {
    if (!hasExactKeys(raw, UNAVAILABLE_KEYS)) return { ok: false, code: 'unsafe-response' }
    if (typeof raw.reason !== 'string' || !UNAVAILABLE_CODES[raw.reason]) {
      return { ok: false, code: 'invalid-response' }
    }
    return { ok: false, code: UNAVAILABLE_CODES[raw.reason] }
  }
  if (raw.type !== 'fill') return { ok: false, code: 'invalid-response' }
  const fields = request.fields ?? 'both'
  const expectedKeys = fields === 'username' ? FILL_USERNAME_KEYS
    : fields === 'password' ? FILL_PASSWORD_KEYS : FILL_BOTH_KEYS
  if (!hasExactKeys(raw, expectedKeys)) return { ok: false, code: 'unsafe-response' }

  const credential = {
    username: fields === 'password' ? '' : typeof raw.username === 'string' ? raw.username : '',
    password: fields === 'username' ? '' : typeof raw.password === 'string' ? raw.password : '',
  }
  const valid = fields === 'username'
    ? typeof credential.username === 'string' && credential.username.length > 0 && credential.username.length <= MAX_CREDENTIAL_FIELD
    : fields === 'password'
      ? typeof credential.password === 'string' && credential.password.length > 0 && credential.password.length <= MAX_CREDENTIAL_FIELD
      : isCredential(credential)
  return valid
    ? { ok: true, credential }
    : { ok: false, code: 'invalid-response' }
}

export function makeRequest(type: 'capabilities'): Extract<NativeRequest, { type: 'capabilities' }>
export function makeRequest(type: 'activate'): Extract<NativeRequest, { type: 'activate' }>
export function makeRequest(type: 'fill', origin: string, fields?: FillFields): Extract<NativeRequest, { type: 'fill' }>
export function makeRequest(type: 'capabilities' | 'activate' | 'fill', origin?: string, fields: FillFields = 'both'): NativeRequest {
  const requestId = crypto.randomUUID()
  if (type === 'fill') {
    const normalizedOrigin = normalizeFillOrigin(origin)
    if (!normalizedOrigin) throw new TypeError('fill request requires a normalized web origin')
    // "both" omits the selector field for v1 host compatibility.
    return fields === 'both'
      ? { version: PROTOCOL_VERSION, type, requestId, origin: normalizedOrigin }
      : { version: PROTOCOL_VERSION, type, requestId, origin: normalizedOrigin, fields }
  }
  return { version: PROTOCOL_VERSION, type, requestId }
}

export function makeIdentityRequest(
  origin: string,
  fields: readonly IdentityFieldKey[]
): Extract<NativeRequest, { type: 'identity' }> {
  const normalizedOrigin = normalizeFillOrigin(origin)
  if (!normalizedOrigin) throw new TypeError('identity request requires a normalized web origin')
  const unique = Array.from(new Set(fields))
  if (unique.length === 0 || unique.some((key) => !IDENTITY_FIELD_KEYS.includes(key))) {
    throw new TypeError('identity request requires at least one known field')
  }
  return {
    version: PROTOCOL_VERSION,
    type: 'identity',
    requestId: crypto.randomUUID(),
    origin: normalizedOrigin,
    fields: unique.join(','),
  }
}

export function makeCardRequest(origin: string, fields: readonly CardFieldKey[]): Extract<NativeRequest, { type: 'card' }> {
  const normalizedOrigin = normalizeFillOrigin(origin)
  if (!normalizedOrigin || !normalizedOrigin.startsWith('https://')) throw new TypeError('card request requires an HTTPS origin')
  const unique = Array.from(new Set(fields))
  if (unique.length === 0 || unique.some((field) => !CARD_FIELD_KEYS.includes(field))) throw new TypeError('card request requires known fields')
  return { version: CARD_PROTOCOL_VERSION, type: 'card', requestId: crypto.randomUUID(), origin: normalizedOrigin, fields: unique.join(',') }
}

export function makeSaveRequest(
  origin: string,
  password: string,
  kind: 'new' | 'update',
  options: { title?: string; username?: string } = {}
): Extract<NativeRequest, { type: 'save' }> {
  const normalizedOrigin = normalizeFillOrigin(origin)
  if (!normalizedOrigin) throw new TypeError('save request requires a normalized web origin')
  if (password.length === 0 || password.length > MAX_CREDENTIAL_FIELD) {
    throw new TypeError('save request requires a non-empty, bounded password')
  }
  const title = options.title?.trim()
  if (title !== undefined && (title.length === 0 || title.length > 512)) {
    throw new TypeError('save request title must be non-empty and bounded')
  }
  if (options.username !== undefined && options.username.length > MAX_CREDENTIAL_FIELD) {
    throw new TypeError('save request username must be bounded')
  }
  const request: Extract<NativeRequest, { type: 'save' }> = {
    version: PROTOCOL_VERSION,
    type: 'save',
    requestId: crypto.randomUUID(),
    origin: normalizedOrigin,
    kind,
    password,
  }
  if (title) request.title = title
  if (options.username) request.username = options.username
  return request
}

export function normalizeFillOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null
  try {
    const url = new URL(value)
    if (url.hostname.endsWith('.')) return null
    const allowed = url.protocol === 'https:'
      || (url.protocol === 'http:'
        && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'))
    if (!allowed || url.origin === 'null') return null
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
    return url.origin
  } catch {
    return null
  }
}

export function classifiesAsSecret(value: string): boolean {
  if (value.length === 0) return false
  if (/^(otpauth|ssh-|-----BEGIN|eyJ|[A-Za-z0-9+/]{40,}={0,2})/.test(value)) return true
  return /\b(password|passwd|secret|token|key|seed|private)\b/i.test(value) && value.length > 16
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)
}

function isWireOrigin(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 2048
    && !Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
    })
}

function hasExactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  const keys = Object.keys(value)
  return keys.length === allowed.size && keys.every((key) => allowed.has(key))
}
