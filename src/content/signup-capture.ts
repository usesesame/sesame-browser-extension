import { captureSignupSubmission, captureUpdateSubmission } from './registration'

export type SaveActionOutcome = { ok: true } | { ok: false; code: string }

export async function saveCurrentLogin(): Promise<SaveActionOutcome> {
  const registration = captureSignupSubmission()
  const update = registration ? null : captureUpdateSubmission()
  const capture = registration
    ? { kind: 'new' as const, origin: registration.origin, username: registration.username, password: registration.password }
    : update
      ? { kind: 'update' as const, origin: update.origin, username: update.username, password: update.password }
      : null
  if (!capture) return { ok: false, code: 'no-password' }
  try {
    const response = await chrome.runtime.sendMessage({ type: 'sesame:capture-signup', ...capture }) as unknown
    if (typeof response === 'object' && response !== null && (response as { ok?: unknown }).ok === true) {
      return { ok: true }
    }
    const code = typeof response === 'object' && response !== null && typeof (response as { code?: unknown }).code === 'string'
      ? (response as { code: string }).code
      : 'save-failed'
    return { ok: false, code }
  } catch {
    return { ok: false, code: 'save-failed' }
  } finally {
    capture.username = ''
    capture.password = ''
    if (registration) {
      registration.username = ''
      registration.password = ''
    }
    if (update) {
      update.username = ''
      update.password = ''
    }
  }
}
