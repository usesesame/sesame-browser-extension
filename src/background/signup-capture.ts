import { requestSave } from './native-connection'
import type { Browser } from '../platform/chrome'
import { MAX_CREDENTIAL_FIELD, normalizeFillOrigin } from '../protocol/native'

export interface SignupCapturePayload {
  origin: string
  username: string
  password: string
  kind: 'new' | 'update'
}

export function safeSignupCapturePayload(
  message: unknown,
  senderUrl: string | undefined,
): SignupCapturePayload | null {
  if (typeof message !== 'object' || message === null) return null
  const { origin, username, password, kind } = message as Record<string, unknown>
  const claimedOrigin = normalizeFillOrigin(origin)
  if (!claimedOrigin) return null
  const frameOrigin = normalizeFillOrigin(senderUrl === undefined ? null : originOf(senderUrl))
  if (!frameOrigin || frameOrigin !== claimedOrigin) return null
  if (typeof password !== 'string' || password.length === 0 || password.length > MAX_CREDENTIAL_FIELD) return null
  if (typeof username !== 'string' || username.length > MAX_CREDENTIAL_FIELD) return null
  if (kind !== 'new' && kind !== 'update') return null
  return { origin: claimedOrigin, username, password, kind }
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

const ARM_TTL_MS = 10 * 60_000

export interface HeldSaveCapture {
  username: string
  password: string
}

export interface SaveSessionController {
  arm(tabId: number, origin: string, capture?: HeldSaveCapture): void
  isArmed(tabId: number): boolean
  hasHeldCapture(tabId: number): boolean
  handleTabUpdated(tabId: number, changeInfo: { url?: string }): void
  handleTabRemoved(tabId: number): void
  save(
    browser: Browser,
    tabId: number,
    payload: SignupCapturePayload,
    options?: { requestTimeoutMs?: number },
  ): Promise<{ ok: true } | { ok: false; code: string }>
  saveHeld(
    browser: Browser,
    tabId: number,
    options?: { requestTimeoutMs?: number },
  ): Promise<{ ok: true } | { ok: false; code: string }>
}

export function createSaveSessionController(options: { ttlMs?: number } = {}): SaveSessionController {
  const ttlMs = options.ttlMs ?? ARM_TTL_MS
  const armed = new Map<number, { origin: string; timer: ReturnType<typeof setTimeout>; capture?: HeldSaveCapture }>()
  const saving = new Set<number>()

  function disarm(tabId: number) {
    const entry = armed.get(tabId)
    if (entry !== undefined) {
      clearTimeout(entry.timer)
      if (entry.capture) {
        entry.capture.username = ''
        entry.capture.password = ''
      }
    }
    armed.delete(tabId)
  }

  return {
    arm(tabId, origin, capture) {
      disarm(tabId)
      armed.set(tabId, {
        origin,
        timer: setTimeout(() => disarm(tabId), ttlMs),
        capture,
      })
    },

    isArmed(tabId) {
      return armed.has(tabId)
    },

    hasHeldCapture(tabId) {
      return armed.get(tabId)?.capture !== undefined
    },

    handleTabUpdated(tabId, changeInfo) {
      if (typeof changeInfo.url !== 'string') return
      const entry = armed.get(tabId)
      if (!entry) return
      const nextOrigin = originOf(changeInfo.url)
      if (nextOrigin !== entry.origin) disarm(tabId)
    },

    handleTabRemoved(tabId) {
      disarm(tabId)
      saving.delete(tabId)
    },

    async save(browser, tabId, payload, saveOptions) {
      const entry = armed.get(tabId)
      if (!entry) return { ok: false, code: 'save-not-armed' }
      if (payload.origin !== entry.origin) return { ok: false, code: 'save-origin-mismatch' }
      if (saving.has(tabId)) return { ok: false, code: 'save-in-progress' }
      saving.add(tabId)
      try {
        const result = await requestSave(browser, payload.origin, {
          username: payload.username,
          password: payload.password,
          kind: payload.kind,
        }, { timeoutMs: saveOptions?.requestTimeoutMs })
        if (result.ok) disarm(tabId)
        return result.ok ? { ok: true } : { ok: false, code: result.code }
      } catch {
        return { ok: false, code: 'save-failed' }
      } finally {
        saving.delete(tabId)
      }
    },

    async saveHeld(browser, tabId, saveOptions) {
      const entry = armed.get(tabId)
      if (!entry?.capture) return { ok: false, code: 'save-not-armed' }
      if (saving.has(tabId)) return { ok: false, code: 'save-in-progress' }
      saving.add(tabId)
      try {
        const result = await requestSave(browser, entry.origin, {
          username: entry.capture.username,
          password: entry.capture.password,
          kind: 'update',
        }, { timeoutMs: saveOptions?.requestTimeoutMs })
        if (result.ok) disarm(tabId)
        return result.ok ? { ok: true } : { ok: false, code: result.code }
      } catch {
        return { ok: false, code: 'save-failed' }
      } finally {
        saving.delete(tabId)
      }
    },
  }
}
