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
import { isRecord } from '../shared/values'
import { isSameActivePage, tabFillContext, type PageTab } from './tab-context'
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
  embedded?: boolean
}
export type CardFillResult = { ok: true; filledFields: CardFieldKey[] } | { ok: false; code: string }

interface CardFrameInspection {
  state: 'ready' | 'unavailable'
  code?: string
  fields?: CardFieldKey[]
  origin?: string
  frameId?: number
}

interface CardFrameTarget {
  origin: string
  frameIds: number[]
}

interface CardSurface {
  fields: CardFieldKey[]
  embedded: boolean
  targets: CardFrameTarget[]
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
        const page = topLevelPage(tab)
        if (!page.ok) return { state: 'unavailable', code: page.code }
        const inspected = await loginSurface().inspect({ browser, tabId: page.tabId, origin: page.origin })
        if (!inspected.ok) return { state: 'unavailable', code: inspected.code }
        return {
          state: 'ready',
          hasUsernameField: inspected.ready.hasUsernameField,
          hasPasswordField: inspected.ready.hasPasswordField,
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
        const page = topLevelPage(tab)
        if (!page.ok) return { state: 'unavailable', code: page.code }
        const inspected = await identitySurface().inspect({ browser, tabId: page.tabId, origin: page.origin })
        if (!inspected.ok) return { state: 'unavailable', code: inspected.code }
        return { state: 'ready', fields: inspected.ready.fields }
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
        const page = httpOnlyPage(tab)
        if (!page.ok) return { state: 'unavailable', code: page.code }
        const inspected = await cardSurface().inspect({ browser, tabId: page.tabId, origin: page.origin })
        return inspected.ok
          ? { state: 'ready', fields: inspected.ready.fields, embedded: inspected.ready.embedded }
          : { state: 'unavailable', code: inspected.code }
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

type PageResolution = Extract<ReturnType<typeof tabFillContext>, { ok: true }> | { ok: false; code: string }

interface SurfaceContext {
  browser: Browser
  tabId: number
  origin: string
  token: string
}

type Inspected<Ready> = { ok: true; ready: Ready } | { ok: false; code: string }

interface FillSurface<Ready extends object, ApprovalInput, Approved, Outcome extends { ok: boolean }> {
  resolvePage: (tab?: PageTab) => PageResolution
  inspect: (ctx: Pick<SurfaceContext, 'browser' | 'tabId' | 'origin'>) => Promise<Inspected<Ready>>
  unfillableCode?: (ready: Ready) => string | undefined
  prepare: (ctx: SurfaceContext, ready: Ready) => Promise<{ ok: true; approvalInput: ApprovalInput } | { ok: false; code: string }>
  requestApproval: (
    browser: Browser,
    origin: string,
    input: ApprovalInput,
    signal: AbortSignal
  ) => Promise<{ ok: true; approved: Approved } | { ok: false; code: string }>
  fill: (ctx: SurfaceContext, approved: Approved) => Promise<Outcome>
  cleanup: (ctx: SurfaceContext) => Promise<void>
  events?: {
    inspectionStarted?: () => void
    inspectionCompleted?: (ready: Ready, documentToken: string) => void
    approvalReceived?: (approved: Approved) => void
  }
}

function topLevelPage(tab?: PageTab): PageResolution {
  return tabFillContext(tab)
}

function httpOnlyPage(tab?: PageTab): PageResolution {
  const page = tabFillContext(tab)
  if (page.ok) return page
  const insecure = typeof tab?.url === 'string' && tab.url.startsWith('http:')
  return insecure ? { ok: false, code: 'insecure-page' } : page
}

async function runSurfaceFill<
  Ready extends object,
  ApprovalInput,
  Approved,
  Outcome extends { ok: boolean }
>(
  browser: Browser,
  signal: AbortSignal,
  surface: FillSurface<Ready, ApprovalInput, Approved, Outcome>
): Promise<{ ok: true; outcome: Extract<Outcome, { ok: true }> } | { ok: false; code: string }> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  const resolved = surface.resolvePage(tab)
  if (!resolved.ok) return { ok: false, code: resolved.code }

  const ctx: SurfaceContext = { browser, tabId: resolved.tabId, origin: resolved.origin, token: crypto.randomUUID() }
  surface.events?.inspectionStarted?.()

  try {
    const inspected = await surface.inspect(ctx)
    if (!inspected.ok) return { ok: false, code: inspected.code }
    const ready = inspected.ready
    const unfillable = surface.unfillableCode?.(ready)
    if (unfillable) return { ok: false, code: unfillable }

    const prep = await surface.prepare(ctx, ready)
    if (!prep.ok) return prep
    if (signal.aborted) return { ok: false, code: 'cancelled' }

    surface.events?.inspectionCompleted?.(ready, ctx.token)

    const approval = await surface.requestApproval(browser, ctx.origin, prep.approvalInput, signal)
    if (!approval.ok) return approval
    if (signal.aborted) return { ok: false, code: 'cancelled' }

    surface.events?.approvalReceived?.(approval.approved)

    const [currentTab] = await browser.tabs.query({ active: true, currentWindow: true })
    if (!isSameActivePage(resolved, currentTab)) return { ok: false, code: 'page-changed' }

    const outcome = await surface.fill(ctx, approval.approved)
    return outcome.ok
      ? { ok: true, outcome: outcome as Extract<Outcome, { ok: true }> }
      : { ok: false, code: (outcome as unknown as { code: string }).code }
  } catch {
    return { ok: false, code: signal.aborted ? 'cancelled' : 'page-restricted' }
  } finally {
    try {
      await surface.cleanup(ctx)
    } catch { /* noop */ }
  }
}

type ReadyLoginInspection = Extract<PageInspection, { ok: true }>
type ReadyIdentityInspection = Extract<IdentityPageInspection, { ok: true }>

function loginSurface(
  update?: (event: Parameters<typeof transition>[1]) => FillContext
): FillSurface<ReadyLoginInspection, FillFields, Credential, FillOutcome> {
  let prepared = false
  return {
    resolvePage: topLevelPage,
    async inspect({ browser, tabId, origin }) {
      await installContentBridge(browser, tabId)
      const [injection] = await browser.scripting.executeScript({
        target: { tabId },
        func: invokeBridgeInspection,
        args: ['sesameInspectLoginSurface'],
      })
      const inspection = normalizeInspection(injection?.result)
      if (!inspection.ok) return inspection
      if (inspection.surface.origin !== origin) return { ok: false, code: 'origin-mismatch' }
      return { ok: true, ready: inspection }
    },
    unfillableCode: (inspection) => (!inspection.hasPasswordField && !inspection.hasUsernameField ? 'no-fields' : undefined),
    async prepare(ctx) {
      const [preparation] = await ctx.browser.scripting.executeScript({
        target: { tabId: ctx.tabId },
        func: invokeBridgeFill,
        args: ['sesameFillLoginSurface', ctx.origin, ctx.token, null, 'prepare'],
      })
      const prep = normalizeFillOutcome(preparation?.result)
      if (!prep.ok) return prep
      prepared = true
      const approvalInput: FillFields = prep.usernameFilled && !prep.passwordFilled ? 'username'
        : prep.passwordFilled && !prep.usernameFilled ? 'password' : 'both'
      return { ok: true, approvalInput }
    },
    async requestApproval(browser, origin, input, signal) {
      const fill = await requestFill(browser, origin, { signal, fields: input })
      return fill.ok ? { ok: true, approved: fill.credential } : fill
    },
    async fill(ctx, approved) {
      const [injection] = await ctx.browser.scripting.executeScript({
        target: { tabId: ctx.tabId },
        func: invokeBridgeFill,
        args: ['sesameFillLoginSurface', ctx.origin, ctx.token, approved, 'fill'],
      })
      redactCredential({ credential: approved })
      return normalizeFillOutcome(injection?.result)
    },
    async cleanup(ctx) {
      if (!prepared) return
      await ctx.browser.scripting.executeScript({
        target: { tabId: ctx.tabId },
        func: invokeBridgeFill,
        args: ['sesameFillLoginSurface', ctx.origin, ctx.token, null, 'clear'],
      })
    },
    events: update ? {
      inspectionStarted: () => update({ type: 'inspection-started' }),
      inspectionCompleted: (inspection, documentToken) => update({ type: 'inspection-completed', inspection, documentToken }),
      approvalReceived: (credential) => update({ type: 'approval-received', credential }),
    } : undefined,
  }
}

function identitySurface(): FillSurface<ReadyIdentityInspection, readonly IdentityFieldKey[], IdentityFields, IdentityFillOutcome> {
  let prepared = false
  return {
    resolvePage: topLevelPage,
    async inspect({ browser, tabId, origin }) {
      await installContentBridge(browser, tabId)
      const [injection] = await browser.scripting.executeScript({
        target: { tabId },
        func: invokeBridgeInspection,
        args: ['sesameInspectIdentitySurface'],
      })
      const inspection = normalizeIdentityInspection(injection?.result)
      if (!inspection.ok) return inspection
      if (inspection.surface.origin !== origin) return { ok: false, code: 'origin-mismatch' }
      return { ok: true, ready: inspection }
    },
    async prepare(ctx, ready) {
      const [preparation] = await ctx.browser.scripting.executeScript({
        target: { tabId: ctx.tabId },
        func: invokeBridgeFill,
        args: ['sesameFillIdentitySurface', ctx.origin, ctx.token, null, 'prepare'],
      })
      const prep = normalizeIdentityFillOutcome(preparation?.result)
      if (!prep.ok) return prep
      prepared = true
      return { ok: true, approvalInput: ready.fields }
    },
    async requestApproval(browser, origin, input, signal) {
      const fill = await requestIdentityFill(browser, origin, input, { signal })
      return fill.ok ? { ok: true, approved: fill.identity } : fill
    },
    async fill(ctx, approved) {
      const [injection] = await ctx.browser.scripting.executeScript({
        target: { tabId: ctx.tabId },
        func: invokeBridgeFill,
        args: ['sesameFillIdentitySurface', ctx.origin, ctx.token, approved, 'fill'],
      })
      redactIdentity({ identity: approved })
      return normalizeIdentityFillOutcome(injection?.result)
    },
    async cleanup(ctx) {
      if (!prepared) return
      await ctx.browser.scripting.executeScript({
        target: { tabId: ctx.tabId },
        func: invokeBridgeFill,
        args: ['sesameFillIdentitySurface', ctx.origin, ctx.token, null, 'clear'],
      })
    },
  }
}

async function runFill(
  browser: Browser,
  signal: AbortSignal,
  update: (event: Parameters<typeof transition>[1]) => FillContext
): Promise<FillContext> {
  const result = await runSurfaceFill(browser, signal, loginSurface(update))
  return result.ok
    ? update({ type: 'fill-completed', usernameFilled: result.outcome.usernameFilled, passwordFilled: result.outcome.passwordFilled })
    : update({ type: 'failed', code: result.code })
}

async function runIdentityFill(browser: Browser, signal: AbortSignal): Promise<IdentityFillResult> {
  const result = await runSurfaceFill(browser, signal, identitySurface())
  return result.ok ? { ok: true, filledFields: result.outcome.filledFields } : result
}

async function installContentBridge(browser: Browser, tabId: number, allFrames = false): Promise<void> {
  await browser.scripting.executeScript({
    target: { tabId, allFrames },
    files: ['content.js'],
  })
}

export function normalizeCardInspection(raw: unknown, expectedOrigin: string, frameId = 0): CardFrameInspection {
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
    frameId,
  }
}

