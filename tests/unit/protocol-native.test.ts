import { describe, expect, it } from 'vitest'
import {
  IDENTITY_FIELD_KEYS,
  CARD_PROTOCOL_VERSION,
  FILL_LOOKALIKE_PROTOCOL_VERSION,
  FILL_MATCH_PROTOCOL_VERSION,
  MAX_CREDENTIAL_FIELD,
  MAX_LOOKALIKE_HOST,
  PROTOCOL_VERSION,
  TOTP_PROTOCOL_VERSION,
  isCapabilities,
  isCredential,
  isNativeRequest,
  makeCardRequest,
  makeIdentityRequest,
  makeRequest,
  makeSaveRequest,
  makeTotpRequest,
  normalizeFillOrigin,
  redactCard,
  safeNativeResponse,
  type NativeRequest,
} from '../../src/protocol/native'

const fillRequest = (fields?: 'username' | 'password' | 'both'): NativeRequest =>
  makeRequest('fill', 'https://example.test', fields)

const legacyFillRequest = (): NativeRequest => ({
  version: PROTOCOL_VERSION,
  type: 'fill',
  requestId: 'fill-1-legacy',
  origin: 'https://example.test',
})

const respond = (request: NativeRequest, extra: Record<string, unknown>) =>
  safeNativeResponse({ version: request.version, requestId: request.requestId, ...extra }, request)

describe('normalizeFillOrigin', () => {
  it('keeps the origin of an ordinary secure page', () => {
    expect(normalizeFillOrigin('https://example.test')).toBe('https://example.test')
    expect(normalizeFillOrigin('https://example.test:8443')).toBe('https://example.test:8443')
  })

  it('allows plain http only on loopback, where there is no network to observe', () => {
    expect(normalizeFillOrigin('http://localhost:3000')).toBe('http://localhost:3000')
    expect(normalizeFillOrigin('http://127.0.0.1')).toBe('http://127.0.0.1')
    expect(normalizeFillOrigin('http://example.test')).toBeNull()
  })

  it('refuses a URL carrying anything beyond an origin', () => {
    expect(normalizeFillOrigin('https://example.test/login')).toBeNull()
    expect(normalizeFillOrigin('https://example.test/?next=1')).toBeNull()
    expect(normalizeFillOrigin('https://example.test/#top')).toBeNull()
  })

  it('refuses embedded credentials, which would smuggle a second identity into the origin', () => {
    expect(normalizeFillOrigin('https://user:pass@example.test')).toBeNull()
  })

  it('refuses a trailing-dot host that resolves the same but compares differently', () => {
    expect(normalizeFillOrigin('https://example.test.')).toBeNull()
  })

  it('refuses opaque, oversized, and non-URL input', () => {
    expect(normalizeFillOrigin('data:text/html,hi')).toBeNull()
    expect(normalizeFillOrigin('not a url')).toBeNull()
    expect(normalizeFillOrigin('')).toBeNull()
    expect(normalizeFillOrigin(`https://${'a'.repeat(2100)}.test`)).toBeNull()
    expect(normalizeFillOrigin(undefined)).toBeNull()
  })
})

describe('makeRequest', () => {
  it('omits the field selector when asking for both', () => {
    expect(Object.keys(fillRequest('both')).sort()).toEqual(['origin', 'requestId', 'type', 'version'])
    expect(fillRequest('username')).toHaveProperty('fields', 'username')
  })

  it('refuses to build a fill request for an origin it would not accept', () => {
    expect(() => makeRequest('fill', 'http://example.test')).toThrow(TypeError)
    expect(() => makeTotpRequest('http://example.test')).toThrow(TypeError)
  })

  it('stamps every request with the protocol version its host checks', () => {
    expect(makeRequest('capabilities').version).toBe(PROTOCOL_VERSION)
    expect(makeRequest('activate').version).toBe(PROTOCOL_VERSION)
    expect(fillRequest('both').version).toBe(FILL_LOOKALIKE_PROTOCOL_VERSION)
    expect(makeCardRequest('https://checkout.example.test', ['number']).version).toBe(CARD_PROTOCOL_VERSION)
    expect(makeTotpRequest('https://example.test').version).toBe(TOTP_PROTOCOL_VERSION)
  })
})

