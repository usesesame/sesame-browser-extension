import { describe, expect, it } from 'vitest'
import { LAST_FILL_TTL_MS, createLastFillTracker } from '../../src/background/last-fill'

describe('last fill tracker', () => {
  it('holds only the non-secret summary for a tab', () => {
    const tracker = createLastFillTracker(() => 1_000)
    tracker.record(4, { usernameFilled: true, passwordFilled: true, matchKind: 'exact' })

    const record = tracker.lookup(4)
    expect(record).toEqual({
      state: 'filled',
      usernameFilled: true,
      passwordFilled: true,
      matchKind: 'exact',
      tabId: 4,
      recordedAt: 1_000,
    })
    expect(Object.keys(record!).sort()).toEqual([
      'matchKind', 'passwordFilled', 'recordedAt', 'state', 'tabId', 'usernameFilled',
    ])
  })

  it('keeps one tab from reading another tab result', () => {
    const tracker = createLastFillTracker(() => 1_000)
    tracker.record(4, { usernameFilled: true, passwordFilled: false, matchKind: 'wwwAlias' })

    expect(tracker.lookup(5)).toBeUndefined()
    expect(tracker.lookup(4)?.matchKind).toBe('wwwAlias')
  })

  it('replaces the previous summary for the same tab', () => {
    const tracker = createLastFillTracker(() => 1_000)
    tracker.record(4, { usernameFilled: true, passwordFilled: false, matchKind: 'exact' })
    tracker.record(4, { usernameFilled: false, passwordFilled: true, matchKind: 'wwwAlias' })

    expect(tracker.lookup(4)).toMatchObject({
      usernameFilled: false,
      passwordFilled: true,
      matchKind: 'wwwAlias',
    })
  })

  it('drops a record once it ages past two minutes', () => {
    let now = 1_000
    const tracker = createLastFillTracker(() => now)
    tracker.record(4, { usernameFilled: true, passwordFilled: true, matchKind: 'exact' })

    now += LAST_FILL_TTL_MS
    expect(tracker.lookup(4)).toBeDefined()
    now += 1
    expect(tracker.lookup(4)).toBeUndefined()
    now -= LAST_FILL_TTL_MS + 1
    expect(tracker.lookup(4)).toBeUndefined()
  })

  it('clears a tab on navigation or close', () => {
    const tracker = createLastFillTracker(() => 1_000)
    tracker.record(4, { usernameFilled: true, passwordFilled: true, matchKind: 'exact' })
    tracker.clear(4)

    expect(tracker.lookup(4)).toBeUndefined()
  })
})
