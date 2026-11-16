// Wire protocol shared with the desktop host: byte-for-byte compatible, response schemas closed.
import { isRecord } from '../shared/values'
export const NATIVE_HOST = 'app.usesesame.browser'
export const PROTOCOL_VERSION = 1
export const CAPABILITIES_PROTOCOL_VERSION = 6
export const CARD_PROTOCOL_VERSION = 2
export const FILL_MATCH_PROTOCOL_VERSION = 3
export const TOTP_PROTOCOL_VERSION = 4
export const FILL_LOOKALIKE_PROTOCOL_VERSION = 5
export const FILL_SITE_PROTOCOL_VERSION = 7
export const PENDING_PASSWORD_PROTOCOL_VERSION = 8
export const HANDLE_PATTERN = /^[A-Za-z0-9_-]{43}$/
export const NATIVE_FILL_TIMEOUT_MS = 30_000
export const NATIVE_PROBE_TIMEOUT_MS = 5_000
export const MAX_CREDENTIAL_FIELD = 4096
export const MAX_LOOKALIKE_HOST = 128
export type FillFields = 'username' | 'password' | 'both'
export type FillMatchKind = 'exact' | 'wwwAlias' | 'site'
export type FillProtocolVersion = typeof FILL_LOOKALIKE_PROTOCOL_VERSION | typeof FILL_SITE_PROTOCOL_VERSION
export type PasswordStyle = { style: 'characters'; size: number } | { style: 'passphrase'; size: number }
export type PendingAction = 'filled' | 'notFilled' | 'accepted'
export type PendingState = 'unconfirmed' | 'confirmed' | 'returned' | 'unknown'
export const DEFAULT_PASSWORD_STYLE: PasswordStyle = { style: 'characters', size: 20 }

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
  | { version: 4; type: 'totp'; requestId: string; origin: string }
  | { version: number; type: 'identity'; requestId: string; origin: string; fields: string }
  | { version: 2; type: 'card'; requestId: string; origin: string; fields: string }
  | { version: number; type: 'save'; requestId: string; origin: string; kind: 'new' | 'update'; title?: string; username?: string; password: string }
  | { version: 8; type: 'change'; requestId: string; origin: string; style: PasswordStyle['style']; size: number }
  | { version: 8; type: 'create'; requestId: string; origin: string; style: PasswordStyle['style']; size: number }
  | { version: 8; type: 'pending'; requestId: string; origin: string; handle: string; action: PendingAction; username?: string }

export type NativeResult =
  | { ok: true; protocolVersion: number; capabilities: DesktopCapabilities }
  | { ok: true; opened: true }
  | { ok: true; credential: Credential; matchKind?: FillMatchKind }
  | { ok: true; totpCode: string; remainingSeconds: number }
  | { ok: true; identity: IdentityFields }
  | { ok: true; card: CardFields }
  | { ok: true; saved: true }
  | { ok: true; changed: ChangedPasswords }
  | { ok: true; created: CreatedPassword }
  | { ok: true; pendingState: PendingState }
  | { ok: false; code: 'lookalike-domain'; lookalike: string }
  | { ok: false; code: string }

export interface ChangedPasswords {
  currentPassword: string
  newPassword: string
  handle: string
  matchKind: FillMatchKind
}

export interface CreatedPassword {
  password: string
  handle: string
}

export interface DesktopCapabilities {
  desktopAvailable: boolean
}

export interface Credential {
  username: string
  password: string
}

export type IdentityFields = Partial<Record<IdentityFieldKey, string>>

