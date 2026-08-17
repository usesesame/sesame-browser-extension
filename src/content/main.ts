import { inspectLoginSurface } from './field-detector'
import { fillLoginSurface } from './field-writer'
import { inspectIdentitySurface } from './identity-detector'
import { fillIdentitySurface } from './identity-writer'
import { attachInlineButton } from './overlay'
import { fillRegistrationSurface, inspectPasswordSurface, inspectRegistrationSurface } from './registration'
import { attachSignupCapture, ensureSignupCapture } from './signup-capture'

type GlobalApi = {
  sesameInspectLoginSurface: typeof inspectLoginSurface
  sesameFillLoginSurface: typeof fillLoginSurface
  sesameInspectIdentitySurface: typeof inspectIdentitySurface
  sesameFillIdentitySurface: typeof fillIdentitySurface
  sesameFillRegistrationSurface: typeof fillRegistrationSurface
  sesameInspectRegistrationSurface: typeof inspectRegistrationSurface
  sesameInspectPasswordSurface: typeof inspectPasswordSurface
  sesameAttachInlineButton: () => (() => void) | undefined
  sesameDetachInlineButton: (() => void) | undefined
  sesameAttachSignupCapture: () => (() => void) | undefined
  sesameDetachSignupCapture: (() => void) | undefined
  sesameEnsureSignupCapture: () => (() => void) | undefined
}

const api: GlobalApi = {
  sesameInspectLoginSurface: inspectLoginSurface,
  sesameFillLoginSurface: fillLoginSurface,
  sesameInspectIdentitySurface: inspectIdentitySurface,
  sesameFillIdentitySurface: fillIdentitySurface,
  sesameFillRegistrationSurface: fillRegistrationSurface,
  sesameInspectRegistrationSurface: inspectRegistrationSurface,
  sesameInspectPasswordSurface: inspectPasswordSurface,
  sesameAttachInlineButton: () => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return undefined
    return attachInlineButton({
      onFillRequest: () => chrome.runtime.sendMessage({ type: 'sesame:autofill' }),
      onConnectionCheck: (force = false) => chrome.runtime.sendMessage({ type: 'sesame:connect', force }),
      onOpenDesktop: () => chrome.runtime.sendMessage({ type: 'sesame:open-desktop' }),
      onFillIdentityRequest: () => chrome.runtime.sendMessage({ type: 'sesame:autofill-identity' }),
    })
  },
  sesameDetachInlineButton: undefined,
  sesameAttachSignupCapture: () => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return undefined
    return attachSignupCapture({
      onCapture: (payload) => {
        void chrome.runtime.sendMessage({ type: 'sesame:capture-signup', ...payload })
      },
    })
  },
  sesameDetachSignupCapture: undefined,
  sesameEnsureSignupCapture: () => ensureSignupCapture(),
}

Object.assign(window as unknown as Record<string, unknown>, api)

export {
  inspectLoginSurface,
  fillLoginSurface,
  inspectIdentitySurface,
  fillIdentitySurface,
  fillRegistrationSurface,
  inspectRegistrationSurface,
  inspectPasswordSurface,
  attachInlineButton,
  attachSignupCapture,
  ensureSignupCapture,
}
