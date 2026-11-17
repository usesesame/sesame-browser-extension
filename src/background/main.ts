import { createCoordinator } from './coordinator'
import { chromeBrowser } from '../platform/chrome'
import { NATIVE_HOST, normalizeFillOrigin } from '../protocol/native'
import { createInlineRegistrationSync, syncInlineContentScript } from './inline-registration'
import { handleExtensionCommand } from './command-handler'
import { createContextMenuFillHandler, ensureFillContextMenu } from './context-menu'
import { INLINE_SETTINGS_KEY, loadInlineSettings, normalizePausedOrigins, pauseChangedOrigins } from '../permissions/inline-access'
import { publicFillResult, type PublicFillResult } from './fill-result'
import { createLastFillTracker } from './last-fill'
import { createPopupResultRelay } from './popup-result'
import { openDesktop } from './native-connection'
import { createSaveSessionController, safeSignupCapturePayload } from './signup-capture'
import { createPendingStore } from './pending-passwords'
import { captureSignupUsernameInPage, createGeneratedPasswords, createPasswordSenderPage, safePasswordStyle } from './generated-passwords'
import type { FillContext } from './fill-state'
import { createMissedResultNotice } from './missed-result'

const coordinator = createCoordinator(chromeBrowser)
const saveSession = createSaveSessionController()
const lastFill = createLastFillTracker()
const pendingStore = createPendingStore(chrome.storage.session)
const generatedPasswords = createGeneratedPasswords({
  coordinator,
  store: pendingStore,
  browser: chromeBrowser,
  tabOrigin: async (tabId) => fillPageOrigin((await chrome.tabs.get(tabId)).url),
  captureUsername: async (tabId, origin) => {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
    const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: captureSignupUsernameInPage, args: [origin] })
    return typeof injection?.result === 'string' ? injection.result : ''
  },
})
const CONNECTION_CACHE_MS = 4_000
let cachedConnection: { checkedAt: number; value: Awaited<ReturnType<typeof coordinator.checkConnection>> } | undefined
let connectionCheck: Promise<Awaited<ReturnType<typeof coordinator.checkConnection>>> | undefined
const missedResults = createMissedResultNotice(chrome.action, chrome.runtime.getManifest().action?.default_title ?? 'Sesame')

async function checkConnection(force = false) {
  if (!force && cachedConnection && Date.now() - cachedConnection.checkedAt < CONNECTION_CACHE_MS) {
    return cachedConnection.value
  }
  if (connectionCheck) return connectionCheck
  connectionCheck = coordinator.checkConnection().then((value) => {
    cachedConnection = { checkedAt: Date.now(), value }
    return value
  }).finally(() => { connectionCheck = undefined })
  return connectionCheck
}

async function fillCardWhenEnabled() {
  const settings = await loadInlineSettings()
  return settings.cardSuggestionsEnabled
    ? coordinator.fillCardActivePage()
    : { ok: false as const, code: 'card-suggestions-disabled' }
}

const ensureContentScriptRegistered = createInlineRegistrationSync(() =>
  syncInlineContentScript({ permissions: chrome.permissions, scripting: chrome.scripting }))

const handleFillContextMenuClick = createContextMenuFillHandler({
  queryActiveTab: async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0],
  fillActivePage: () => coordinator.fillActivePage(),
  toPublicResult: publicFillResult,
  showStatus: (tabId, result) => presentFillStatus(tabId, result),
})

async function refreshInlineRegistration() {
  await ensureContentScriptRegistered()
}

async function reconcileOpenTabs(onlyOrigins?: readonly string[]) {
  if (onlyOrigins?.length === 0) return
  const settings = await loadInlineSettings()
  const tabs = await chrome.tabs.query({})
  await Promise.allSettled(tabs.flatMap((tab) => {
    if (!Number.isInteger(tab.id)) return []
    const origin = safeSenderOrigin(tab.url)
    if (!origin || (onlyOrigins && !onlyOrigins.includes(origin))) return []
    if (settings.pausedOrigins.includes(origin)) {
      return [chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: detachInlineOverlay })]
    }
    return [chrome.scripting.executeScript({ target: { tabId: tab.id! }, files: ['content-overlay.js'] })]
  }))
}

async function syncInlineAccess() {
  await refreshInlineRegistration()
  await reconcileOpenTabs()
}

