import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Browser, ScriptInjectionDetails } from '../../src/platform/chrome'

vi.mock('../../src/background/native-connection', () => ({
  probeNativeHost: vi.fn(),
  requestFill: vi.fn(),
  requestIdentityFill: vi.fn(),
  requestCardFill: vi.fn(),
  requestTotpCode: vi.fn(),
}))

import { createCoordinator } from '../../src/background/coordinator'
import { pageSurfaceView } from '../../src/popup/page-surfaces'

const pageOrigin = 'https://example.test'

type BridgeReply = unknown | (() => Promise<unknown>)

const DEFAULT_REPLIES: Record<string, BridgeReply> = {
  sesameInspectPasswordSurface: 'login',
  sesameInspectLoginSurface: { ok: true, surface: { ok: true, origin: pageOrigin }, hasPasswordField: true, hasUsernameField: true },
  sesameInspectIdentitySurface: { ok: true, surface: { ok: true, origin: pageOrigin }, fields: ['fullName', 'email'] },
  sesameInspectCardSurface: { ok: true, origin: pageOrigin, fields: ['cardholderName'], embedded: false },
  sesameInspectOneTimeCodeSurface: { ok: true, surface: { ok: true, origin: pageOrigin }, kind: 'single', fields: 1 },
}

function browserForPage(options: {
  url?: string
  replies?: Record<string, BridgeReply>
  injectFails?: boolean
  inject?: () => Promise<void>
} = {}) {
  const replies = { ...DEFAULT_REPLIES, ...options.replies }
  const executeScript = vi.fn(async (details: ScriptInjectionDetails<unknown>) => {
    if ('files' in details) {
      if (options.injectFails) throw new Error('Cannot access contents of the page')
      await options.inject?.()
      return []
    }
    const name = details.args?.[0] as string
    const reply = replies[name]
    const result = typeof reply === 'function' ? await (reply as () => Promise<unknown>)() : reply
    return [{ frameId: 0, result }]
  })
  const browser: Browser = {
    runtime: {
      getManifest: () => ({ version: '0.1.0' }),
      getURL: (path) => path,
      connectNative: vi.fn(),
    },
    tabs: { query: vi.fn().mockResolvedValue([{ id: 5, url: options.url ?? `${pageOrigin}/sign-in` }]) },
    scripting: { executeScript: executeScript as unknown as Browser['scripting']['executeScript'] },
  }
  return { browser, executeScript }
}

function fileInjections(executeScript: ReturnType<typeof vi.fn>) {
  return executeScript.mock.calls.filter(([details]) => 'files' in (details as object))
}

