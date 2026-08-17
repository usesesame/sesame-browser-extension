import { requestSave } from './native-connection'
import type { Browser } from '../platform/chrome'
import { MAX_CREDENTIAL_FIELD, normalizeFillOrigin } from '../protocol/native'

export interface SignupCapturePayload {
  origin: string
  username: string
  password: string
  /// Content script decides kind from the form.
  kind: 'new' | 'update'
}

interface PendingCapture extends SignupCapturePayload {
  timer: ReturnType<typeof setTimeout>
}

// Origin from the delivering frame, never the message.
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

const CAPTURE_TTL_MS = 5 * 60_000

export interface SignupCaptureController {
  capture(tabId: number, payload: SignupCapturePayload): void
  handleTabUpdated(tabId: number, changeInfo: { url?: string }): void
  handleTabRemoved(tabId: number): void
}

// In-memory only, never chrome.storage: a restart drops the capture.
export function createSignupCaptureController(
  browser: Browser,
  options: { ttlMs?: number; requestTimeoutMs?: number } = {},
): SignupCaptureController {
  const ttlMs = options.ttlMs ?? CAPTURE_TTL_MS
  const pending = new Map<number, PendingCapture>()

  function discard(tabId: number) {
    const capture = pending.get(tabId)
    if (!capture) return
    clearTimeout(capture.timer)
    capture.username = ''
    capture.password = ''
    pending.delete(tabId)
  }

  return {
    capture(tabId, payload) {
      discard(tabId)
      pending.set(tabId, {
        ...payload,
        timer: setTimeout(() => discard(tabId), ttlMs),
      })
    },

    handleTabUpdated(tabId, changeInfo) {
      if (typeof changeInfo.url !== 'string') return
      const capture = pending.get(tabId)
      if (!capture) return
      clearTimeout(capture.timer)
      pending.delete(tabId)
      const { origin, username, password, kind } = capture
      void requestSave(browser, origin, { username, password, kind }, { timeoutMs: options.requestTimeoutMs }).catch(() => {})
      capture.username = ''
      capture.password = ''
    },

    handleTabRemoved(tabId) {
      discard(tabId)
    },
  }
}
