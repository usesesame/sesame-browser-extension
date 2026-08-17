import './main'

type OverlayApi = typeof globalThis & {
  sesameAttachInlineButton?: () => (() => void) | undefined
  sesameDetachInlineButton?: (() => void) | undefined
  sesameEnsureSignupCapture?: () => (() => void) | undefined
  sesameOverlayLoadGeneration?: number
}

const api = globalThis as OverlayApi
const loadGeneration = (api.sesameOverlayLoadGeneration ?? 0) + 1
api.sesameOverlayLoadGeneration = loadGeneration

async function attach() {
  try {
    const policy = await chrome.runtime.sendMessage({ type: 'sesame:inline-policy' })
    if (policy?.enabled !== true || api.sesameOverlayLoadGeneration !== loadGeneration) return
  } catch {
    return
  }
  api.sesameDetachInlineButton?.()
  api.sesameDetachInlineButton = api.sesameAttachInlineButton?.()
  api.sesameEnsureSignupCapture?.()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { void attach() }, { once: true })
} else {
  void attach()
}