describe('makeSaveRequest and makeIdentityRequest', () => {
  it('bounds the password rather than forwarding whatever a page produced', () => {
    expect(() => makeSaveRequest('https://example.test', '', 'new')).toThrow(TypeError)
    expect(() => makeSaveRequest('https://example.test', 'a'.repeat(MAX_CREDENTIAL_FIELD + 1), 'new')).toThrow(TypeError)
  })

  it('drops an absent title and username instead of sending empty keys', () => {
    const request = makeSaveRequest('https://example.test', 'pw', 'new')
    expect(request).not.toHaveProperty('title')
    expect(request).not.toHaveProperty('username')
  })

  it('deduplicates identity fields and rejects unknown ones', () => {
    const request = makeIdentityRequest('https://example.test', ['email', 'email', 'city'])
    expect(request.fields).toBe('email,city')
    expect(() => makeIdentityRequest('https://example.test', ['nickname' as never])).toThrow(TypeError)
    expect(() => makeIdentityRequest('https://example.test', [])).toThrow(TypeError)
  })
})

describe('isNativeRequest', () => {
  it('accepts what makeRequest builds', () => {
    expect(isNativeRequest(fillRequest('both'))).toBe(true)
    expect(isNativeRequest(fillRequest('password'))).toBe(true)
    expect(isNativeRequest(makeIdentityRequest('https://example.test', ['email']))).toBe(true)
    expect(isNativeRequest(makeSaveRequest('https://example.test', 'pw', 'update'))).toBe(true)
  })

  it('rejects another protocol version', () => {
    expect(isNativeRequest({ ...fillRequest('both'), version: FILL_LOOKALIKE_PROTOCOL_VERSION + 1 })).toBe(false)
    expect(isNativeRequest({ ...fillRequest('both'), version: 0 })).toBe(false)
  })

  it('accepts the version five fill request shape', () => {
    expect(isNativeRequest({
      version: FILL_LOOKALIKE_PROTOCOL_VERSION,
      type: 'fill',
      requestId: 'fill-5-1',
      origin: 'https://example.test',
    })).toBe(true)
    expect(isNativeRequest({
      version: FILL_LOOKALIKE_PROTOCOL_VERSION,
      type: 'fill',
      requestId: 'fill-5-2',
      origin: 'https://example.test',
      fields: 'password',
    })).toBe(true)
  })

  it('keeps protocol v5 exclusive to fill requests', () => {
    expect(isNativeRequest({
      version: FILL_LOOKALIKE_PROTOCOL_VERSION,
      type: 'totp',
      requestId: 'totp-5-1',
      origin: 'https://example.test',
    })).toBe(false)
    expect(isNativeRequest({ version: FILL_LOOKALIKE_PROTOCOL_VERSION, type: 'capabilities', requestId: 'capabilities-5' })).toBe(false)
    expect(isNativeRequest({
      version: FILL_LOOKALIKE_PROTOCOL_VERSION,
      type: 'save',
      requestId: 'save-5',
      origin: 'https://example.test',
      kind: 'new',
      password: 'pw',
    })).toBe(false)
  })

  it('keeps protocol v2 exclusive to card requests', () => {
    expect(isNativeRequest(makeCardRequest('https://checkout.example.test', ['number']))).toBe(true)
    expect(isNativeRequest({ version: CARD_PROTOCOL_VERSION, type: 'capabilities', requestId: 'capabilities-2' })).toBe(false)
    expect(isNativeRequest({ ...fillRequest('both'), version: CARD_PROTOCOL_VERSION })).toBe(false)
  })

  it('keeps protocol v3 exclusive to fill requests', () => {
    expect(isNativeRequest({ version: FILL_MATCH_PROTOCOL_VERSION, type: 'capabilities', requestId: 'capabilities-3' })).toBe(false)
    expect(isNativeRequest({ version: FILL_MATCH_PROTOCOL_VERSION, type: 'activate', requestId: 'activate-3' })).toBe(false)
    expect(isNativeRequest({
      version: FILL_MATCH_PROTOCOL_VERSION,
      type: 'card',
      requestId: 'card-3',
      origin: 'https://checkout.example.test',
      fields: 'number',
    })).toBe(false)
    expect(isNativeRequest({
      version: FILL_MATCH_PROTOCOL_VERSION,
      type: 'identity',
      requestId: 'identity-3',
      origin: 'https://example.test',
      fields: 'email',
    })).toBe(false)
  })

  it('accepts a totp request on version four only', () => {
    const request = makeTotpRequest('https://example.test')
    expect(isNativeRequest(request)).toBe(true)
    expect(isNativeRequest({ ...request, version: PROTOCOL_VERSION })).toBe(false)
    expect(isNativeRequest({ ...request, version: CARD_PROTOCOL_VERSION })).toBe(false)
    expect(isNativeRequest({ ...request, version: FILL_MATCH_PROTOCOL_VERSION })).toBe(false)
    expect(isNativeRequest({ ...request, version: TOTP_PROTOCOL_VERSION + 1 })).toBe(false)
  })

  it('keeps protocol v4 exclusive to totp requests', () => {
    expect(isNativeRequest({ version: TOTP_PROTOCOL_VERSION, type: 'capabilities', requestId: 'capabilities-4' })).toBe(false)
    expect(isNativeRequest({
      version: TOTP_PROTOCOL_VERSION,
      type: 'fill',
      requestId: 'fill-4',
      origin: 'https://example.test',
    })).toBe(false)
    expect(isNativeRequest({
      version: TOTP_PROTOCOL_VERSION,
      type: 'card',
      requestId: 'card-4',
      origin: 'https://example.test',
      fields: 'number',
    })).toBe(false)
    expect(isNativeRequest({
      version: TOTP_PROTOCOL_VERSION,
      type: 'identity',
      requestId: 'identity-4',
      origin: 'https://example.test',
      fields: 'email',
    })).toBe(false)
    expect(isNativeRequest({
      version: TOTP_PROTOCOL_VERSION,
      type: 'save',
      requestId: 'save-4',
      origin: 'https://example.test',
      kind: 'new',
      password: 'pw',
    })).toBe(false)
  })

  it('holds a totp request to the origin-only shape', () => {
    expect(isNativeRequest({ ...makeTotpRequest('https://example.test'), extra: 1 })).toBe(false)
    expect(isNativeRequest({
      version: TOTP_PROTOCOL_VERSION,
      type: 'totp',
      requestId: 'totp-4-extra',
      origin: 'https://example.test',
      code: '287082',
    })).toBe(false)
    expect(isNativeRequest({ version: TOTP_PROTOCOL_VERSION, type: 'totp', requestId: 'totp-4-missing' })).toBe(false)
    expect(isNativeRequest({ version: TOTP_PROTOCOL_VERSION, type: 'totp', requestId: 'totp-4-empty', origin: '' })).toBe(false)
    expect(isNativeRequest({
      version: TOTP_PROTOCOL_VERSION,
      type: 'totp',
      requestId: 'totp-4-control',
      origin: 'https://example.test\u0000',
    })).toBe(false)
  })

  it('rejects an unexpected extra key rather than ignoring it', () => {
    expect(isNativeRequest({ ...fillRequest('both'), extra: 1 })).toBe(false)
  })

  it('rejects a request id outside the accepted shape', () => {
    expect(isNativeRequest({ ...fillRequest('both'), requestId: 'has spaces' })).toBe(false)
    expect(isNativeRequest({ ...fillRequest('both'), requestId: 'x'.repeat(65) })).toBe(false)
  })
})

