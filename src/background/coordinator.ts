import { probeNativeHost, requestCardFill, requestFill, requestIdentityFill } from './native-connection'
import { transition, initialFillState, type FillContext } from './fill-state'
import {
  normalizeFillOutcome,
  normalizeIdentityFillOutcome,
  normalizeIdentityInspection,
  normalizeInspection,
  redactCredential,
  redactIdentity,
} from '../protocol/fill'
import { makeDiagnostic, userMessage } from '../protocol/diagnostics'
import type { Browser } from '../platform/chrome'
import { isSameActivePage, tabFillContext } from './tab-context'
import { CARD_FIELD_KEYS, redactCard, type CardFieldKey, type CardFields, type IdentityFieldKey } from '../protocol/native'

export interface Coordinator {
  state(): FillContext
  checkConnection(): Promise<ConnectionState>
  inspectActivePage(): Promise<PageCheckResult>
  fillActivePage(signal?: AbortSignal): Promise<FillContext>
  inspectIdentityActivePage(): Promise<IdentityPageCheckResult>
  fillIdentityActivePage(signal?: AbortSignal): Promise<IdentityFillResult>
  inspectCardActivePage(): Promise<CardPageCheckResult>
  fillCardActivePage(signal?: AbortSignal): Promise<CardFillResult>
}

export interface IdentityPageCheckResult {
  state: 'ready' | 'unavailable'
  code?: string
  fields?: IdentityFieldKey[]
}

export type IdentityFillResult =
  | { ok: true; filledFields: IdentityFieldKey[] }
  | { ok: false; code: string }

export interface CardPageCheckResult { state: 'ready' | 'unavailable'; code?: string; fields?: CardFieldKey[] }
export type CardFillResult = { ok: true; filledFields: CardFieldKey[] } | { ok: false; code: string }

export interface ConnectionState {
  state: 'checking' | 'unavailable' | 'desktop-offline' | 'locked' | 'ready'
  title: string
  message: string
  capabilities?: { desktopAvailable: boolean; locked: boolean; fillAvailable: boolean }
  diagnostic: ReturnType<typeof makeDiagnostic>
}

export interface PageCheckResult {
  state: 'ready' | 'unavailable'
  code?: string
  hasUsernameField?: boolean
  hasPasswordField?: boolean
}