chrome.permissions.onAdded.addListener(() => { void syncInlineAccess() })
chrome.permissions.onRemoved.addListener(() => {
  coordinator.cancelActive()
  void syncInlineAccess()
})
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !(INLINE_SETTINGS_KEY in changes)) return
  coordinator.cancelActive()
  const change = changes[INLINE_SETTINGS_KEY]
  void reconcileOpenTabs(pauseChangedOrigins(change.oldValue, change.newValue))
})
chrome.runtime.onInstalled.addListener((details) => {
  void syncInlineAccess()
  void ensureFillContextMenu(chrome.contextMenus)
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') })
  }
})
chrome.runtime.onStartup.addListener(() => {
  void syncInlineAccess()
  void ensureFillContextMenu(chrome.contextMenus)
})
chrome.commands.onCommand.addListener((command) => {
  void handleExtensionCommand(command, coordinator).then((handled) => {
    if (handled && command === 'fill-login') recordLastFillResult(coordinator.state())
  })
})
chrome.contextMenus.onClicked.addListener((info, tab) => { void handleFillContextMenuClick(info, tab) })
void refreshInlineRegistration()
void ensureFillContextMenu(chrome.contextMenus)

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  saveSession.handleTabUpdated(tabId, changeInfo)
  if (typeof changeInfo.url === 'string' || changeInfo.status === 'loading') {
    lastFill.clear(tabId)
    missedResults.forget(tabId)
    coordinator.cancelActive(tabId)
  }
})
chrome.tabs.onRemoved.addListener((tabId) => {
  saveSession.handleTabRemoved(tabId)
  void pendingStore.forget(tabId)
  lastFill.clear(tabId)
  coordinator.cancelActive(tabId)
  missedResults.forget(tabId)
})