describe('redactCard', () => {
  it('clears every approved card field after use', () => {
    const card = { number: '4111111111111111', expiryMonth: '12', expiryYear: '2030', securityCode: '123' }
    redactCard(card)
    expect(card).toEqual({ number: '', expiryMonth: '', expiryYear: '', securityCode: '' })
  })
})

describe('safeNativeResponse', () => {
  it('refuses a reply that answers a different request', () => {
    const request = fillRequest('both')
    const reply = {
      version: request.version,
      requestId: 'someone-elses',
      type: 'fill',
      username: 'u',
      password: 'p',
      matchKind: 'exact',
    }
    expect(safeNativeResponse(reply, request)).toEqual({ ok: false, code: 'request-mismatch' })
  })

  it('refuses a reply from a different protocol version', () => {
    const request = fillRequest('both')
    const reply = {
      version: FILL_MATCH_PROTOCOL_VERSION + 1,
      requestId: request.requestId,
      type: 'fill',
      username: 'u',
      password: 'p',
      matchKind: 'exact',
    }
    expect(safeNativeResponse(reply, request)).toEqual({ ok: false, code: 'protocol-mismatch' })
  })

  it('refuses a version three response to a version one request', () => {
    const request = legacyFillRequest()
    const reply = {
      version: FILL_MATCH_PROTOCOL_VERSION,
      requestId: request.requestId,
      type: 'fill',
      username: 'u',
      password: 'p',
      matchKind: 'exact',
    }
    expect(safeNativeResponse(reply, request)).toEqual({ ok: false, code: 'protocol-mismatch' })
  })

  it('treats an unexpected extra key as unsafe rather than reading around it', () => {
    const request = fillRequest('both')
    expect(respond(request, { type: 'fill', username: 'u', password: 'p', matchKind: 'exact', note: 'x' }))
      .toEqual({ ok: false, code: 'unsafe-response' })
  })

  it('returns the matched rule alongside the credential', () => {
    const request = fillRequest('both')
    expect(respond(request, { type: 'fill', username: 'person@example.test', password: 'fictional-value', matchKind: 'exact' }))
      .toEqual({
        ok: true,
        credential: { username: 'person@example.test', password: 'fictional-value' },
        matchKind: 'exact',
      })
    expect(respond(fillRequest('password'), { type: 'fill', password: 'fictional-value', matchKind: 'wwwAlias' }))
      .toEqual({ ok: true, credential: { username: '', password: 'fictional-value' }, matchKind: 'wwwAlias' })
  })

  it('refuses a fill response that does not name the matched rule', () => {
    const request = fillRequest('both')
    expect(respond(request, { type: 'fill', username: 'u', password: 'p' }))
      .toEqual({ ok: false, code: 'unsafe-response' })
  })

  it('refuses a fill response with an unknown matched rule', () => {
    const request = fillRequest('both')
    expect(respond(request, { type: 'fill', username: 'u', password: 'p', matchKind: 'parentDomain' }))
      .toEqual({ ok: false, code: 'unsafe-response' })
  })

  it('refuses a version one fill response that claims a matched rule', () => {
    const request = legacyFillRequest()
    expect(respond(request, { type: 'fill', username: 'u', password: 'p', matchKind: 'exact' }))
      .toEqual({ ok: false, code: 'unsafe-response' })
  })

  it('still decodes a version one fill response without a matched rule', () => {
    const request = legacyFillRequest()
    expect(respond(request, { type: 'fill', username: 'u', password: 'p' }))
      .toEqual({ ok: true, credential: { username: 'u', password: 'p' } })
  })

  it('returns only the field that was asked for', () => {
    const request = fillRequest('username')
    expect(respond(request, { type: 'fill', username: 'someone', matchKind: 'exact' }))
      .toEqual({ ok: true, credential: { username: 'someone', password: '' }, matchKind: 'exact' })
    expect(respond(request, { type: 'fill', username: 'someone', password: 'leaked', matchKind: 'exact' }))
      .toEqual({ ok: false, code: 'unsafe-response' })
  })

  it('refuses a credential with an empty or oversized password', () => {
    const request = fillRequest('both')
    expect(respond(request, { type: 'fill', username: 'u', password: '', matchKind: 'exact' }))
      .toEqual({ ok: false, code: 'invalid-response' })
    expect(respond(request, { type: 'fill', username: 'u', password: 'p'.repeat(MAX_CREDENTIAL_FIELD + 1), matchKind: 'exact' }))
      .toEqual({ ok: false, code: 'invalid-response' })
  })

  it('maps each declared unavailable reason to its stable code', () => {
    const request = fillRequest('both')
    expect(respond(request, { type: 'fill-unavailable', reason: 'approvalDeclined' }))
      .toEqual({ ok: false, code: 'approval-declined' })
    expect(respond(request, { type: 'fill-unavailable', reason: 'locked' }))
      .toEqual({ ok: false, code: 'vault-locked' })
    expect(respond(request, { type: 'fill-unavailable', reason: 'somethingNew' }))
      .toEqual({ ok: false, code: 'invalid-response' })
    expect(respond(request, { type: 'fill-unavailable', reason: 'noMatch', matchKind: 'exact' }))
      .toEqual({ ok: false, code: 'unsafe-response' })
  })

  it('passes back only identity fields that were requested', () => {
    const request = makeIdentityRequest('https://example.test', ['email', 'city'])
    expect(respond(request, { type: 'identity', identity: { email: 'a@b.test', city: 'Vilnius' } }))
      .toEqual({ ok: true, identity: { email: 'a@b.test', city: 'Vilnius' } })
    expect(respond(request, { type: 'identity', identity: { email: 'a@b.test', city: 'Vilnius', phone: '123' } }))
      .toEqual({ ok: false, code: 'unsafe-response' })
  })

  it('accepts only host error messages it already knows', () => {
    const request = fillRequest('both')
    expect(respond(request, { type: 'error', message: 'Unsupported protocol version.' }))
      .toEqual({ ok: false, code: 'host-rejected-request' })
    expect(respond(request, { type: 'error', message: 'Run this instead' }))
      .toEqual({ ok: false, code: 'invalid-response' })
  })

  it('refuses anything that is not an object', () => {
    const request = fillRequest('both')
    for (const raw of [null, 'fill', 42, ['fill']]) {
      expect(safeNativeResponse(raw, request)).toEqual({ ok: false, code: 'invalid-response' })
    }
  })
})