export function createCoordinator(browser: Browser): Coordinator {
  let current: FillContext = initialFillState()
  const activeControllers = new Set<AbortController>()

  function update(event: Parameters<typeof transition>[1]) {
    current = transition(current, event)
    return current
  }

  return {
    state: () => current,

    async checkConnection(): Promise<ConnectionState> {
      const result = await probeNativeHost(browser)
      const diagnostic = makeDiagnostic(
        result.ok ? 'connected' : result.code,
        result.ok ? result.latencyMs : undefined,
        result.attempts
      )

      if (!result.ok) {
        update({ type: 'failed', code: result.code })
        const [title, message] = userMessage(result.code)
        return { state: 'unavailable', title, message, diagnostic }
      }

      const { desktopAvailable, locked, fillAvailable } = result.capabilities
      if (!desktopAvailable) {
        update({ type: 'connection-checked', ok: false, code: 'desktop-unavailable' })
        const [title, message] = userMessage('desktop-unavailable')
        return {
          state: 'desktop-offline',
          title,
          message,
          capabilities: { desktopAvailable, locked: true, fillAvailable: false },
          diagnostic,
        }
      }

      update({ type: 'connection-checked', ok: true, desktopAvailable, locked, fillAvailable })
      if (locked) {
        const [title, message] = userMessage('vault-locked')
        return { state: 'locked', title, message, capabilities: result.capabilities, diagnostic }
      }
      return {
        state: 'ready',
        title: 'Connected',
        message: fillAvailable
          ? 'Ready to fill from this browser.'
          : 'Page filling is not available in this desktop build.',
        capabilities: result.capabilities,
        diagnostic,
      }
    },

    async inspectActivePage(): Promise<PageCheckResult> {
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
        const page = tabFillContext(tab)
        if (!page.ok) return { state: 'unavailable', code: page.code }
        await installContentBridge(browser, page.tabId)
        const [injection] = await browser.scripting.executeScript({
          target: { tabId: page.tabId },
          func: invokeLoginInspection,
        })
        const inspection = normalizeInspection(injection?.result)
        if (!inspection.ok) return { state: 'unavailable', code: inspection.code }
        if (inspection.surface.origin !== page.origin) {
          return { state: 'unavailable', code: 'origin-mismatch' }
        }
        return {
          state: 'ready',
          hasUsernameField: inspection.hasUsernameField,
          hasPasswordField: inspection.hasPasswordField,
        }
      } catch {
        return { state: 'unavailable', code: 'page-restricted' }
      }
    },

    async fillActivePage(externalSignal): Promise<FillContext> {
      if (externalSignal?.aborted) {
        return update({ type: 'cancelled', code: 'cancelled' })
      }
      if (activeControllers.size > 0) {
        return update({ type: 'failed', code: 'fill-in-progress' })
      }

      const controller = new AbortController()
      activeControllers.add(controller)
      if (externalSignal) {
        externalSignal.addEventListener('abort', () => controller.abort(), { once: true })
      }

      try {
        return await runFill(browser, controller.signal, update)
      } catch {
        return update({ type: 'failed', code: controller.signal.aborted ? 'cancelled' : 'page-restricted' })
      } finally {
        activeControllers.delete(controller)
      }
    },

    async inspectIdentityActivePage(): Promise<IdentityPageCheckResult> {
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
        const page = tabFillContext(tab)
        if (!page.ok) return { state: 'unavailable', code: page.code }
        await installContentBridge(browser, page.tabId)
        const [injection] = await browser.scripting.executeScript({
          target: { tabId: page.tabId },
          func: invokeIdentityInspection,
        })
        const inspection = normalizeIdentityInspection(injection?.result)
        if (!inspection.ok) return { state: 'unavailable', code: inspection.code }
        if (inspection.surface.origin !== page.origin) {
          return { state: 'unavailable', code: 'origin-mismatch' }
        }
        return { state: 'ready', fields: inspection.fields }
      } catch {
        return { state: 'unavailable', code: 'page-restricted' }
      }
    },

    async fillIdentityActivePage(externalSignal): Promise<IdentityFillResult> {
      if (externalSignal?.aborted) return { ok: false, code: 'cancelled' }
      if (activeControllers.size > 0) return { ok: false, code: 'fill-in-progress' }

      const controller = new AbortController()
      activeControllers.add(controller)
      if (externalSignal) {
        externalSignal.addEventListener('abort', () => controller.abort(), { once: true })
      }

      try {
        return await runIdentityFill(browser, controller.signal)
      } catch {
        return { ok: false, code: controller.signal.aborted ? 'cancelled' : 'page-restricted' }
      } finally {
        activeControllers.delete(controller)
      }
    },

    async inspectCardActivePage(): Promise<CardPageCheckResult> {
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
        const page = tabFillContext(tab)
        if (!page.ok) return { state: 'unavailable', code: tab?.url?.startsWith('http:') ? 'insecure-page' : page.code }
        await installContentBridge(browser, page.tabId, true)
        const injections = await browser.scripting.executeScript({
          target: { tabId: page.tabId, allFrames: true },
          func: invokeCardInspection,
        })
        const inspections = injections.map((injection) => normalizeCardInspection(injection?.result, page.origin))
        if (inspections.some((inspection) => inspection.state === 'unavailable' && inspection.code === 'untrusted-frame')) {
          return { state: 'unavailable', code: 'untrusted-frame' }
        }
        return inspections.find((inspection) => inspection.state === 'ready')
          ?? { state: 'unavailable', code: 'no-fields' }
      } catch { return { state: 'unavailable', code: 'page-restricted' } }
    },

    async fillCardActivePage(externalSignal): Promise<CardFillResult> {
      if (externalSignal?.aborted || activeControllers.size > 0) return { ok: false, code: externalSignal?.aborted ? 'cancelled' : 'fill-in-progress' }
      const controller = new AbortController(); activeControllers.add(controller)
      try { return await runCardFill(browser, controller.signal) }
      catch { return { ok: false, code: controller.signal.aborted ? 'cancelled' : 'page-restricted' } }
      finally { activeControllers.delete(controller) }
    },
  }
}