function recordLastFillResult(result: FillContext): void {
  const phase = result.phase
  if (phase.name !== 'complete') return
  chrome.tabs.query({ active: true, currentWindow: true })
    .then(([tab]) => {
      const tabId = tab?.id
      if (typeof tabId === 'number' && Number.isInteger(tabId)) {
        lastFill.record(tabId, {
          usernameFilled: phase.usernameFilled,
          passwordFilled: phase.passwordFilled,
          matchKind: phase.matchKind,
        })
      }
    })
    .catch(() => { /* noop */ })
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.sender?.id !== chrome.runtime.id || port.sender?.url !== chrome.runtime.getURL('popup.html')) {
    try { port.disconnect() } catch { /* noop */ }
    return
  }
  if (port.name === 'sesame:fill') {
    let started = false
    port.onMessage.addListener((message) => {
      if (started || message?.type !== 'start') return
      started = true
      const deliver = popupResultRelay(port)
      coordinator.fillActivePage().then((result) => {
        recordLastFillResult(result)
        const publicResult = publicFillResult(result)
        void deliver(publicResult, publicResult)
      }).catch(() => {
        const failed: PublicFillResult = { state: 'unavailable', code: 'fill-failed' }
        void deliver(failed, failed)
      })
    })
    return
  }
  if (port.name === 'sesame:change-password' || port.name === 'sesame:create-password') {
    let started = false
    port.onMessage.addListener((message) => {
      if (started || message?.type !== 'start') return
      started = true
      const style = safePasswordStyle(message)
      if (!style) {
        try { port.postMessage({ state: 'unavailable', code: 'password-change-fill-failed' }) } catch { /* noop */ }
        return
      }
      const deliver = popupResultRelay(port)
      const run = port.name === 'sesame:change-password'
        ? generatedPasswords.change(style).then((result) => result.ok
          ? { state: 'changed', currentFilled: result.currentFilled, newFilled: result.newFilled }
          : { state: 'unavailable', code: result.code, lookalike: result.lookalike })
        : generatedPasswords.create(style).then((result) => result.ok
          ? { state: 'created', fieldsFilled: result.fieldsFilled }
          : { state: 'unavailable', code: result.code })
      run.then((outcome) => {
        const page: PublicFillResult | undefined = outcome.state === 'unavailable'
          ? { state: 'unavailable', code: outcome.code as string }
          : undefined
        void deliver(outcome, page)
      }).catch(() => {
        const failed: PublicFillResult = { state: 'unavailable', code: 'fill-failed' }
        void deliver(failed, failed)
      })
    })
    return
  }
  if (port.name === 'sesame:identity-fill') {
    let started = false
    port.onMessage.addListener((message) => {
      if (started || message?.type !== 'start') return
      started = true
      coordinator.fillIdentityActivePage().then((result) => {
        try { port.postMessage(result) } catch { /* noop */ }
      }).catch(() => {
        try { port.postMessage({ ok: false, code: 'fill-failed' }) } catch { /* noop */ }
      })
    })
    return
  }
  if (port.name === 'sesame:card-fill') {
    let started = false
    port.onMessage.addListener((message) => {
      if (started || message?.type !== 'start') return
      started = true
      fillCardWhenEnabled().then((result) => { try { port.postMessage(result) } catch { /* noop */ } }).catch(() => {
        try { port.postMessage({ ok: false, code: 'fill-failed' }) } catch { /* noop */ }
      })
    })
    return
  }
  try { port.disconnect() } catch { /* noop */ }
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false
  const fromExtensionPage = typeof sender.url === 'string'
    && sender.url.startsWith(chrome.runtime.getURL(''))
  const frameAgnostic = message?.type === 'sesame:capture-signup' || message?.type === 'sesame:inline-policy'
  if (!frameAgnostic && !fromExtensionPage && sender.frameId !== 0) return false
  if (message?.type === 'sesame:connect') {
    checkConnection(message?.force === true).then(sendResponse).catch(() => sendResponse({
      state: 'unavailable',
      title: 'Extension connection failed',
      message: 'Reload this extension and try again.',
      diagnostic: {
        code: 'extension-error',
        checkedAt: new Date().toISOString(),
        extensionVersion: chrome.runtime.getManifest().version,
        protocolVersion: 'unknown',
        host: NATIVE_HOST,
      },
    }))
    return true
  }
  if (message?.type === 'sesame:inspect-surfaces') {
    if (sender.url !== chrome.runtime.getURL('popup.html')) {
      sendResponse({ state: 'restricted', code: 'page-restricted' })
      return false
    }
    loadInlineSettings()
      .catch(() => null)
      .then((settings) => coordinator.inspectActivePageSurfaces({ cards: settings?.cardSuggestionsEnabled === true }))
      .then(sendResponse)
      .catch(() => sendResponse({ state: 'unavailable', code: 'page-check-failed' }))
    return true
  }
  if (message?.type === 'sesame:autofill') {
    coordinator.fillActivePage().then((result) => {
      recordLastFillResult(result)
      sendResponse(publicFillResult(result))
    }).catch(() => sendResponse({
      state: 'unavailable',
      code: 'fill-failed',
    }))
    return true
  }
  if (message?.type === 'sesame:autofill-identity') {
    coordinator.fillIdentityActivePage().then(sendResponse).catch(() => sendResponse({
      ok: false,
      code: 'fill-failed',
    }))
    return true
  }
  if (message?.type === 'sesame:autofill-card') {
    fillCardWhenEnabled().then(sendResponse).catch(() => sendResponse({
      ok: false,
      code: 'fill-failed',
    }))
    return true
  }
  if (message?.type === 'sesame:autofill-one-time-code') {
    coordinator.fillOneTimeCodeActivePage().then(sendResponse).catch(() => sendResponse({
      ok: false,
      code: 'fill-failed',
    }))
    return true
  }
  if (message?.type === 'sesame:create-password') {
    const style = safePasswordStyle(message)
    const page = fromExtensionPage ? null : createPasswordSenderPage(sender)
    if (!page || !style) {
      sendResponse({ ok: false, code: 'invalid-request' })
      return false
    }
    generatedPasswords.create(style, page)
      .then((result) => sendResponse(result.ok ? { ok: true } : { ok: false, code: result.code }))
      .catch(() => sendResponse({ ok: false, code: 'fill-failed' }))
    return true
  }
  if (message?.type === 'sesame:pending-state' || message?.type === 'sesame:pending-accept') {
    const tabId = message?.tabId
    if (sender.url !== chrome.runtime.getURL('popup.html') || typeof tabId !== 'number' || !Number.isInteger(tabId)) {
      sendResponse(message?.type === 'sesame:pending-state' ? { pending: null } : { code: 'pending-not-found' })
      return false
    }
    if (message.type === 'sesame:pending-state') {
      generatedPasswords.pending(tabId)
        .then((pending) => sendResponse({ pending }))
        .catch(() => sendResponse({ pending: null }))
    } else {
      generatedPasswords.accept(tabId)
        .then(sendResponse)
        .catch(() => sendResponse({ code: 'pending-failed' }))
    }
    return true
  }
  if (message?.type === 'sesame:capture-signup') {
    const tabId = sender.tab?.id
    // Origin from the delivering frame, never the message.
    const payload = Number.isInteger(tabId) ? safeSignupCapturePayload(message, sender.url) : null
    if (!payload) {
      sendResponse({ ok: false, code: 'invalid-capture' })
      return false
    }
    saveSession.save(chromeBrowser, tabId!, payload)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, code: 'save-failed' }))
    return true
  }
  if (message?.type === 'sesame:arm-save') {
    if (sender.url !== chrome.runtime.getURL('popup.html')) {
      sendResponse({ armed: false })
      return false
    }
    const tabId = message?.tabId
    const origin = normalizeFillOrigin(message?.origin)
    if (typeof tabId !== 'number' || !Number.isInteger(tabId) || !origin) {
      sendResponse({ armed: false })
      return false
    }
    saveSession.arm(tabId, origin)
    sendResponse({ armed: true })
    return false
  }
  if (message?.type === 'sesame:save-state') {
    const tabId = message?.tabId
    const validTab = typeof tabId === 'number' && Number.isInteger(tabId)
    sendResponse({ armed: validTab ? saveSession.isArmed(tabId) : false })
    return false
  }
  if (message?.type === 'sesame:last-fill-result') {
    if (sender.url !== chrome.runtime.getURL('popup.html')) {
      sendResponse({ state: 'none' })
      return false
    }
    chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      const tabId = tab?.id
      const validTab = typeof tabId === 'number' && Number.isInteger(tabId)
      const missed = validTab ? await missedResults.take(tabId) : undefined
      if (missed) {
        sendResponse({ state: 'missed', result: missed })
        return
      }
      const record = validTab ? lastFill.lookup(tabId) : undefined
      sendResponse(record
        ? {
            state: 'filled',
            usernameFilled: record.usernameFilled,
            passwordFilled: record.passwordFilled,
            matchKind: record.matchKind,
          }
        : { state: 'none' })
    }).catch(() => sendResponse({ state: 'none' }))
    return true
  }
  if (message?.type === 'sesame:open-desktop') {
    openDesktop(chromeBrowser).then((result) => {
      if (result.ok) {
        cachedConnection = undefined
        sendResponse({ state: 'opened' })
      } else {
        sendResponse({ state: 'unavailable', code: result.code })
      }
    }).catch(() => sendResponse({ state: 'unavailable', code: 'desktop-launch-failed' }))
    return true
  }
  if (message?.type === 'sesame:inline-policy') {
    const senderOrigin = safeSenderOrigin(sender.url)
    if (!senderOrigin) {
      sendResponse({ enabled: false })
      return false
    }
    Promise.all([
      ensureContentScriptRegistered(),
      loadInlineSettings(),
      chrome.permissions.contains({ origins: [`${senderOrigin}/*`] }),
    ])
      .then(([registered, settings, permitted]) => sendResponse({
        enabled: registered && permitted && !settings.pausedOrigins.includes(senderOrigin),
      }))
      .catch(() => sendResponse({ enabled: false }))
    return true
  }
  if (message?.type === 'sesame:detach-inline-overlays') {
    detachAllOpenTabs().then(() => sendResponse({ detached: true })).catch(() => sendResponse({ detached: false }))
    return true
  }
  if (message?.type === 'sesame:sync-inline-overlay') {
    syncInlineAccess()
      .then(() => sendResponse({ enabled: true }))
      .catch(() => sendResponse({ enabled: false, origins: [], error: 'registration-failed' }))
    return true
  }
  return false
})