const CAPABILITIES_KEYS = new Set([
  'version', 'type', 'requestId', 'installed', 'desktopAvailable', 'locked', 'fillAvailable',
])
const DECODED_CAPABILITY_KEYS = new Set(['desktopAvailable'])
const ACTIVATION_KEYS = new Set(['version', 'type', 'requestId', 'opened'])
const FILL_BOTH_KEYS = new Set(['version', 'type', 'requestId', 'username', 'password'])
const FILL_USERNAME_KEYS = new Set(['version', 'type', 'requestId', 'username'])
const FILL_PASSWORD_KEYS = new Set(['version', 'type', 'requestId', 'password'])
const UNAVAILABLE_KEYS = new Set(['version', 'type', 'requestId', 'reason'])
const LOOKALIKE_UNAVAILABLE_KEYS = new Set(['version', 'type', 'requestId', 'reason', 'lookalike'])
const SAVED_KEYS = new Set(['version', 'type', 'requestId', 'saved'])
const ERROR_KEYS = new Set(['version', 'type', 'requestId', 'message'])
const BASE_REQUEST_KEYS = new Set(['version', 'type', 'requestId'])
const FILL_REQUEST_KEYS = new Set(['version', 'type', 'requestId', 'origin'])
const FIELDS_REQUEST_KEYS = new Set(['version', 'type', 'requestId', 'origin', 'fields'])
const CARD_KEYS = new Set(['version', 'type', 'requestId', 'card'])
const TOTP_KEYS = new Set(['version', 'type', 'requestId', 'code', 'remainingSeconds'])
const SAVE_REQUEST_KEYS = new Set(['version', 'type', 'requestId', 'origin', 'kind', 'password'])
const GENERATE_REQUEST_KEYS = new Set(['version', 'type', 'requestId', 'origin', 'style', 'size'])
const PENDING_REQUEST_KEYS = new Set(['version', 'type', 'requestId', 'origin', 'handle', 'action'])
const CHANGED_KEYS = new Set(['version', 'type', 'requestId', 'currentPassword', 'newPassword', 'handle', 'matchKind'])
const CREATED_KEYS = new Set(['version', 'type', 'requestId', 'password', 'handle'])
const PENDING_STATE_KEYS = new Set(['version', 'type', 'requestId', 'state'])
const PENDING_STATES: ReadonlySet<string> = new Set(['unconfirmed', 'confirmed', 'returned', 'unknown'])
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
const UNSUPPORTED_VERSION_MESSAGE = 'Unsupported protocol version.'
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
  if (!isRecord(value) || !hasExactKeys(value, DECODED_CAPABILITY_KEYS)) return false
  return typeof value.desktopAvailable === 'boolean'
}

function legacyCapabilitiesAreWellFormed(value: Record<string, unknown>): boolean {
  const locked = value.locked
  const fillAvailable = value.fillAvailable
  if ((locked === undefined) !== (fillAvailable === undefined)) return false
  if (locked !== undefined && typeof locked !== 'boolean') return false
  if (fillAvailable !== undefined && typeof fillAvailable !== 'boolean') return false
  if (typeof locked === 'boolean' && typeof fillAvailable === 'boolean' && fillAvailable === locked) {
    return false
  }
  return true
}

function supportsRequestVersion(type: unknown, version: unknown): boolean {
  switch (type) {
    case 'fill': return isFillProtocolVersion(version)
    case 'totp': return version === TOTP_PROTOCOL_VERSION
    case 'card': return version === CARD_PROTOCOL_VERSION
    case 'capabilities': return version === CAPABILITIES_PROTOCOL_VERSION
    case 'activate':
    case 'identity':
    case 'save': return version === PROTOCOL_VERSION
    case 'change':
    case 'create':
    case 'pending': return version === PENDING_PASSWORD_PROTOCOL_VERSION
    default: return false
  }
}

