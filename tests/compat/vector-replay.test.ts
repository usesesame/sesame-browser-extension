import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION, isNativeRequest, safeNativeResponse, type NativeRequest } from '../../src/protocol/native'

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
  extensionResult: unknown
}

interface Vectors {
  vectorSchemaVersion: number
  protocolVersion: number
  requestCases: RequestCase[]
  responseCases: ResponseCase[]
}

const root = resolve(import.meta.dirname, '..', '..')
// host-compatibility.mjs writes the freshly downloaded fixtures here. Preferring
// them means CI replays what the desktop publishes today, while a plain local run
// still replays the vendored snapshot rather than skipping.
const downloaded = join(root, '.host-compat', 'vectors.json')
const vendored = join(root, 'contracts', 'browser', 'v1', 'vectors.json')
const source = existsSync(downloaded) ? downloaded : vendored
const vectors: Vectors = JSON.parse(readFileSync(source, 'utf8'))

describe(`browser protocol vectors (${source === downloaded ? 'downloaded' : 'vendored'})`, () => {
  it('replays a protocol version this extension speaks', () => {
    expect(vectors.protocolVersion).toBe(PROTOCOL_VERSION)
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
      expect(safeNativeResponse(testCase.message, testCase.request)).toEqual(testCase.extensionResult)
    })
  })
})
