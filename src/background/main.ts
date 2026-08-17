import { createCoordinator } from './coordinator'
import { chromeBrowser } from '../platform/chrome'
import { NATIVE_HOST } from '../protocol/native'
import { createInlineRegistrationSync, syncInlineContentScript } from './inline-registration'
import { handleExtensionCommand } from './command-handler'
import { INLINE_SETTINGS_KEY, loadInlineSettings, normalizePausedOrigins } from '../permissions/inline-access'
import { publicFillResult } from './fill-result'
import { openDesktop } from './native-connection'
import { createSignupCaptureController, safeSignupCapturePayload } from './signup-capture'

const coordinator = createCoordinator(chromeBrowser)
const signupCapture = createSignupCaptureController(chromeBrowser)
const CONNECTION_CACHE_MS = 4_000
let cachedConnection: { checkedAt: number; value: Awaited<ReturnType<typeof coordinator.checkConnection>> } | undefined
let connectionCheck: Promise<Awaited<ReturnType<typeof coordinator.checkConnection>>> | undefined

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

const ensureContentScriptRegistered = createInlineRegistrationSync(() =>
  syncInlineContentScript({ permissions: chrome.permissions, scripting: chrome.scripting }))

async function refreshInlineRegistration() {
  await ensureContentScriptRegistered()
}

async function reconcileOpenTabs() {
  const settings = await loadInlineSettings()
  const tabs = await chrome.tabs.query({})
  await Promise.allSettled(tabs.flatMap((tab) => {
    if (!Number.isInteger(tab.id)) return []
    const origin = safeSenderOrigin(tab.url)
    if (!origin) return []
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
chrome.permissions.onRemoved.addListener(() => { void syncInlineAccess() })
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && INLINE_SETTINGS_KEY in changes) void reconcileOpenTabs()
})
chrome.runtime.onInstalled.addListener((details) => {
  void syncInlineAccess()
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') })
  }
})
chrome.runtime.onStartup.addListener(() => { void syncInlineAccess() })
chrome.commands.onCommand.addListener((command) => { void handleExtensionCommand(command, coordinator) })
void refreshInlineRegistration()

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => signupCapture.handleTabUpdated(tabId, changeInfo))
chrome.tabs.onRemoved.addListener((tabId) => signupCapture.handleTabRemoved(tabId))

chrome.runtime.onConnect.addListener((port) => {
  if (port.sender?.id !== chrome.runtime.id || port.sender?.url !== chrome.runtime.getURL('popup.html')) {
    try { port.disconnect() } catch { /* noop */ }
    return
  }
  if (port.name === 'sesame:fill') {
    const controller = new AbortController()
    port.onDisconnect.addListener(() => controller.abort())

    let started = false
    port.onMessage.addListener((message) => {
      if (started || message?.type !== 'start') return
      started = true
      coordinator.fillActivePage(controller.signal).then((result) => {
        try { port.postMessage(publicFillResult(result)) } catch { /* noop */ }
      }).catch(() => {
        try { port.postMessage({ state: 'unavailable', code: 'fill-failed' }) } catch { /* noop */ }
      })
    })
    return
  }
  if (port.name === 'sesame:identity-fill') {
    const controller = new AbortController()
    port.onDisconnect.addListener(() => controller.abort())

    let started = false
    port.onMessage.addListener((message) => {
      if (started || message?.type !== 'start') return
      started = true
      coordinator.fillIdentityActivePage(controller.signal).then((result) => {
        try { port.postMessage(result) } catch { /* noop */ }
      }).catch(() => {
        try { port.postMessage({ ok: false, code: 'fill-failed' }) } catch { /* noop */ }
      })
    })
    return
  }
  try { port.disconnect() } catch { /* noop */ }
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false
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
  if (message?.type === 'sesame:inspect-page') {
    coordinator.inspectActivePage().then(sendResponse).catch(() => sendResponse({
      state: 'unavailable',
      code: 'page-check-failed',
    }))
    return true
  }
  if (message?.type === 'sesame:inspect-identity') {
    coordinator.inspectIdentityActivePage().then(sendResponse).catch(() => sendResponse({
      state: 'unavailable',
      code: 'page-check-failed',
    }))
    return true
  }
  if (message?.type === 'sesame:autofill') {
    coordinator.fillActivePage().then((result) => sendResponse(publicFillResult(result))).catch(() => sendResponse({
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
  if (message?.type === 'sesame:capture-signup') {
    const tabId = sender.tab?.id
    // Origin from the delivering frame, never the message.
    const payload = Number.isInteger(tabId) ? safeSignupCapturePayload(message, sender.url) : null
    if (payload) signupCapture.capture(tabId!, payload)
    return false
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

async function detachAllOpenTabs() {
  const tabs = await chrome.tabs.query({})
  await Promise.allSettled(tabs.flatMap((tab) => Number.isInteger(tab.id)
    ? [chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: detachInlineOverlay })]
    : []))
}
