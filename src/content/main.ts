import { inspectLoginSurface } from './field-detector'
import { fillLoginSurface } from './field-writer'
import { inspectIdentitySurface } from './identity-detector'
import { fillIdentitySurface } from './identity-writer'
import { inspectCardSurface } from './card-detector'
import { fillCardSurface } from './card-writer'
import { attachInlineButton } from './overlay'
import { fillPasswordChangeSurface } from './password-change'
import { fillRegistrationSurface, inspectPasswordSurface, inspectRegistrationSurface } from './registration'
import { saveCurrentLogin } from './signup-capture'

type GlobalApi = {
  sesameInspectLoginSurface: typeof inspectLoginSurface
  sesameFillLoginSurface: typeof fillLoginSurface
  sesameInspectIdentitySurface: typeof inspectIdentitySurface
  sesameFillIdentitySurface: typeof fillIdentitySurface
  sesameInspectCardSurface: typeof inspectCardSurface
  sesameFillCardSurface: typeof fillCardSurface
  sesameFillRegistrationSurface: typeof fillRegistrationSurface
  sesameInspectRegistrationSurface: typeof inspectRegistrationSurface
  sesameInspectPasswordSurface: typeof inspectPasswordSurface
  sesameFillPasswordChangeSurface: typeof fillPasswordChangeSurface
  sesameSaveCurrentLogin: typeof saveCurrentLogin
  sesameAttachInlineButton: () => (() => void) | undefined
  sesameDetachInlineButton: (() => void) | undefined
}

const api: GlobalApi = {
  sesameInspectLoginSurface: inspectLoginSurface,
  sesameFillLoginSurface: fillLoginSurface,
  sesameInspectIdentitySurface: inspectIdentitySurface,
  sesameFillIdentitySurface: fillIdentitySurface,
  sesameInspectCardSurface: inspectCardSurface,
  sesameFillCardSurface: fillCardSurface,
  sesameFillRegistrationSurface: fillRegistrationSurface,
  sesameInspectRegistrationSurface: inspectRegistrationSurface,
  sesameInspectPasswordSurface: inspectPasswordSurface,
  sesameFillPasswordChangeSurface: fillPasswordChangeSurface,
  sesameSaveCurrentLogin: saveCurrentLogin,
  sesameAttachInlineButton: () => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return undefined
    return attachInlineButton({
      onFillRequest: () => chrome.runtime.sendMessage({ type: 'sesame:autofill' }),
      onConnectionCheck: (force = false) => chrome.runtime.sendMessage({ type: 'sesame:connect', force }),
      onOpenDesktop: () => chrome.runtime.sendMessage({ type: 'sesame:open-desktop' }),
      onFillIdentityRequest: () => chrome.runtime.sendMessage({ type: 'sesame:autofill-identity' }),
      onFillCardRequest: () => chrome.runtime.sendMessage({ type: 'sesame:autofill-card' }),
    })
  },
  sesameDetachInlineButton: undefined,
}

const live = window as unknown as Partial<GlobalApi>
Object.assign(window as unknown as Record<string, unknown>, api, {
  sesameDetachInlineButton: live.sesameDetachInlineButton,
})

export {
  inspectLoginSurface,
  fillLoginSurface,
  inspectIdentitySurface,
  fillIdentitySurface,
  inspectCardSurface,
  fillCardSurface,
  fillRegistrationSurface,
  inspectRegistrationSurface,
  inspectPasswordSurface,
  fillPasswordChangeSurface,
  saveCurrentLogin,
  attachInlineButton,
}