describe('popup page inspection in the background', () => {
  afterEach(() => { vi.useRealTimers() })

  it('injects the content script once for every check on the page', async () => {
    const { browser, executeScript } = browserForPage()
    const result = await createCoordinator(browser).inspectActivePageSurfaces({ cards: true })

    expect(result).toEqual({
      state: 'checked',
      purpose: 'login',
      login: { state: 'ready', hasUsernameField: true, hasPasswordField: true },
      identity: { state: 'ready', fields: ['fullName', 'email'] },
      card: { state: 'ready', fields: ['cardholderName'], embedded: false },
      oneTimeCode: { state: 'ready', kind: 'single' },
    })
    expect(fileInjections(executeScript)).toEqual([
      [{ target: { tabId: 5, allFrames: true }, files: ['content.js'] }],
    ])
  })

  it('keeps a working login form when the card check never answers', async () => {
    const { browser } = browserForPage({
      replies: { sesameInspectCardSurface: () => new Promise(() => {}) },
    })
    const result = await createCoordinator(browser).inspectActivePageSurfaces({ cards: true, checkTimeoutMs: 50 })

    expect(result).toMatchObject({
      state: 'checked',
      login: { state: 'ready', hasPasswordField: true },
      card: { state: 'unavailable', code: 'page-check-failed' },
    })
    expect(pageSurfaceView(result)).toMatchObject({ kind: 'login', cardFields: [] })
  })

  it('counts a slow content script setup against the same page check budget', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const { browser } = browserForPage({
      inject: () => new Promise((done) => setTimeout(done, 2_500)),
      replies: { sesameInspectCardSurface: () => new Promise(() => {}) },
    })
    let result: unknown
    void createCoordinator(browser).inspectActivePageSurfaces({ cards: true, checkTimeoutMs: 4_000 })
      .then((value) => { result = value })

    await vi.advanceTimersByTimeAsync(3_999)
    expect(result).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)

    expect(result).toMatchObject({
      state: 'checked',
      login: { state: 'ready', hasPasswordField: true },
      card: { state: 'unavailable', code: 'page-check-failed' },
    })
    expect(pageSurfaceView(result)).toMatchObject({ kind: 'login', cardFields: [] })
  })

  it('reports an unchecked page, not a restricted one, when the content script setup outlasts the budget', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const { browser, executeScript } = browserForPage({ inject: () => new Promise(() => {}) })
    let result: unknown
    void createCoordinator(browser).inspectActivePageSurfaces({ cards: true, checkTimeoutMs: 4_000 })
      .then((value) => { result = value })

    await vi.advanceTimersByTimeAsync(4_000)

    expect(result).toMatchObject({ state: 'checked', login: { state: 'unavailable', code: 'page-check-failed' } })
    expect(pageSurfaceView(result).kind).toBe('unchecked')
    expect(executeScript).toHaveBeenCalledTimes(1)
  })

  it('keeps a working login form when the identity check throws', async () => {
    const { browser } = browserForPage({
      replies: { sesameInspectIdentitySurface: async () => { throw new Error('frame went away') } },
    })
    const result = await createCoordinator(browser).inspectActivePageSurfaces({ cards: true })

    expect(result).toMatchObject({
      state: 'checked',
      login: { state: 'ready' },
      identity: { state: 'unavailable', code: 'page-check-failed' },
    })
    expect(pageSurfaceView(result)).toMatchObject({ kind: 'login', identityFields: [], codeKind: 'single' })
  })

  it('does not run the card check when card suggestions are off', async () => {
    const { browser, executeScript } = browserForPage()
    const result = await createCoordinator(browser).inspectActivePageSurfaces({ cards: false })

    expect(result).toMatchObject({ card: { state: 'unavailable', code: 'card-suggestions-disabled' } })
    expect(executeScript.mock.calls.some(([details]) => (details as { args?: unknown[] }).args?.[0] === 'sesameInspectCardSurface')).toBe(false)
  })

  it('reports a restricted page when the browser refuses the content script', async () => {
    const { browser, executeScript } = browserForPage({ injectFails: true })
    const result = await createCoordinator(browser).inspectActivePageSurfaces({ cards: true })

    expect(result).toEqual({ state: 'restricted', code: 'page-restricted' })
    expect(executeScript).toHaveBeenCalledTimes(1)
    expect(pageSurfaceView(result).kind).toBe('restricted')
  })

  it('reports a restricted page for a browser page without injecting', async () => {
    const { browser, executeScript } = browserForPage({ url: 'chrome://settings/' })
    const result = await createCoordinator(browser).inspectActivePageSurfaces({ cards: true })

    expect(result).toEqual({ state: 'restricted', code: 'page-restricted' })
    expect(executeScript).not.toHaveBeenCalled()
  })
})

describe('the popup page view', () => {
  it('shows a check that did not finish as unchecked, never as restricted', () => {
    expect(pageSurfaceView(undefined)).toMatchObject({ kind: 'unchecked', code: 'page-check-failed' })
    expect(pageSurfaceView({ state: 'unavailable', code: 'page-check-failed' })).toMatchObject({ kind: 'unchecked' })
    expect(pageSurfaceView({
      state: 'checked',
      purpose: null,
      login: { state: 'unavailable', code: 'page-check-failed' },
      identity: { state: 'ready', fields: ['email'] },
    })).toMatchObject({ kind: 'unchecked', identityFields: ['email'] })
  })

  it('treats a failed purpose check as a plain login form', () => {
    expect(pageSurfaceView({
      state: 'checked',
      purpose: null,
      login: { state: 'ready', hasUsernameField: true, hasPasswordField: true },
    })).toMatchObject({ kind: 'login', code: 'sign-in-form-found' })
  })

  it('keeps the registration and change classifications', () => {
    const login = { state: 'ready', hasUsernameField: true, hasPasswordField: true }
    expect(pageSurfaceView({ state: 'checked', purpose: 'registration', login }).kind).toBe('registration')
    expect(pageSurfaceView({ state: 'checked', purpose: 'password-change', login }).kind).toBe('password-change')
    expect(pageSurfaceView({ state: 'checked', purpose: 'something-else', login }).kind).toBe('ambiguous')
  })

  it('separates no fields and more than one form from a restricted page', () => {
    expect(pageSurfaceView({ state: 'checked', login: { state: 'unavailable', code: 'no-fields' } }).kind).toBe('none')
    expect(pageSurfaceView({ state: 'checked', login: { state: 'unavailable', code: 'multiple-matches' } }).kind).toBe('ambiguous')
  })

  it('drops malformed field lists and one-time code kinds', () => {
    expect(pageSurfaceView({
      state: 'checked',
      login: { state: 'unavailable', code: 'no-fields' },
      identity: { state: 'ready', fields: ['email', 7] },
      card: { state: 'ready', fields: 'number' },
      oneTimeCode: { state: 'ready', kind: 'other' },
    })).toMatchObject({ identityFields: ['email'], cardFields: [], codeKind: null })
  })
})
