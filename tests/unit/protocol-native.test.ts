import { describe, expect, it } from 'vitest'
import {
  IDENTITY_FIELD_KEYS,
  MAX_CREDENTIAL_FIELD,
  PROTOCOL_VERSION,
  classifiesAsSecret,
  isCapabilities,
  isCredential,
  isNativeRequest,
  makeIdentityRequest,
  makeRequest,
  makeSaveRequest,
  normalizeFillOrigin,
  safeNativeResponse,
  type NativeRequest,
} from '../../src/protocol/native'

const fillRequest = (fields?: 'username' | 'password' | 'both'): NativeRequest =>
  makeRequest('fill', 'https://example.test', fields)

const respond = (request: NativeRequest, extra: Record<string, unknown>) =>
  safeNativeResponse({ version: PROTOCOL_VERSION, requestId: request.requestId, ...extra }, request)

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
  it('omits the field selector when asking for both, so a v1 host still understands it', () => {
    expect(Object.keys(fillRequest('both')).sort()).toEqual(['origin', 'requestId', 'type', 'version'])
    expect(fillRequest('username')).toHaveProperty('fields', 'username')
  })

  it('refuses to build a fill request for an origin it would not accept', () => {
    expect(() => makeRequest('fill', 'http://example.test')).toThrow(TypeError)
  })

  it('stamps every request with the protocol version the host checks', () => {
    expect(makeRequest('capabilities').version).toBe(PROTOCOL_VERSION)
    expect(makeRequest('activate').version).toBe(PROTOCOL_VERSION)
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
    expect(isNativeRequest(makeIdentityRequest('https://example.test', ['email']))).toBe(true)
    expect(isNativeRequest(makeSaveRequest('https://example.test', 'pw', 'update'))).toBe(true)
  })

  it('rejects another protocol version', () => {
    expect(isNativeRequest({ ...fillRequest('both'), version: PROTOCOL_VERSION + 1 })).toBe(false)
  })

  it('rejects an unexpected extra key rather than ignoring it', () => {
    expect(isNativeRequest({ ...fillRequest('both'), extra: 1 })).toBe(false)
  })

  it('rejects a request id outside the accepted shape', () => {
    expect(isNativeRequest({ ...fillRequest('both'), requestId: 'has spaces' })).toBe(false)
    expect(isNativeRequest({ ...fillRequest('both'), requestId: 'x'.repeat(65) })).toBe(false)
  })
})

describe('safeNativeResponse', () => {
  it('refuses a reply that answers a different request', () => {
    const request = fillRequest('both')
    const reply = { version: PROTOCOL_VERSION, requestId: 'someone-elses', type: 'fill', username: 'u', password: 'p' }
    expect(safeNativeResponse(reply, request)).toEqual({ ok: false, code: 'request-mismatch' })
  })

  it('refuses a reply from a different protocol version', () => {
    const request = fillRequest('both')
    const reply = { version: PROTOCOL_VERSION + 1, requestId: request.requestId, type: 'fill', username: 'u', password: 'p' }
    expect(safeNativeResponse(reply, request)).toEqual({ ok: false, code: 'protocol-mismatch' })
  })

  it('treats an unexpected extra key as unsafe rather than reading around it', () => {
    const request = fillRequest('both')
    expect(respond(request, { type: 'fill', username: 'u', password: 'p', note: 'x' }))
      .toEqual({ ok: false, code: 'unsafe-response' })
  })

  it('returns only the field that was asked for', () => {
    const request = fillRequest('username')
    expect(respond(request, { type: 'fill', username: 'someone' }))
      .toEqual({ ok: true, credential: { username: 'someone', password: '' } })
    expect(respond(request, { type: 'fill', username: 'someone', password: 'leaked' }))
      .toEqual({ ok: false, code: 'unsafe-response' })
  })

  it('refuses a credential with an empty or oversized password', () => {
    const request = fillRequest('both')
    expect(respond(request, { type: 'fill', username: 'u', password: '' }))
      .toEqual({ ok: false, code: 'invalid-response' })
    expect(respond(request, { type: 'fill', username: 'u', password: 'p'.repeat(MAX_CREDENTIAL_FIELD + 1) }))
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

describe('isCapabilities', () => {
  it('holds the host to its own invariant that filling is possible only while unlocked', () => {
    expect(isCapabilities({ desktopAvailable: true, locked: false, fillAvailable: true })).toBe(true)
    expect(isCapabilities({ desktopAvailable: true, locked: true, fillAvailable: false })).toBe(true)
    expect(isCapabilities({ desktopAvailable: true, locked: true, fillAvailable: true })).toBe(false)
  })

  it('refuses a desktop that is absent yet reports itself unlocked', () => {
    expect(isCapabilities({ desktopAvailable: false, locked: false, fillAvailable: true })).toBe(false)
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

describe('classifiesAsSecret', () => {
  it('spots the material a support form must never receive', () => {
    expect(classifiesAsSecret('otpauth://totp/Example')).toBe(true)
    expect(classifiesAsSecret('-----BEGIN PRIVATE KEY-----')).toBe(true)
    expect(classifiesAsSecret('ssh-ed25519 AAAAC3Nz')).toBe(true)
    expect(classifiesAsSecret('my password is hunter2hunter2')).toBe(true)
  })

  it('leaves ordinary prose alone', () => {
    expect(classifiesAsSecret('')).toBe(false)
    expect(classifiesAsSecret('The fill button does nothing on this page.')).toBe(false)
  })
})

describe('protocol constants', () => {
  it('lists identity keys the desktop mirrors, with no duplicates', () => {
    expect(new Set(IDENTITY_FIELD_KEYS).size).toBe(IDENTITY_FIELD_KEYS.length)
    expect(IDENTITY_FIELD_KEYS).toContain('email')
  })
})