describe('version five lookalike responses', () => {
  const v5Request = (): NativeRequest => makeRequest('fill', 'https://example.test')
  const v3Request = (): NativeRequest => ({
    version: FILL_MATCH_PROTOCOL_VERSION,
    type: 'fill',
    requestId: 'fill-3-lookalike',
    origin: 'https://example.test',
  })
  const v4Request = (): NativeRequest => makeTotpRequest('https://example.test')

  it('returns both match kinds from a version five fill', () => {
    expect(respond(v5Request(), { type: 'fill', username: 'person@example.test', password: 'fictional-value', matchKind: 'exact' }))
      .toEqual({
        ok: true,
        credential: { username: 'person@example.test', password: 'fictional-value' },
        matchKind: 'exact',
      })
    expect(respond(v5Request(), { type: 'fill', username: 'person@example.test', password: 'fictional-value', matchKind: 'wwwAlias' }))
      .toEqual({
        ok: true,
        credential: { username: 'person@example.test', password: 'fictional-value' },
        matchKind: 'wwwAlias',
      })
  })

  it('decodes a lookalike warning with the stored host and no credential', () => {
    const result = respond(v5Request(), { type: 'fill-unavailable', reason: 'lookalike', lookalike: 'apple.example' })
    expect(result).toEqual({ ok: false, code: 'lookalike-domain', lookalike: 'apple.example' })
    expect(result).not.toHaveProperty('credential')
  })

  it('refuses a lookalike reason without a usable host', () => {
    for (const message of [
      { type: 'fill-unavailable', reason: 'lookalike' },
      { type: 'fill-unavailable', reason: 'lookalike', lookalike: '' },
      { type: 'fill-unavailable', reason: 'lookalike', lookalike: 'a'.repeat(MAX_LOOKALIKE_HOST + 1) },
      { type: 'fill-unavailable', reason: 'lookalike', lookalike: 'apple\u0000.example' },
      { type: 'fill-unavailable', reason: 'lookalike', lookalike: 'apple\u009f.example' },
      { type: 'fill-unavailable', reason: 'lookalike', lookalike: 'apple.example/sign-in' },
    ]) {
      expect(respond(v5Request(), message)).toEqual({ ok: false, code: 'unsafe-response' })
    }
  })

  it('forbids the lookalike host on any other reason', () => {
    expect(respond(v5Request(), { type: 'fill-unavailable', reason: 'noMatch', lookalike: 'apple.example' }))
      .toEqual({ ok: false, code: 'unsafe-response' })
    expect(respond(v5Request(), { type: 'fill-unavailable', reason: 'locked', lookalike: 'apple.example' }))
      .toEqual({ ok: false, code: 'unsafe-response' })
  })

  it('refuses a lookalike reason answered over an older protocol', () => {
    expect(respond(v3Request(), { type: 'fill-unavailable', reason: 'lookalike', lookalike: 'apple.example' }))
      .toEqual({ ok: false, code: 'protocol-mismatch' })
    expect(respond(v4Request(), { type: 'totp-unavailable', reason: 'lookalike', lookalike: 'apple.example' }))
      .toEqual({ ok: false, code: 'unsafe-response' })
    expect(respond(v4Request(), { type: 'totp-unavailable', reason: 'lookalike' }))
      .toEqual({ ok: false, code: 'invalid-response' })
  })

  it('refuses a lookalike answer bound to another request or version', () => {
    const request = v5Request()
    expect(safeNativeResponse({
      version: FILL_LOOKALIKE_PROTOCOL_VERSION,
      type: 'fill-unavailable',
      requestId: 'other-request',
      reason: 'lookalike',
      lookalike: 'apple.example',
    }, request)).toEqual({ ok: false, code: 'request-mismatch' })
    expect(safeNativeResponse({
      version: FILL_MATCH_PROTOCOL_VERSION,
      type: 'fill-unavailable',
      requestId: request.requestId,
      reason: 'noMatch',
    }, request)).toEqual({ ok: false, code: 'protocol-mismatch' })
  })
})