async function runFill(
  browser: Browser,
  signal: AbortSignal,
  update: (event: Parameters<typeof transition>[1]) => FillContext
): Promise<FillContext> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  const expectedPage = tabFillContext(tab)
  if (!expectedPage.ok) return update({ type: 'failed', code: expectedPage.code })

  const { tabId, origin } = expectedPage

  update({ type: 'inspection-started' })

  const documentToken = crypto.randomUUID()
  let prepared = false

  try {
    await installContentBridge(browser, tabId)
    const [inspectionInjection] = await browser.scripting.executeScript({
      target: { tabId },
      func: invokeLoginInspection,
    })
    const inspection = normalizeInspection(inspectionInjection?.result)
    if (!inspection.ok) {
      return update({ type: 'failed', code: inspection.code })
    }
    if (inspection.surface.origin !== origin) {
      return update({ type: 'failed', code: 'origin-mismatch' })
    }
    if (!inspection.hasPasswordField && !inspection.hasUsernameField) {
      return update({ type: 'failed', code: 'no-fields' })
    }

    const [preparation] = await browser.scripting.executeScript({
      target: { tabId },
      func: invokeLoginFill,
      args: [origin, documentToken, null, 'prepare'],
    })
    const prep = normalizeFillOutcome(preparation?.result)
    if (!prep.ok) {
      return update({ type: 'failed', code: prep.code })
    }
    prepared = true
    if (signal.aborted) return update({ type: 'cancelled', code: 'cancelled' })

    update({ type: 'inspection-completed', inspection, documentToken })

    const requestedFields = prep.usernameFilled && !prep.passwordFilled ? 'username'
      : prep.passwordFilled && !prep.usernameFilled ? 'password' : 'both'
    const fill = await requestFill(browser, origin, { signal, fields: requestedFields })
    if (!fill.ok) {
      return update({ type: 'failed', code: fill.code })
    }
    if (signal.aborted) return update({ type: 'cancelled', code: 'cancelled' })

    const [currentTab] = await browser.tabs.query({ active: true, currentWindow: true })
    if (!isSameActivePage(expectedPage, currentTab)) {
      return update({ type: 'failed', code: 'page-changed' })
    }

    update({ type: 'approval-received', credential: fill.credential })

    const [injection] = await browser.scripting.executeScript({
      target: { tabId },
      func: invokeLoginFill,
      args: [origin, documentToken, fill.credential, 'fill'],
    })
    redactCredential({ credential: fill.credential })
    const outcome = normalizeFillOutcome(injection?.result)
    if (!outcome.ok) {
      return update({ type: 'failed', code: outcome.code })
    }
    return update({ type: 'fill-completed', usernameFilled: outcome.usernameFilled, passwordFilled: outcome.passwordFilled })
  } catch {
    return update({ type: 'failed', code: signal.aborted ? 'cancelled' : 'page-restricted' })
  } finally {
    if (prepared) {
      try {
        await browser.scripting.executeScript({
          target: { tabId },
          func: invokeLoginFill,
          args: [origin, documentToken, null, 'clear'],
        })
      } catch { /* noop */ }
    }
  }
}

async function runIdentityFill(browser: Browser, signal: AbortSignal): Promise<IdentityFillResult> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  const expectedPage = tabFillContext(tab)
  if (!expectedPage.ok) return { ok: false, code: expectedPage.code }

  const { tabId, origin } = expectedPage
  const documentToken = crypto.randomUUID()
  let prepared = false

  try {
    await installContentBridge(browser, tabId)
    const [inspectionInjection] = await browser.scripting.executeScript({
      target: { tabId },
      func: invokeIdentityInspection,
    })
    const inspection = normalizeIdentityInspection(inspectionInjection?.result)
    if (!inspection.ok) return { ok: false, code: inspection.code }
    if (inspection.surface.origin !== origin) return { ok: false, code: 'origin-mismatch' }

    const [preparation] = await browser.scripting.executeScript({
      target: { tabId },
      func: invokeIdentityFill,
      args: [origin, documentToken, null, 'prepare'],
    })
    const prep = normalizeIdentityFillOutcome(preparation?.result)
    if (!prep.ok) return { ok: false, code: prep.code }
    prepared = true
    if (signal.aborted) return { ok: false, code: 'cancelled' }

    const fill = await requestIdentityFill(browser, origin, inspection.fields, { signal })
    if (!fill.ok) return { ok: false, code: fill.code }
    if (signal.aborted) return { ok: false, code: 'cancelled' }

    const [currentTab] = await browser.tabs.query({ active: true, currentWindow: true })
    if (!isSameActivePage(expectedPage, currentTab)) return { ok: false, code: 'page-changed' }

    const [injection] = await browser.scripting.executeScript({
      target: { tabId },
      func: invokeIdentityFill,
      args: [origin, documentToken, fill.identity, 'fill'],
    })
    redactIdentity({ identity: fill.identity })
    return normalizeIdentityFillOutcome(injection?.result)
  } catch {
    return { ok: false, code: signal.aborted ? 'cancelled' : 'page-restricted' }
  } finally {
    if (prepared) {
      try {
        await browser.scripting.executeScript({
          target: { tabId },
          func: invokeIdentityFill,
          args: [origin, documentToken, null, 'clear'],
        })
      } catch { /* noop */ }
    }
  }
}

async function installContentBridge(browser: Browser, tabId: number, allFrames = false): Promise<void> {
  await browser.scripting.executeScript({
    target: { tabId, allFrames },
    files: ['content.js'],
  })
}