function safeSenderOrigin(value: string | undefined): string | null {
  if (!value) return null
  try {
    return normalizePausedOrigins([new URL(value).origin])[0] ?? null
  } catch {
    return null
  }
}

function detachInlineOverlay() {
  const target = globalThis as typeof globalThis & { sesameDetachInlineButton?: () => void }
  target.sesameDetachInlineButton?.()
  target.sesameDetachInlineButton = undefined
}

function presentOverlayStatus(result: unknown): boolean {
  const target = globalThis as typeof globalThis & { sesameShowFillStatus?: (value: unknown) => boolean }
  return target.sesameShowFillStatus?.(result) === true
}

async function presentFillStatus(tabId: number, result: PublicFillResult): Promise<boolean> {
  let shown = false
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: presentOverlayStatus,
      args: [result],
    })
    shown = injection?.result === true
  } catch {
    shown = false
  }
  return shown || missedResults.hold(tabId, result)
}

function popupResultRelay(port: chrome.runtime.Port) {
  return createPopupResultRelay(port, {
    queryActiveTab: async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0],
    tabOrigin: async (tabId) => fillPageOrigin((await chrome.tabs.get(tabId)).url),
    pageOrigin: fillPageOrigin,
    showStatus: presentFillStatus,
  })
}

function fillPageOrigin(url: string | undefined): string | null {
  if (!url) return null
  try {
    return normalizeFillOrigin(new URL(url).origin)
  } catch {
    return null
  }
}

async function detachAllOpenTabs() {
  const tabs = await chrome.tabs.query({})
  await Promise.allSettled(tabs.flatMap((tab) => Number.isInteger(tab.id)
    ? [chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: detachInlineOverlay })]
    : []))
}
