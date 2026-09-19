import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CARD_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  isNativeRequest,
  safeNativeResponse,
  type NativeRequest,
} from '../../src/protocol/native'

interface RequestCase {
  name: string
  valid: boolean
  message: unknown
}

interface ResponseCase {
  name: string
  hostValid: boolean
  request: NativeRequest
  message: unknown
  extensionResult?: unknown
}

interface Vectors {
  vectorSchemaVersion: number
  protocolVersion: number
  requestCases: RequestCase[]
  responseCases: ResponseCase[]
}

const root = resolve(import.meta.dirname, '..', '..')

const CONTRACTS = [
  { directory: 'v1', protocolVersion: PROTOCOL_VERSION },
  { directory: 'v2', protocolVersion: CARD_PROTOCOL_VERSION },
]

describe.each(CONTRACTS)('browser protocol vectors ($directory)', ({ directory, protocolVersion }) => {
  const downloaded = join(root, '.host-compat', directory, 'vectors.json')
  const vendored = join(root, 'contracts', 'browser', directory, 'vectors.json')
  const source = existsSync(downloaded) ? downloaded : vendored
  const vectors: Vectors = JSON.parse(readFileSync(source, 'utf8'))

  it('replays a protocol version this extension speaks', () => {
    expect(vectors.protocolVersion).toBe(protocolVersion)
  })

  it('carries cases in both directions', () => {
    expect(vectors.requestCases.length).toBeGreaterThan(0)
    expect(vectors.responseCases.length).toBeGreaterThan(0)
  })

  describe.each(vectors.requestCases)('request: $name', (testCase) => {
    it(`is ${testCase.valid ? 'accepted' : 'rejected'} by isNativeRequest`, () => {
      expect(isNativeRequest(testCase.message)).toBe(testCase.valid)
    })
  })

  describe.each(vectors.responseCases)('response: $name', (testCase) => {
    it('produces the result the desktop contract records', () => {
      const result = safeNativeResponse(testCase.message, testCase.request)
      // The v1 vectors record the exact extension result; the v2 card vectors
      // record only whether the host accepts the response.
      if (testCase.extensionResult !== undefined) {
        expect(result).toEqual(testCase.extensionResult)
        return
      }
      expect(result).toMatchObject({ ok: testCase.hostValid })
    })
  })
})
