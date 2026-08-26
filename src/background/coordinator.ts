import { probeNativeHost, requestCardFill, requestFill, requestIdentityFill } from './native-connection'
import { transition, initialFillState, type FillContext } from './fill-state'
import {
  normalizeFillOutcome,
  normalizeIdentityFillOutcome,
  normalizeIdentityInspection,
  normalizeInspection,
  redactCredential,
  redactIdentity,
  type Credential,
  type FillOutcome,
  type IdentityFillOutcome,
  type IdentityPageInspection,
  type PageInspection,
} from '../protocol/fill'
import { makeDiagnostic, userMessage } from '../protocol/diagnostics'
import type { Browser } from '../platform/chrome'
import { isSameActivePage, tabFillContext } from './tab-context'
import {
  CARD_FIELD_KEYS,
  redactCard,
  type CardFieldKey,
  type CardFields,
  type FillFields,
  type IdentityFieldKey,
  type IdentityFields,
} from '../protocol/native'

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

export interface CardPageCheckResult {
  state: 'ready' | 'unavailable'
  code?: string
  fields?: CardFieldKey[]
  origin?: string
  frameIds?: number[]
  embedded?: boolean
  targets?: CardFrameTarget[]
}
export type CardFillResult = { ok: true; filledFields: CardFieldKey[] } | { ok: false; code: string }

interface CardFrameTarget {
  origin: string
  frameIds: number[]
}

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
      return withFillGuard(activeControllers, externalSignal, {
        cancelled: () => update({ type: 'cancelled', code: 'cancelled' }),
        busy: () => update({ type: 'failed', code: 'fill-in-progress' }),
        restricted: (aborted) => update({ type: 'failed', code: aborted ? 'cancelled' : 'page-restricted' }),
      }, (signal) => runFill(browser, signal, update))
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
      return withFillGuard(activeControllers, externalSignal, {
        cancelled: () => ({ ok: false, code: 'cancelled' }),
        busy: () => ({ ok: false, code: 'fill-in-progress' }),
        restricted: (aborted) => ({ ok: false, code: aborted ? 'cancelled' : 'page-restricted' }),
      }, (signal) => runIdentityFill(browser, signal))
    },

    async inspectCardActivePage(): Promise<CardPageCheckResult> {
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
        const page = tabFillContext(tab)
        if (!page.ok) return { state: 'unavailable', code: tab?.url?.startsWith('http:') ? 'insecure-page' : page.code }
        const inspection = await inspectCardTargets(browser, page.tabId, page.origin)
        return inspection.state === 'ready'
          ? { state: 'ready', fields: inspection.fields, embedded: inspection.embedded }
          : inspection
      } catch { return { state: 'unavailable', code: 'page-restricted' } }
    },

    async fillCardActivePage(externalSignal): Promise<CardFillResult> {
      return withFillGuard(activeControllers, externalSignal, {
        cancelled: () => ({ ok: false, code: 'cancelled' }),
        busy: () => ({ ok: false, code: 'fill-in-progress' }),
        restricted: (aborted) => ({ ok: false, code: aborted ? 'cancelled' : 'page-restricted' }),
      }, (signal) => runCardFill(browser, signal))
    },
  }
}

// Owns the concurrency guard and the abort wiring for every fill entry point,
// so a surface cannot ship without both — the way the card path once did.
async function withFillGuard<T>(
  activeControllers: Set<AbortController>,
  externalSignal: AbortSignal | undefined,
  outcomes: {
    cancelled: () => T
    busy: () => T
    restricted: (aborted: boolean) => T
  },
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  if (externalSignal?.aborted) return outcomes.cancelled()
  if (activeControllers.size > 0) return outcomes.busy()

  const controller = new AbortController()
  activeControllers.add(controller)
  externalSignal?.addEventListener('abort', () => controller.abort(), { once: true })

  try {
    return await run(controller.signal)
  } catch {
    return outcomes.restricted(controller.signal.aborted)
  } finally {
    activeControllers.delete(controller)
  }
}

