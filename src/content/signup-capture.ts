import { captureSignupSubmission, captureUpdateSubmission } from './registration'

export type CredentialCapture =
  | { kind: 'new'; origin: string; username: string; password: string }
  | { kind: 'update'; origin: string; username: string; password: string }

export interface SignupCaptureOptions {
  onCapture(payload: CredentialCapture): void
}

// Capture-phase, never preventDefault(); isTrusted gates forged submits.
export function attachSignupCapture(options: SignupCaptureOptions): () => void {
  function onSubmit(event: Event) {
    if (!event.isTrusted) return
    const signup = captureSignupSubmission()
    if (signup) {
      options.onCapture({ kind: 'new', ...signup })
      return
    }
    const update = captureUpdateSubmission()
    if (update) options.onCapture({ kind: 'update', ...update })
  }
  document.addEventListener('submit', onSubmit, true)
  return () => document.removeEventListener('submit', onSubmit, true)
}

export function ensureSignupCapture(): (() => void) | undefined {
  const current = globalThis as typeof globalThis & {
    sesameAttachSignupCapture?: () => (() => void) | undefined
    sesameDetachSignupCapture?: (() => void) | undefined
  }
  current.sesameDetachSignupCapture?.()
  current.sesameDetachSignupCapture = current.sesameAttachSignupCapture?.()
  return current.sesameDetachSignupCapture
}