export function isNativeRequest(value: unknown): value is NativeRequest {
  if (!isRecord(value)
    || !isRequestId(value.requestId)
    || !supportsRequestVersion(value.type, value.version)) {
    return false
  }
  if (value.type === 'capabilities' || value.type === 'activate') {
    return hasExactKeys(value, BASE_REQUEST_KEYS)
  }
  if (value.type === 'totp') {
    return isWireOrigin(value.origin)
      && hasExactKeys(value, FILL_REQUEST_KEYS)
  }
  if (value.type === 'fill') {
    const fieldsValid = value.fields === undefined
      || value.fields === 'username'
      || value.fields === 'password'
      || value.fields === 'both'
    return fieldsValid
      && isWireOrigin(value.origin)
      && hasExactKeys(value, value.fields === undefined ? FILL_REQUEST_KEYS : FIELDS_REQUEST_KEYS)
  }
  if (value.type === 'identity') {
    if (!hasExactKeys(value, FIELDS_REQUEST_KEYS) || !isWireOrigin(value.origin) || typeof value.fields !== 'string') {
      return false
    }
    const fields = value.fields.split(',')
    return fields.length > 0
      && new Set(fields).size === fields.length
      && fields.every((field) => IDENTITY_FIELD_KEYS.includes(field as IdentityFieldKey))
  }
  if (value.type === 'card') {
    if (!hasExactKeys(value, FIELDS_REQUEST_KEYS) || !isWireOrigin(value.origin) || typeof value.fields !== 'string') return false
    const fields = value.fields.split(',')
    return fields.length > 0 && new Set(fields).size === fields.length && fields.every((field) => CARD_FIELD_KEYS.includes(field as CardFieldKey))
  }
  if (value.type === 'change' || value.type === 'create') {
    return hasExactKeys(value, GENERATE_REQUEST_KEYS)
      && isWireOrigin(value.origin)
      && isPasswordStyle(value.style, value.size)
  }
  if (value.type === 'pending') {
    const allowed = new Set(PENDING_REQUEST_KEYS)
    if (value.username !== undefined) allowed.add('username')
    return hasExactKeys(value, allowed)
      && isWireOrigin(value.origin)
      && isHandle(value.handle)
      && (value.action === 'filled' || value.action === 'notFilled' || value.action === 'accepted')
      && (value.username === undefined
        || (value.action === 'accepted' && typeof value.username === 'string' && value.username.length <= MAX_CREDENTIAL_FIELD))
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
    if (typeof raw.message !== 'string' || !ERROR_MESSAGES.has(raw.message)) {
      return { ok: false, code: 'invalid-response' }
    }
    if (raw.message === UNSUPPORTED_VERSION_MESSAGE && request.version === PENDING_PASSWORD_PROTOCOL_VERSION) {
      return { ok: false, code: 'pending-version-unsupported' }
    }
    return request.type === 'fill'
      && request.version === FILL_SITE_PROTOCOL_VERSION
      && raw.message === UNSUPPORTED_VERSION_MESSAGE
      ? { ok: false, code: 'fill-version-unsupported' }
      : { ok: false, code: 'host-rejected-request' }
  }

  if (request.type === 'change') {
    if (raw.type === 'change-unavailable') {
      return raw.reason === 'lookalike' ? decodeLookalikeUnavailable(raw) : decodeUnavailable(raw)
    }
    if (raw.type !== 'changed' || !hasExactKeys(raw, CHANGED_KEYS)) return { ok: false, code: 'unsafe-response' }
    if (!isSecret(raw.currentPassword) || !isSecret(raw.newPassword) || !isHandle(raw.handle)
      || !isFillMatchKind(raw.matchKind, FILL_SITE_PROTOCOL_VERSION)) {
      return { ok: false, code: 'unsafe-response' }
    }
    return { ok: true, changed: { currentPassword: raw.currentPassword, newPassword: raw.newPassword, handle: raw.handle, matchKind: raw.matchKind } }
  }

  if (request.type === 'create') {
    if (raw.type === 'create-unavailable') return decodeUnavailable(raw)
    if (raw.type !== 'created' || !hasExactKeys(raw, CREATED_KEYS)) return { ok: false, code: 'unsafe-response' }
    if (!isSecret(raw.password) || !isHandle(raw.handle)) return { ok: false, code: 'unsafe-response' }
    return { ok: true, created: { password: raw.password, handle: raw.handle } }
  }

  if (request.type === 'pending') {
    if (raw.type === 'pending-unavailable') return decodeUnavailable(raw)
    if (raw.type !== 'pending-state' || !hasExactKeys(raw, PENDING_STATE_KEYS)) return { ok: false, code: 'unsafe-response' }
    if (typeof raw.state !== 'string' || !PENDING_STATES.has(raw.state)) return { ok: false, code: 'invalid-response' }
    return { ok: true, pendingState: raw.state as PendingState }
  }

  if (request.type === 'capabilities') {
    if (raw.type !== 'capabilities') return { ok: false, code: 'invalid-response' }
    const allowedKeys = request.version === CAPABILITIES_PROTOCOL_VERSION
      ? new Set(['version', 'type', 'requestId', 'installed', 'desktopAvailable'])
      : CAPABILITIES_KEYS
    if (!hasOnlyKeys(raw, allowedKeys) || !legacyCapabilitiesAreWellFormed(raw)) {
      return { ok: false, code: 'unsafe-response' }
    }
    const capabilities = { desktopAvailable: raw.desktopAvailable }
    if (raw.installed !== true || !isCapabilities(capabilities)) {
      return { ok: false, code: 'invalid-response' }
    }
    return { ok: true, protocolVersion: request.version, capabilities }
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
      return decodeUnavailable(raw)
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
      return decodeUnavailable(raw)
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
      return decodeUnavailable(raw)
    }
    if (raw.type !== 'saved') return { ok: false, code: 'invalid-response' }
    if (!hasExactKeys(raw, SAVED_KEYS)) return { ok: false, code: 'unsafe-response' }
    return raw.saved === true ? { ok: true, saved: true } : { ok: false, code: 'invalid-response' }
  }

  if (request.type === 'totp') {
    if (raw.type === 'totp-unavailable') {
      return decodeUnavailable(raw)
    }
    if (raw.type !== 'totp') return { ok: false, code: 'invalid-response' }
    if (!hasExactKeys(raw, TOTP_KEYS)) return { ok: false, code: 'unsafe-response' }
    if (!isOneTimeCode(raw.code) || !isOneTimeCodeWindow(raw.remainingSeconds)) {
      return { ok: false, code: 'unsafe-response' }
    }
    return { ok: true, totpCode: raw.code, remainingSeconds: raw.remainingSeconds }
  }

  if (raw.type === 'fill-unavailable') {
    if (raw.reason === 'lookalike') {
      return isFillProtocolVersion(request.version)
        ? decodeLookalikeUnavailable(raw)
        : { ok: false, code: 'protocol-mismatch' }
    }
    return decodeUnavailable(raw)
  }
  if (raw.type !== 'fill') return { ok: false, code: 'invalid-response' }
  const fields = request.fields ?? 'both'
  const expectedKeys = fields === 'username' ? FILL_USERNAME_KEYS
    : fields === 'password' ? FILL_PASSWORD_KEYS : FILL_BOTH_KEYS
  const requiresMatchKind = request.version === FILL_MATCH_PROTOCOL_VERSION
    || isFillProtocolVersion(request.version)
  if (!hasExactKeys(raw, requiresMatchKind ? new Set([...expectedKeys, 'matchKind']) : expectedKeys)) {
    return { ok: false, code: 'unsafe-response' }
  }
  if (requiresMatchKind && !isFillMatchKind(raw.matchKind, request.version)) {
    return { ok: false, code: 'unsafe-response' }
  }

  const credential = {
    username: fields === 'password' ? '' : typeof raw.username === 'string' ? raw.username : '',
    password: fields === 'username' ? '' : typeof raw.password === 'string' ? raw.password : '',
  }
  const valid = fields === 'username'
    ? typeof credential.username === 'string' && credential.username.length > 0 && credential.username.length <= MAX_CREDENTIAL_FIELD
    : fields === 'password'
      ? typeof credential.password === 'string' && credential.password.length > 0 && credential.password.length <= MAX_CREDENTIAL_FIELD
      : isCredential(credential)
  if (!valid) return { ok: false, code: 'invalid-response' }
  return requiresMatchKind && isFillMatchKind(raw.matchKind, request.version)
    ? { ok: true, credential, matchKind: raw.matchKind }
    : { ok: true, credential }
}

