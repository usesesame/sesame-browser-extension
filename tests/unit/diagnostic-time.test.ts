import { describe, expect, it } from 'vitest'
import { formatCheckTime } from '../../src/protocol/diagnostics'

describe('formatCheckTime', () => {
  const now = new Date(2026, 9, 4, 15, 0, 0)

  it('shows today with the local time and no ISO markers', () => {
    const text = formatCheckTime(new Date(2026, 9, 4, 14, 32, 5).toISOString(), now)
    expect(text).toMatch(/^Today, /)
    expect(text).toMatch(/32/)
    expect(text).not.toMatch(/T\d|Z$/)
  })

  it('shows the date for an earlier day', () => {
    const text = formatCheckTime(new Date(2026, 9, 2, 9, 5, 0).toISOString(), now)
    expect(text).not.toMatch(/^Today/)
    expect(text).toMatch(/2/)
  })

  it('names a missing or invalid value as unknown', () => {
    expect(formatCheckTime(undefined, now)).toBe('Unknown')
    expect(formatCheckTime('not a date', now)).toBe('Unknown')
    expect(formatCheckTime(42, now)).toBe('Unknown')
  })
})
