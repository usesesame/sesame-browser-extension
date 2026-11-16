import { isHandle, normalizeFillOrigin } from '../protocol/native'
import { isRecord } from '../shared/values'

export type PendingKind = 'change' | 'new'

export interface PendingEntry {
  handle: string
  origin: string
  kind: PendingKind
  createdAt: number
}

export interface SessionArea {
  get(keys: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
  remove(keys: string): Promise<void>
}

export interface PendingStore {
  remember(tabId: number, entry: PendingEntry): Promise<void>
  lookup(tabId: number, origin: string | null): Promise<PendingEntry | undefined>
  forget(tabId: number): Promise<void>
  forgetHandle(tabId: number, handle: string): Promise<void>
}

export const PENDING_TTL_MS = 24 * 60 * 60_000
const KEY_PREFIX = 'sesame:pending:'
const ENTRY_KEYS = ['handle', 'origin', 'kind', 'createdAt']

export function pendingKey(tabId: number): string {
  return `${KEY_PREFIX}${tabId}`
}

export function safePendingEntry(value: unknown): PendingEntry | null {
  if (!isRecord(value)) return null
  const keys = Object.keys(value)
  if (keys.length !== ENTRY_KEYS.length || !ENTRY_KEYS.every((key) => keys.includes(key))) return null
  const origin = normalizeFillOrigin(value.origin)
  if (!isHandle(value.handle) || !origin || origin !== value.origin) return null
  if (value.kind !== 'change' && value.kind !== 'new') return null
  if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)) return null
  return { handle: value.handle, origin, kind: value.kind, createdAt: value.createdAt }
}

export function createPendingStore(area: SessionArea, now: () => number = Date.now, ttlMs = PENDING_TTL_MS): PendingStore {
  const memory = new Map<number, PendingEntry>()
  const generations = new Map<number, number>()

  function generation(tabId: number): number {
    return generations.get(tabId) ?? 0
  }

  function advance(tabId: number) {
    generations.set(tabId, generation(tabId) + 1)
  }

  async function forget(tabId: number) {
    advance(tabId)
    memory.delete(tabId)
    try { await area.remove(pendingKey(tabId)) } catch { /* noop */ }
  }

  return {
    async remember(tabId, entry) {
      const safe = safePendingEntry(entry)
      if (!Number.isInteger(tabId) || !safe) return
      advance(tabId)
      memory.set(tabId, safe)
      try { await area.set({ [pendingKey(tabId)]: { ...safe } }) } catch { /* noop */ }
    },

    async lookup(tabId, origin) {
      if (!Number.isInteger(tabId) || !origin) return undefined
      let entry = memory.get(tabId)
      if (!entry) {
        const started = generation(tabId)
        try {
          const stored = await area.get(pendingKey(tabId))
          entry = safePendingEntry(stored[pendingKey(tabId)]) ?? undefined
        } catch {
          entry = undefined
        }
        if (generation(tabId) !== started) entry = memory.get(tabId)
        else if (entry) memory.set(tabId, entry)
      }
      if (!entry) return undefined
      if (now() - entry.createdAt >= ttlMs || now() < entry.createdAt) {
        await forget(tabId)
        return undefined
      }
      return entry.origin === origin ? { ...entry } : undefined
    },

    forget,

    async forgetHandle(tabId, handle) {
      if (memory.get(tabId)?.handle !== handle) return
      await forget(tabId)
    },
  }
}