export function normalizeCardInspection(raw: unknown, expectedOrigin: string): CardPageCheckResult {
  if (!isRecord(raw)) return { state: 'unavailable', code: 'no-fields' }
  if (raw.ok === false) {
    return Object.keys(raw).length === 2
      && typeof raw.code === 'string'
      && ['no-fields', 'untrusted-frame', 'insecure-page', 'content-bridge-unavailable'].includes(raw.code)
      ? { state: 'unavailable', code: raw.code }
      : { state: 'unavailable', code: 'no-fields' }
  }
  if (raw.ok !== true
    || Object.keys(raw).length !== 3
    || typeof raw.origin !== 'string'
    || raw.origin !== expectedOrigin
    || !Array.isArray(raw.fields)
    || raw.fields.length === 0
    || new Set(raw.fields).size !== raw.fields.length
    || raw.fields.some((field) => typeof field !== 'string' || !CARD_FIELD_KEYS.includes(field as CardFieldKey))) {
    return { state: 'unavailable', code: 'no-fields' }
  }
  return { state: 'ready', fields: raw.fields as CardFieldKey[] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invokeLoginInspection(): unknown {
  const inspect = (globalThis as typeof globalThis & {
    sesameInspectLoginSurface?: () => unknown
  }).sesameInspectLoginSurface
  return typeof inspect === 'function'
    ? inspect()
    : { ok: false, code: 'content-bridge-unavailable' }
}

function invokeLoginFill(...args: unknown[]): unknown {
  const fill = (globalThis as typeof globalThis & {
    sesameFillLoginSurface?: (...fillArgs: unknown[]) => unknown
  }).sesameFillLoginSurface
  return typeof fill === 'function'
    ? fill(...args)
    : { ok: false, code: 'content-bridge-unavailable' }
}

function invokeIdentityInspection(): unknown {
  const inspect = (globalThis as typeof globalThis & {
    sesameInspectIdentitySurface?: () => unknown
  }).sesameInspectIdentitySurface
  return typeof inspect === 'function'
    ? inspect()
    : { ok: false, code: 'content-bridge-unavailable' }
}

function invokeIdentityFill(...args: unknown[]): unknown {
  const fill = (globalThis as typeof globalThis & {
    sesameFillIdentitySurface?: (...fillArgs: unknown[]) => unknown
  }).sesameFillIdentitySurface
  return typeof fill === 'function'
    ? fill(...args)
    : { ok: false, code: 'content-bridge-unavailable' }
}

function invokeCardInspection(): unknown {
  const inspect = (globalThis as typeof globalThis & { sesameInspectCardSurface?: () => unknown }).sesameInspectCardSurface
  return typeof inspect === 'function' ? inspect() : { ok: false, code: 'content-bridge-unavailable' }
}

function invokeCardFill(...args: unknown[]): unknown {
  const fill = (globalThis as typeof globalThis & { sesameFillCardSurface?: (...fillArgs: unknown[]) => unknown }).sesameFillCardSurface
  return typeof fill === 'function' ? fill(...args) : { ok: false, code: 'content-bridge-unavailable' }
}

async function runCardFill(browser: Browser, signal: AbortSignal): Promise<CardFillResult> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  const expectedPage = tabFillContext(tab)
  if (!expectedPage.ok) return { ok: false, code: tab?.url?.startsWith('http:') ? 'insecure-page' : expectedPage.code }
  const { tabId, origin } = expectedPage
  const token = crypto.randomUUID()
  let prepared = false
  let approvedCard: CardFields | undefined
  try {
    await installContentBridge(browser, tabId)
    const [prepare] = await browser.scripting.executeScript({ target: { tabId }, func: invokeCardFill, args: [origin, token, null, 'prepare'] })
    const preparation = prepare?.result as { ok?: unknown; filledFields?: unknown; code?: unknown }
    if (preparation?.ok !== true || !Array.isArray(preparation.filledFields)) return { ok: false, code: typeof preparation?.code === 'string' ? preparation.code : 'no-fields' }
    prepared = true
    const card = await requestCardFill(browser, origin, preparation.filledFields as CardFieldKey[], { signal })
    if (!card.ok) return card
    approvedCard = card.card
    if (signal.aborted) return { ok: false, code: 'cancelled' }
    const [currentTab] = await browser.tabs.query({ active: true, currentWindow: true })
    if (!isSameActivePage(expectedPage, currentTab)) return { ok: false, code: 'page-changed' }
    const [write] = await browser.scripting.executeScript({ target: { tabId }, func: invokeCardFill, args: [origin, token, approvedCard, 'fill'] })
    const outcome = write?.result as { ok?: unknown; filledFields?: unknown; code?: unknown }
    return outcome?.ok === true && Array.isArray(outcome.filledFields) ? { ok: true, filledFields: outcome.filledFields as CardFieldKey[] } : { ok: false, code: typeof outcome?.code === 'string' ? outcome.code : 'field-write-failed' }
  } finally {
    if (approvedCard) redactCard(approvedCard)
    if (prepared) void browser.scripting.executeScript({ target: { tabId }, func: invokeCardFill, args: [origin, token, null, 'clear'] }).catch(() => {})
  }
}