// The shared inspect -> verify origin -> prepare -> approve -> re-verify -> fill -> clear
// choreography for a surface confined to the top-level document. Login and identity are
// both instances of it; card is not, because it must fill across several frames.
interface SingleFrameSurface<Inspection extends { ok: boolean }, ApprovalInput, Approved, Outcome extends { ok: boolean }> {
  invokeInspect: () => unknown
  normalizeInspection: (raw: unknown) => Inspection
  unfillableCode?: (inspection: Extract<Inspection, { ok: true }>) => string | undefined
  prepare: (
    browser: Browser,
    tabId: number,
    origin: string,
    documentToken: string,
    inspection: Extract<Inspection, { ok: true }>
  ) => Promise<{ ok: true; approvalInput: ApprovalInput } | { ok: false; code: string }>
  requestApproval: (
    browser: Browser,
    origin: string,
    input: ApprovalInput,
    signal: AbortSignal
  ) => Promise<{ ok: true; approved: Approved } | { ok: false; code: string }>
  fill: (browser: Browser, tabId: number, origin: string, documentToken: string, approved: Approved) => Promise<Outcome>
  clear: (browser: Browser, tabId: number, origin: string, documentToken: string) => Promise<void>
  events?: {
    inspectionStarted?: () => void
    inspectionCompleted?: (inspection: Extract<Inspection, { ok: true }>, documentToken: string) => void
    approvalReceived?: (approved: Approved) => void
  }
}

async function runSingleFrameFill<
  Inspection extends { ok: boolean },
  ApprovalInput,
  Approved,
  Outcome extends { ok: boolean }
>(
  browser: Browser,
  signal: AbortSignal,
  surface: SingleFrameSurface<Inspection, ApprovalInput, Approved, Outcome>
): Promise<{ ok: true; outcome: Extract<Outcome, { ok: true }> } | { ok: false; code: string }> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  const expectedPage = tabFillContext(tab)
  if (!expectedPage.ok) return { ok: false, code: expectedPage.code }

  const { tabId, origin } = expectedPage
  surface.events?.inspectionStarted?.()

  const documentToken = crypto.randomUUID()
  let prepared = false

  try {
    await installContentBridge(browser, tabId)
    const [inspectionInjection] = await browser.scripting.executeScript({ target: { tabId }, func: surface.invokeInspect })
    const inspection = surface.normalizeInspection(inspectionInjection?.result)
    if (!inspection.ok) return { ok: false, code: (inspection as unknown as { code: string }).code }
    const readyInspection = inspection as Extract<Inspection, { ok: true }> & { surface: { origin: string } }
    if (readyInspection.surface.origin !== origin) return { ok: false, code: 'origin-mismatch' }
    const unfillable = surface.unfillableCode?.(readyInspection)
    if (unfillable) return { ok: false, code: unfillable }

    const prep = await surface.prepare(browser, tabId, origin, documentToken, readyInspection)
    if (!prep.ok) return prep
    prepared = true
    if (signal.aborted) return { ok: false, code: 'cancelled' }

    surface.events?.inspectionCompleted?.(readyInspection, documentToken)

    const approval = await surface.requestApproval(browser, origin, prep.approvalInput, signal)
    if (!approval.ok) return approval
    if (signal.aborted) return { ok: false, code: 'cancelled' }

    surface.events?.approvalReceived?.(approval.approved)

    const [currentTab] = await browser.tabs.query({ active: true, currentWindow: true })
    if (!isSameActivePage(expectedPage, currentTab)) return { ok: false, code: 'page-changed' }

    const outcome = await surface.fill(browser, tabId, origin, documentToken, approval.approved)
    return outcome.ok ? { ok: true, outcome: outcome as Extract<Outcome, { ok: true }> } : { ok: false, code: (outcome as unknown as { code: string }).code }
  } catch {
    return { ok: false, code: signal.aborted ? 'cancelled' : 'page-restricted' }
  } finally {
    if (prepared) {
      try {
        await surface.clear(browser, tabId, origin, documentToken)
      } catch { /* noop */ }
    }
  }
}

function loginSurface(
  update: (event: Parameters<typeof transition>[1]) => FillContext
): SingleFrameSurface<PageInspection, FillFields, Credential, FillOutcome> {
  return {
    invokeInspect: invokeLoginInspection,
    normalizeInspection,
    unfillableCode: (inspection) => (!inspection.hasPasswordField && !inspection.hasUsernameField ? 'no-fields' : undefined),
    async prepare(browser, tabId, origin, documentToken) {
      const [preparation] = await browser.scripting.executeScript({
        target: { tabId },
        func: invokeLoginFill,
        args: [origin, documentToken, null, 'prepare'],
      })
      const prep = normalizeFillOutcome(preparation?.result)
      if (!prep.ok) return prep
      const approvalInput: FillFields = prep.usernameFilled && !prep.passwordFilled ? 'username'
        : prep.passwordFilled && !prep.usernameFilled ? 'password' : 'both'
      return { ok: true, approvalInput }
    },
    async requestApproval(browser, origin, input, signal) {
      const fill = await requestFill(browser, origin, { signal, fields: input })
      return fill.ok ? { ok: true, approved: fill.credential } : fill
    },
    async fill(browser, tabId, origin, documentToken, approved) {
      const [injection] = await browser.scripting.executeScript({
        target: { tabId },
        func: invokeLoginFill,
        args: [origin, documentToken, approved, 'fill'],
      })
      redactCredential({ credential: approved })
      return normalizeFillOutcome(injection?.result)
    },
    async clear(browser, tabId, origin, documentToken) {
      await browser.scripting.executeScript({
        target: { tabId },
        func: invokeLoginFill,
        args: [origin, documentToken, null, 'clear'],
      })
    },
    events: {
      inspectionStarted: () => update({ type: 'inspection-started' }),
      inspectionCompleted: (inspection, documentToken) => update({ type: 'inspection-completed', inspection, documentToken }),
      approvalReceived: (credential) => update({ type: 'approval-received', credential }),
    },
  }
}