describe('one-time code responses', () => {
  const totpRequest = (): NativeRequest => makeTotpRequest('https://example.test')

  it('returns the code under a field that cannot be read as a failure code', () => {
    expect(respond(totpRequest(), { type: 'totp', code: '287082', remainingSeconds: 18 }))
      .toEqual({ ok: true, totpCode: '287082', remainingSeconds: 18 })
  })

  it('keeps an eight digit code intact', () => {
    expect(respond(totpRequest(), { type: 'totp', code: '12345678', remainingSeconds: 4 }))
      .toEqual({ ok: true, totpCode: '12345678', remainingSeconds: 4 })
  })

  it('refuses a one-time code response to a fill request', () => {
    const request = legacyFillRequest()
    expect(safeNativeResponse({
      version: TOTP_PROTOCOL_VERSION,
      type: 'totp',
      requestId: request.requestId,
      code: '287082',
      remainingSeconds: 18,
    }, request)).toEqual({ ok: false, code: 'protocol-mismatch' })
  })

  it('refuses a response for another request id', () => {
    expect(safeNativeResponse({
      version: TOTP_PROTOCOL_VERSION,
      type: 'totp',
      requestId: 'another-request',
      code: '287082',
      remainingSeconds: 18,
    }, totpRequest())).toEqual({ ok: false, code: 'request-mismatch' })
  })

  it('refuses a response that is not a totp response', () => {
    expect(respond(totpRequest(), { type: 'fill', code: '287082', remainingSeconds: 18 }))
      .toEqual({ ok: false, code: 'invalid-response' })
  })

  it('refuses a code that is not one to nine digits', () => {
    const request = totpRequest()
    for (const code of ['', '28a082', '1234567890', '-123456']) {
      expect(respond(request, { type: 'totp', code, remainingSeconds: 18 }))
        .toEqual({ ok: false, code: 'unsafe-response' })
    }
  })

  it('refuses a remaining window outside the contract range', () => {
    const request = totpRequest()
    for (const remainingSeconds of [0, 3601, 18.5, '18', null]) {
      expect(respond(request, { type: 'totp', code: '287082', remainingSeconds }))
        .toEqual({ ok: false, code: 'unsafe-response' })
    }
  })

  it('refuses a response with a missing or extra key', () => {
    const request = totpRequest()
    expect(respond(request, { type: 'totp', code: '287082' }))
      .toEqual({ ok: false, code: 'unsafe-response' })
    expect(respond(request, { type: 'totp', code: '287082', remainingSeconds: 18, matchKind: 'exact' }))
      .toEqual({ ok: false, code: 'unsafe-response' })
  })

  it('maps each unavailable reason to the shared stable code', () => {
    const request = totpRequest()
    expect(respond(request, { type: 'totp-unavailable', reason: 'noMatch' }))
      .toEqual({ ok: false, code: 'no-match' })
    expect(respond(request, { type: 'totp-unavailable', reason: 'locked' }))
      .toEqual({ ok: false, code: 'vault-locked' })
    expect(respond(request, { type: 'totp-unavailable', reason: 'desktopUnavailable' }))
      .toEqual({ ok: false, code: 'desktop-unavailable' })
    expect(respond(request, { type: 'totp-unavailable', reason: 'approvalDeclined' }))
      .toEqual({ ok: false, code: 'approval-declined' })
  })

  it('refuses an unavailable response that carries a code', () => {
    expect(respond(totpRequest(), { type: 'totp-unavailable', reason: 'noMatch', code: '287082' }))
      .toEqual({ ok: false, code: 'unsafe-response' })
  })
})