function decodeUnavailable(raw: Record<string, unknown>): NativeResult {
  if (!hasExactKeys(raw, UNAVAILABLE_KEYS)) return { ok: false, code: 'unsafe-response' }
  if (typeof raw.reason !== 'string' || !UNAVAILABLE_CODES[raw.reason]) {
    return { ok: false, code: 'invalid-response' }
  }
  return { ok: false, code: UNAVAILABLE_CODES[raw.reason] }
}

function decodeLookalikeUnavailable(raw: Record<string, unknown>): NativeResult {
  if (!hasExactKeys(raw, LOOKALIKE_UNAVAILABLE_KEYS) || !isLookalikeHost(raw.lookalike)) {
    return { ok: false, code: 'unsafe-response' }
  }
  return { ok: false, code: 'lookalike-domain', lookalike: raw.lookalike }
}

export function makeRequest(type: 'capabilities'): Extract<NativeRequest, { type: 'capabilities' }>
export function makeRequest(type: 'activate'): Extract<NativeRequest, { type: 'activate' }>
export function makeRequest(
  type: 'fill',
  origin: string,
  fields?: FillFields,
  version?: FillProtocolVersion
): Extract<NativeRequest, { type: 'fill' }>
export function makeRequest(
  type: 'capabilities' | 'activate' | 'fill',
  origin?: string,
  fields: FillFields = 'both',
  version: FillProtocolVersion = FILL_SITE_PROTOCOL_VERSION
): NativeRequest {
  const requestId = crypto.randomUUID()
  if (type === 'fill') {
    const normalizedOrigin = normalizeFillOrigin(origin)
    if (!normalizedOrigin) throw new TypeError('fill request requires a normalized web origin')
    if (!isFillProtocolVersion(version)) throw new TypeError('fill request requires a supported protocol version')
    return fields === 'both'
      ? { version, type, requestId, origin: normalizedOrigin }
      : { version, type, requestId, origin: normalizedOrigin, fields }
  }
  return { version: type === 'capabilities' ? CAPABILITIES_PROTOCOL_VERSION : PROTOCOL_VERSION, type, requestId }
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

export function makeTotpRequest(origin: string): Extract<NativeRequest, { type: 'totp' }> {
  const normalizedOrigin = normalizeFillOrigin(origin)
  if (!normalizedOrigin) throw new TypeError('totp request requires a normalized web origin')
  return { version: TOTP_PROTOCOL_VERSION, type: 'totp', requestId: crypto.randomUUID(), origin: normalizedOrigin }
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

function generateRequest(type: 'change' | 'create', origin: string, style: PasswordStyle): Extract<NativeRequest, { type: 'change' | 'create' }> {
  const normalizedOrigin = normalizeFillOrigin(origin)
  if (!normalizedOrigin) throw new TypeError(`${type} request requires a normalized web origin`)
  if (!isPasswordStyle(style.style, style.size)) throw new TypeError(`${type} request requires a supported password style`)
  return { version: PENDING_PASSWORD_PROTOCOL_VERSION, type, requestId: crypto.randomUUID(), origin: normalizedOrigin, style: style.style, size: style.size }
}

export function makeChangeRequest(origin: string, style: PasswordStyle = DEFAULT_PASSWORD_STYLE): Extract<NativeRequest, { type: 'change' }> {
  return generateRequest('change', origin, style) as Extract<NativeRequest, { type: 'change' }>
}

export function makeCreateRequest(origin: string, style: PasswordStyle = DEFAULT_PASSWORD_STYLE): Extract<NativeRequest, { type: 'create' }> {
  return generateRequest('create', origin, style) as Extract<NativeRequest, { type: 'create' }>
}

export function makePendingRequest(
  origin: string,
  handle: string,
  action: PendingAction,
  username?: string,
): Extract<NativeRequest, { type: 'pending' }> {
  const normalizedOrigin = normalizeFillOrigin(origin)
  if (!normalizedOrigin) throw new TypeError('pending request requires a normalized web origin')
  if (!isHandle(handle)) throw new TypeError('pending request requires a handle')
  const request: Extract<NativeRequest, { type: 'pending' }> = {
    version: PENDING_PASSWORD_PROTOCOL_VERSION,
    type: 'pending',
    requestId: crypto.randomUUID(),
    origin: normalizedOrigin,
    handle,
    action,
  }
  const trimmed = username?.trim()
  if (action === 'accepted' && trimmed && trimmed.length <= MAX_CREDENTIAL_FIELD) request.username = trimmed
  return request
}

export function isHandle(value: unknown): value is string {
  return typeof value === 'string' && HANDLE_PATTERN.test(value)
}

export function isPasswordStyle(style: unknown, size: unknown): boolean {
  if (typeof size !== 'number' || !Number.isInteger(size)) return false
  return (style === 'characters' && size >= 16 && size <= 64)
    || (style === 'passphrase' && size >= 5 && size <= 10)
}

function isSecret(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_CREDENTIAL_FIELD
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

function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)
}

function isFillProtocolVersion(value: unknown): value is FillProtocolVersion {
  return value === FILL_LOOKALIKE_PROTOCOL_VERSION || value === FILL_SITE_PROTOCOL_VERSION
}

function isFillMatchKind(value: unknown, version: number): value is FillMatchKind {
  return value === 'exact'
    || value === 'wwwAlias'
    || (value === 'site' && version === FILL_SITE_PROTOCOL_VERSION)
}

const LOOKALIKE_HOST_FORBIDDEN = new Set([' ', '/', '?', '#', '@', ':'])

function isLookalikeHost(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_LOOKALIKE_HOST) return false
  return !Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f
      || (codePoint >= 0x7f && codePoint <= 0x9f)
      || LOOKALIKE_HOST_FORBIDDEN.has(character)
  })
}

function isOneTimeCode(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9]{1,9}$/.test(value)
}

function isOneTimeCodeWindow(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 3600
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

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key))
}
