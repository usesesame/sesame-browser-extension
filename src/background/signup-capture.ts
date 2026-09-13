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

export interface SaveSessionController {
  arm(tabId: number, origin: string): void
  isArmed(tabId: number): boolean
  handleTabUpdated(tabId: number, changeInfo: { url?: string }): void
  handleTabRemoved(tabId: number): void
  save(
    browser: Browser,
    tabId: number,
    payload: SignupCapturePayload,
    options?: { requestTimeoutMs?: number },
  ): Promise<{ ok: true } | { ok: false; code: string }>
}

export function createSaveSessionController(options: { ttlMs?: number } = {}): SaveSessionController {
  const ttlMs = options.ttlMs ?? ARM_TTL_MS
  const armed = new Map<number, { origin: string; timer: ReturnType<typeof setTimeout> }>()
  const saving = new Set<number>()

  function disarm(tabId: number) {
    const entry = armed.get(tabId)
    if (entry !== undefined) clearTimeout(entry.timer)
    armed.delete(tabId)
  }

  return {
    arm(tabId, origin) {
      disarm(tabId)
      armed.set(tabId, {
        origin,
        timer: setTimeout(() => armed.delete(tabId), ttlMs),
      })
    },

    isArmed(tabId) {
      return armed.has(tabId)
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
      if (!armed.has(tabId)) return { ok: false, code: 'save-not-armed' }
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
  }
}