describe('isCapabilities', () => {
  it('accepts only desktop availability', () => {
    expect(isCapabilities({ desktopAvailable: true })).toBe(true)
    expect(isCapabilities({ desktopAvailable: false })).toBe(true)
    expect(isCapabilities({ desktopAvailable: true, locked: false })).toBe(false)
    expect(isCapabilities({})).toBe(false)
    expect(isCapabilities({ desktopAvailable: 'yes' })).toBe(false)
  })
})

describe('capabilities responses', () => {
  const request = makeRequest('capabilities')

  it('decodes a reply that carries no lock state', () => {
    expect(respond(request, { type: 'capabilities', installed: true, desktopAvailable: true }))
      .toEqual({
        ok: true,
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { desktopAvailable: true },
      })
  })

  it('accepts and drops the legacy lock fields', () => {
    expect(respond(request, {
      type: 'capabilities',
      installed: true,
      desktopAvailable: true,
      locked: true,
      fillAvailable: false,
    })).toEqual({
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { desktopAvailable: true },
    })
  })

  it('refuses a missing desktop flag, an inconsistent legacy pair, or an extra field', () => {
    expect(respond(request, { type: 'capabilities', installed: true }))
      .toEqual({ ok: false, code: 'invalid-response' })
    expect(respond(request, {
      type: 'capabilities',
      installed: true,
      desktopAvailable: true,
      locked: true,
      fillAvailable: true,
    })).toEqual({ ok: false, code: 'unsafe-response' })
    expect(respond(request, {
      type: 'capabilities',
      installed: true,
      desktopAvailable: true,
      locked: true,
    })).toEqual({ ok: false, code: 'unsafe-response' })
    expect(respond(request, {
      type: 'capabilities',
      installed: true,
      desktopAvailable: true,
      username: 'must-not-cross',
    })).toEqual({ ok: false, code: 'unsafe-response' })
  })
})

describe('isCredential', () => {
  it('requires a password and bounds both fields', () => {
    expect(isCredential({ username: 'u', password: 'p' })).toBe(true)
    expect(isCredential({ username: '', password: 'p' })).toBe(true)
    expect(isCredential({ username: 'u', password: '' })).toBe(false)
    expect(isCredential({ username: 'u'.repeat(MAX_CREDENTIAL_FIELD + 1), password: 'p' })).toBe(false)
  })
})



describe('protocol constants', () => {
  it('lists identity keys the desktop mirrors, with no duplicates', () => {
    expect(new Set(IDENTITY_FIELD_KEYS).size).toBe(IDENTITY_FIELD_KEYS.length)
    expect(IDENTITY_FIELD_KEYS).toContain('email')
  })
})
