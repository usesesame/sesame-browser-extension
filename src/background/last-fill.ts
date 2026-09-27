import type { FillMatchKind } from '../protocol/native'

export const LAST_FILL_TTL_MS = 120_000

export interface LastFillSummary {
  usernameFilled: boolean
  passwordFilled: boolean
  matchKind: FillMatchKind
}

export interface LastFillRecord extends LastFillSummary {
  state: 'filled'
  tabId: number
  recordedAt: number
}

export interface LastFillTracker {
  record(tabId: number, summary: LastFillSummary): void
  lookup(tabId: number): LastFillRecord | undefined
  clear(tabId: number): void
}

export function createLastFillTracker(now: () => number = Date.now): LastFillTracker {
  const records = new Map<number, LastFillRecord>()
  return {
    record(tabId, summary) {
      if (!Number.isInteger(tabId)) return
      records.set(tabId, {
        state: 'filled',
        usernameFilled: summary.usernameFilled,
        passwordFilled: summary.passwordFilled,
        matchKind: summary.matchKind,
        tabId,
        recordedAt: now(),
      })
    },
    lookup(tabId) {
      const record = records.get(tabId)
      if (!record) return undefined
      if (now() - record.recordedAt > LAST_FILL_TTL_MS) {
        records.delete(tabId)
        return undefined
      }
      return record
    },
    clear(tabId) {
      records.delete(tabId)
    },
  }
}
