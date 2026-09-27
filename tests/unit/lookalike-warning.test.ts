import { describe, expect, it } from 'vitest'
import { lookalikeWarning, lookalikeWarningForResult } from '../../src/shared/lookalike-warning'

const warningFor = (host: string): string =>
  `This page looks like ${host}, a site you saved, but the address is different. Sesame did not fill anything. Check the address bar before you sign in.`

const UNNAMED =
  'This page looks like a site you saved, but the address is different. Sesame did not fill anything. Check the address bar before you sign in.'

describe('lookalike warning copy', () => {
  it('names the stored host in the approved copy', () => {
    expect(lookalikeWarning('apple.example')).toBe(warningFor('apple.example'))
  })

  it('shows the same copy for the popup fill result', () => {
    expect(lookalikeWarningForResult({
      state: 'unavailable',
      code: 'lookalike-domain',
      lookalike: 'apple.example',
    })).toBe(warningFor('apple.example'))
  })

  it('leaves an unrelated result without a warning', () => {
    expect(lookalikeWarningForResult({ state: 'unavailable', code: 'no-match' })).toBeNull()
    expect(lookalikeWarningForResult({ state: 'filled', matchKind: 'exact' })).toBeNull()
    expect(lookalikeWarningForResult({ state: 'unavailable', code: 'vault-locked' })).toBeNull()
    expect(lookalikeWarningForResult(undefined)).toBeNull()
  })

  it('never pulls a credential or an action into the warning', () => {
    const warning = lookalikeWarningForResult({
      state: 'unavailable',
      code: 'lookalike-domain',
      lookalike: 'apple.example',
      credential: { username: 'leaked-user', password: 'leaked-password' },
      action: 'Fill anyway',
    })
    expect(warning).toBe(warningFor('apple.example'))
    expect(warning).not.toMatch(/leaked|Fill anyway/)
  })

  it('falls back to an unnamed warning when the host is unusable', () => {
    for (const host of [undefined, null, 7, '', '   ', '\u202e']) {
      expect(lookalikeWarning(host), String(host)).toBe(UNNAMED)
    }
  })

  it('strips control and bidi characters and bounds the display host', () => {
    expect(lookalikeWarning('apple.example\u0000')).toBe(warningFor('apple.example'))
    expect(lookalikeWarning('apple\u202e.example')).toBe(warningFor('apple.example'))
    expect(lookalikeWarning('  apple.example  ')).toBe(warningFor('apple.example'))
    expect(lookalikeWarning('a'.repeat(200))).toBe(warningFor('a'.repeat(128)))
  })
})