function invokeBridgeInspection(...args: unknown[]): unknown {
  const [name] = args
  if (typeof name !== 'string') return { ok: false, code: 'content-bridge-unavailable' }
  const inspect = (globalThis as Record<string, unknown>)[name]
  return typeof inspect === 'function' ? inspect() : { ok: false, code: 'content-bridge-unavailable' }
}

function invokeBridgeFill(...bridgeArgs: unknown[]): unknown {
  const [name, ...args] = bridgeArgs
  if (typeof name !== 'string') return { ok: false, code: 'content-bridge-unavailable' }
  const fill = (globalThis as Record<string, unknown>)[name]
  return typeof fill === 'function' ? fill(...args) : { ok: false, code: 'content-bridge-unavailable' }
}

function cardSurface(): FillSurface<CardSurface, CardFieldKey[], CardFields, CardFillResult> {
  const preparedTargets: CardFrameTarget[] = []
  let prepared = false
  let approvedCard: CardFields | undefined
  return {
    resolvePage: httpOnlyPage,
    async inspect({ browser, tabId, origin }) {
      await installContentBridge(browser, tabId, true)
      const injections = await browser.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: invokeBridgeInspection,
        args: ['sesameInspectCardSurface'],
      })
      const inspections = injections.map((injection) => normalizeCardInspection(injection.result, origin, injection.frameId ?? -1))
      const ready = inspections.filter((inspection): inspection is CardFrameInspection & {
        state: 'ready'
        fields: CardFieldKey[]
        origin: string
        frameId: number
      } => inspection.state === 'ready'
        && inspection.origin !== undefined
        && inspection.fields !== undefined
        && inspection.frameId !== undefined)
      if (ready.length === 0) {
        return inspections.some((inspection) => inspection.code === 'untrusted-frame')
          ? { ok: false, code: 'untrusted-frame' }
          : { ok: false, code: 'no-fields' }
      }
      const grouped = new Map<string, CardFrameTarget & { fields: CardFieldKey[] }>()
      for (const inspection of ready) {
        const target = grouped.get(inspection.origin) ?? { origin: inspection.origin, frameIds: [], fields: [] }
        if (!target.frameIds.includes(inspection.frameId)) target.frameIds.push(inspection.frameId)
        for (const field of inspection.fields) {
          if (!target.fields.includes(field)) target.fields.push(field)
        }
        grouped.set(inspection.origin, target)
      }
      const targets = [...grouped.values()]
      return {
        ok: true,
        ready: {
          fields: [...new Set(targets.flatMap((target) => target.fields))],
          embedded: targets.some((target) => target.frameIds.some((frameId) => frameId !== 0)),
          targets,
        },
      }
    },
    async prepare(ctx, surface) {
      const requestedFields = new Set<CardFieldKey>()
      for (const target of surface.targets) {
        const preparations = await ctx.browser.scripting.executeScript({
          target: { tabId: ctx.tabId, frameIds: target.frameIds },
          func: invokeBridgeFill,
          args: ['sesameFillCardSurface', target.origin, ctx.token, null, 'prepare'],
        })
        const fields = collectCardFillFields(preparations.map((preparation) => preparation.result))
        if (fields.length > 0) preparedTargets.push(target)
        for (const field of fields) requestedFields.add(field)
      }
      if (requestedFields.size === 0) return { ok: false, code: 'no-fields' }
      prepared = true
      return { ok: true, approvalInput: [...requestedFields] }
    },
    async requestApproval(browser, origin, input, signal) {
      const fill = await requestCardFill(browser, origin, input, { signal })
      if (!fill.ok) return fill
      approvedCard = fill.card
      return { ok: true, approved: approvedCard }
    },
    async fill(ctx) {
      const writtenFields = new Set<CardFieldKey>()
      for (const target of preparedTargets) {
        const writes = await ctx.browser.scripting.executeScript({
          target: { tabId: ctx.tabId, frameIds: target.frameIds },
          func: invokeBridgeFill,
          args: ['sesameFillCardSurface', target.origin, ctx.token, approvedCard, 'fill'],
        })
        for (const field of collectCardFillFields(writes.map((write) => write.result))) writtenFields.add(field)
      }
      const filledFields = [...writtenFields]
      return filledFields.length ? { ok: true, filledFields } : { ok: false, code: 'field-write-failed' }
    },
    async cleanup(ctx) {
      if (approvedCard) redactCard(approvedCard)
      if (!prepared) return
      await Promise.allSettled(preparedTargets.map((target) => ctx.browser.scripting.executeScript({
        target: { tabId: ctx.tabId, frameIds: target.frameIds },
        func: invokeBridgeFill,
        args: ['sesameFillCardSurface', target.origin, ctx.token, null, 'clear'],
      })))
    },
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

async function runCardFill(browser: Browser, signal: AbortSignal): Promise<CardFillResult> {
  const result = await runSurfaceFill(browser, signal, cardSurface())
  return result.ok ? { ok: true, filledFields: result.outcome.filledFields } : result
}