function identitySurface(): SingleFrameSurface<IdentityPageInspection, readonly IdentityFieldKey[], IdentityFields, IdentityFillOutcome> {
  return {
    invokeInspect: invokeIdentityInspection,
    normalizeInspection: normalizeIdentityInspection,
    async prepare(browser, tabId, origin, documentToken, inspection) {
      const [preparation] = await browser.scripting.executeScript({
        target: { tabId },
        func: invokeIdentityFill,
        args: [origin, documentToken, null, 'prepare'],
      })
      const prep = normalizeIdentityFillOutcome(preparation?.result)
      if (!prep.ok) return prep
      return { ok: true, approvalInput: inspection.fields }
    },
    async requestApproval(browser, origin, input, signal) {
      const fill = await requestIdentityFill(browser, origin, input, { signal })
      return fill.ok ? { ok: true, approved: fill.identity } : fill
    },
    async fill(browser, tabId, origin, documentToken, approved) {
      const [injection] = await browser.scripting.executeScript({
        target: { tabId },
        func: invokeIdentityFill,
        args: [origin, documentToken, approved, 'fill'],
      })
      redactIdentity({ identity: approved })
      return normalizeIdentityFillOutcome(injection?.result)
    },
    async clear(browser, tabId, origin, documentToken) {
      await browser.scripting.executeScript({
        target: { tabId },
        func: invokeIdentityFill,
        args: [origin, documentToken, null, 'clear'],
      })
    },
  }
}

async function runFill(
  browser: Browser,
  signal: AbortSignal,
  update: (event: Parameters<typeof transition>[1]) => FillContext
): Promise<FillContext> {
  const result = await runSingleFrameFill(browser, signal, loginSurface(update))
  return result.ok
    ? update({ type: 'fill-completed', usernameFilled: result.outcome.usernameFilled, passwordFilled: result.outcome.passwordFilled })
    : update({ type: 'failed', code: result.code })
}

async function runIdentityFill(browser: Browser, signal: AbortSignal): Promise<IdentityFillResult> {
  const result = await runSingleFrameFill(browser, signal, identitySurface())
  return result.ok ? { ok: true, filledFields: result.outcome.filledFields } : result
}

async function installContentBridge(browser: Browser, tabId: number, allFrames = false): Promise<void> {
  await browser.scripting.executeScript({
    target: { tabId, allFrames },
    files: ['content.js'],
  })
}

export function normalizeCardInspection(raw: unknown, expectedOrigin: string, frameId = 0): CardPageCheckResult {
  if (!isRecord(raw)) return { state: 'unavailable', code: 'no-fields' }
  if (!Number.isInteger(frameId) || frameId < 0) return { state: 'unavailable', code: 'no-fields' }
  if (raw.ok === false) {
    return Object.keys(raw).length === 2
      && typeof raw.code === 'string'
      && ['no-fields', 'untrusted-frame', 'insecure-page', 'content-bridge-unavailable'].includes(raw.code)
      ? { state: 'unavailable', code: raw.code }
      : { state: 'unavailable', code: 'no-fields' }
  }
  if (raw.ok !== true
    || Object.keys(raw).length !== 4
    || typeof raw.origin !== 'string'
    || typeof raw.embedded !== 'boolean'
    || raw.embedded !== (frameId !== 0)
    || !Array.isArray(raw.fields)
    || raw.fields.length === 0
    || new Set(raw.fields).size !== raw.fields.length
    || raw.fields.some((field) => typeof field !== 'string' || !CARD_FIELD_KEYS.includes(field as CardFieldKey))) {
    return { state: 'unavailable', code: 'no-fields' }
  }
  if (frameId === 0 && raw.origin !== expectedOrigin) return { state: 'unavailable', code: 'no-fields' }
  if (frameId !== 0 && raw.origin !== 'https://js.stripe.com') return { state: 'unavailable', code: 'untrusted-frame' }
  return {
    state: 'ready',
    fields: raw.fields as CardFieldKey[],
    origin: raw.origin,
    frameIds: [frameId],
    embedded: raw.embedded,
  }
}

