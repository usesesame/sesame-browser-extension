import { describe, expect, it, vi } from 'vitest'
import { EFF_WORDLIST } from '../../src/content/eff-wordlist'
import {
  makeRegistrationPassword,
  PASSPHRASE_DEFAULT_WORDS,
  PASSPHRASE_MAX_WORDS,
  PASSPHRASE_MIN_WORDS,
} from '../../src/content/registration'
import { passphraseWordCounts } from './passphrase-words'

function repeatingBytes(bytes: number[]) {
  let index = 0
  return (buffer: Uint8Array<ArrayBuffer>) => {
    for (let offset = 0; offset < buffer.length; offset += 1) {
      buffer[offset] = bytes[index % bytes.length]
      index += 1
    }
    return buffer
  }
}

function zeroBytes(buffer: Uint8Array<ArrayBuffer>) {
  buffer.fill(0)
  return buffer
}

describe('makeRegistrationPassword', () => {
  it('keeps the default at 20 characters with every character class', () => {
    const password = makeRegistrationPassword()
    expect(password).toHaveLength(20)
    expect(password).toMatch(/[A-Z]/)
    expect(password).toMatch(/[a-z]/)
    expect(password).toMatch(/\d/)
    expect(password).toMatch(/[!@#$%^&*()\-_=+]/)
  })

  it('honours an explicit length inside the existing bounds', () => {
    expect(makeRegistrationPassword({ length: 16 })).toHaveLength(16)
    expect(makeRegistrationPassword({ length: 64 })).toHaveLength(64)
  })

  it('refuses a length outside the existing bounds', () => {
    expect(() => makeRegistrationPassword({ length: 15 })).toThrow(RangeError)
    expect(() => makeRegistrationPassword({ length: 65 })).toThrow(RangeError)
    expect(() => makeRegistrationPassword({ length: 20.5 })).toThrow(RangeError)
  })

  it('draws from the injected random source', () => {
    const source = vi.fn(zeroBytes)
    const password = makeRegistrationPassword({ length: 16 }, source)
    expect(source).toHaveBeenCalled()
    expect(password).toHaveLength(16)
  })

  it('makes a default six-word passphrase from the EFF list', () => {
    const passphrase = makeRegistrationPassword({ mode: 'passphrase' })
    expect(passphraseWordCounts(passphrase)).toContain(PASSPHRASE_DEFAULT_WORDS)
  })

  it('counts hyphenated list words as one word', () => {
    expect(passphraseWordCounts('t-shirt-yo-yo-abacus')).toEqual([3])
    expect(passphraseWordCounts('drop-down-felt-tip')).toEqual([2])
    expect(passphraseWordCounts('abacus-qqqq')).toEqual([])
  })

  it('honours an explicit word count inside the bounds', () => {
    expect(passphraseWordCounts(makeRegistrationPassword({ mode: 'passphrase', words: PASSPHRASE_MIN_WORDS })))
      .toContain(PASSPHRASE_MIN_WORDS)
    expect(passphraseWordCounts(makeRegistrationPassword({ mode: 'passphrase', words: PASSPHRASE_MAX_WORDS })))
      .toContain(PASSPHRASE_MAX_WORDS)
  })

  it('refuses a word count outside the bounds', () => {
    expect(() => makeRegistrationPassword({ mode: 'passphrase', words: PASSPHRASE_MIN_WORDS - 1 })).toThrow(RangeError)
    expect(() => makeRegistrationPassword({ mode: 'passphrase', words: PASSPHRASE_MAX_WORDS + 1 })).toThrow(RangeError)
  })

  it('maps sampled words to the list and rejects out-of-range samples', () => {
    const passphrase = makeRegistrationPassword(
      { mode: 'passphrase', words: 5 },
      repeatingBytes([0xff, 0xff, 0x00, 0x01]),
    )
    expect(passphrase).toBe('abdomen-abdomen-abdomen-abdomen-abdomen')
  })

  it('uses the first word when the sample is zero', () => {
    expect(makeRegistrationPassword({ mode: 'passphrase', words: 5 }, zeroBytes))
      .toBe('abacus-abacus-abacus-abacus-abacus')
  })
})

describe('the vendored EFF word list', () => {
  it('holds the 7776 unique long-list words', () => {
    expect(EFF_WORDLIST).toHaveLength(7776)
    expect(new Set(EFF_WORDLIST).size).toBe(7776)
    expect(EFF_WORDLIST[0]).toBe('abacus')
    expect(EFF_WORDLIST.at(-1)).toBe('zoom')
  })
})