async function inspectCardTargets(browser: Browser, tabId: number, topLevelOrigin: string): Promise<CardPageCheckResult> {
  await installContentBridge(browser, tabId, true)
  const injections = await browser.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: invokeCardInspection,
  })
  const inspections = injections.map((injection) => normalizeCardInspection(injection.result, topLevelOrigin, injection.frameId ?? -1))
  const ready = inspections.filter((inspection) => inspection.state === 'ready' && inspection.origin && inspection.frameIds?.length)
  if (ready.length === 0) {
    return inspections.some((inspection) => inspection.code === 'untrusted-frame')
      ? { state: 'unavailable', code: 'untrusted-frame' }
      : { state: 'unavailable', code: 'no-fields' }
  }
  const grouped = new Map<string, CardFrameTarget & { fields: CardFieldKey[] }>()
  for (const inspection of ready) {
    const origin = inspection.origin!
    const target = grouped.get(origin) ?? { origin, frameIds: [], fields: [] }
    for (const frameId of inspection.frameIds ?? []) {
      if (!target.frameIds.includes(frameId)) target.frameIds.push(frameId)
    }
    for (const field of inspection.fields ?? []) {
      if (!target.fields.includes(field)) target.fields.push(field)
    }
    grouped.set(origin, target)
  }
  const targets = [...grouped.values()]
  const fields = [...new Set(targets.flatMap((target) => target.fields))]
  return { state: 'ready', fields, embedded: targets.some((target) => target.frameIds.some((frameId) => frameId !== 0)), targets }
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
  const { tabId } = expectedPage
  const token = crypto.randomUUID()
  const preparedTargets: CardFrameTarget[] = []
  let approvedCard: CardFields | undefined
  try {
    const inspection = await inspectCardTargets(browser, tabId, expectedPage.origin)
    if (inspection.state !== 'ready' || !inspection.targets?.length) return { ok: false, code: inspection.code ?? 'no-fields' }
    const requestedFields = new Set<CardFieldKey>()
    for (const target of inspection.targets) {
      const preparations = await browser.scripting.executeScript({
        target: { tabId, frameIds: target.frameIds },
        func: invokeCardFill,
        args: [target.origin, token, null, 'prepare'],
      })
      const fields = collectCardFillFields(preparations.map((preparation) => preparation.result))
      if (fields.length > 0) preparedTargets.push(target)
      for (const field of fields) requestedFields.add(field)
    }
    const requested = [...requestedFields]
    if (requested.length === 0) return { ok: false, code: 'no-fields' }
    if (signal.aborted) return { ok: false, code: 'cancelled' }
    const card = await requestCardFill(browser, expectedPage.origin, requested, { signal })
    if (!card.ok) return card
    approvedCard = card.card
    if (signal.aborted) return { ok: false, code: 'cancelled' }
    const [currentTab] = await browser.tabs.query({ active: true, currentWindow: true })
    if (!isSameActivePage(expectedPage, currentTab)) return { ok: false, code: 'page-changed' }
    const writtenFields = new Set<CardFieldKey>()
    for (const target of preparedTargets) {
      const writes = await browser.scripting.executeScript({
        target: { tabId, frameIds: target.frameIds },
        func: invokeCardFill,
        args: [target.origin, token, approvedCard, 'fill'],
      })
      for (const field of collectCardFillFields(writes.map((write) => write.result))) writtenFields.add(field)
    }
    const filledFields = [...writtenFields]
    return filledFields.length ? { ok: true, filledFields } : { ok: false, code: 'field-write-failed' }
  } finally {
    if (approvedCard) redactCard(approvedCard)
    await Promise.allSettled(preparedTargets.map((target) => browser.scripting.executeScript({
      target: { tabId, frameIds: target.frameIds },
      func: invokeCardFill,
      args: [target.origin, token, null, 'clear'],
    })))
  }
}

function collectCardFillFields(results: unknown[]): CardFieldKey[] {
  const fields = new Set<CardFieldKey>()
  for (const result of results) {
    if (!isRecord(result) || result.ok !== true || !Array.isArray(result.filledFields)) continue
    for (const field of result.filledFields) {
      if (typeof field === 'string' && CARD_FIELD_KEYS.includes(field as CardFieldKey)) fields.add(field as CardFieldKey)
    }
  }
  return [...fields]
}
