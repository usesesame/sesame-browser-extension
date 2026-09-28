import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Browser, ScriptFunctionInjection, ScriptInjectionDetails } from '../../src/platform/chrome'

const native = vi.hoisted(() => ({ requestFill: vi.fn() }))

vi.mock('../../src/background/native-connection', () => ({
  probeNativeHost: vi.fn(),
  requestFill: native.requestFill,
  requestIdentityFill: vi.fn(),
  requestCardFill: vi.fn(),
}))

import { createCoordinator, selectSameOriginSurface } from '../../src/background/coordinator'
import { normalizeInspection } from '../../src/protocol/fill'

const pageOrigin = 'https://example.test'
const otherOrigin = 'https://other.example.test'

function readyLogin(origin: string) {
  return {
    ok: true as const,
    surface: { ok: true as const, origin },
    hasPasswordField: true,
    hasUsernameField: true,
  }
}

describe('selectSameOriginSurface', () => {
  it('prefers the top frame when it has a surface', () => {
    expect(selectSameOriginSurface([
      { frameId: 0, result: readyLogin(pageOrigin) },
      { frameId: 4, result: readyLogin(pageOrigin) },
    ], pageOrigin, normalizeInspection)).toEqual({ ok: true, frameId: 0, ready: readyLogin(pageOrigin) })
  })

  it('selects one same-origin child frame when the top frame has no fields', () => {
    expect(selectSameOriginSurface([
      { frameId: 0, result: { ok: false, code: 'no-fields' } },
      { frameId: 4, result: readyLogin(pageOrigin) },
    ], pageOrigin, normalizeInspection)).toEqual({ ok: true, frameId: 4, ready: readyLogin(pageOrigin) })
  })

  it('ignores a cross-origin child frame', () => {
    expect(selectSameOriginSurface([
      { frameId: 0, result: { ok: false, code: 'no-fields' } },
      { frameId: 4, result: readyLogin(otherOrigin) },
    ], pageOrigin, normalizeInspection)).toEqual({ ok: false, code: 'no-fields' })
  })

  it('fails closed when more than one same-origin child frame has a surface', () => {
    expect(selectSameOriginSurface([
      { frameId: 0, result: { ok: false, code: 'no-fields' } },
      { frameId: 4, result: readyLogin(pageOrigin) },
      { frameId: 9, result: readyLogin(pageOrigin) },
    ], pageOrigin, normalizeInspection)).toEqual({ ok: false, code: 'multiple-matches' })
  })

  it('refuses when the top frame reports a different origin', () => {
    expect(selectSameOriginSurface([
      { frameId: 0, result: readyLogin(otherOrigin) },
      { frameId: 4, result: readyLogin(pageOrigin) },
    ], pageOrigin, normalizeInspection)).toEqual({ ok: false, code: 'origin-mismatch' })
  })

  it('drops results without a browser-provided frame id', () => {
    expect(selectSameOriginSurface([
      { result: readyLogin(pageOrigin) },
    ], pageOrigin, normalizeInspection)).toEqual({ ok: false, code: 'no-fields' })
  })
})

function browserForLoginPage(): Browser {
  return {
    runtime: {
      getManifest: () => ({ version: '0.1.0' }),
      getURL: (path) => path,
      connectNative: vi.fn(),
    },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 3, url: `${pageOrigin}/login` }]),
    },
    scripting: {
      executeScript: vi.fn(async (details: ScriptInjectionDetails<unknown>) => {
        if ('files' in details) return []
        if (details.func.name === 'invokeBridgeInspection') {
          return [{ frameId: 0, result: { ok: true, surface: { ok: true, origin: pageOrigin }, hasPasswordField: true, hasUsernameField: true } }]
        }
        const phase = details.args?.[4]
        if (phase === 'prepare') return [{ result: { ok: true, usernameFilled: true, passwordFilled: true } }]
        if (phase === 'fill') return [{ result: { ok: true, usernameFilled: true, passwordFilled: true } }]
        return [{ result: { ok: true, usernameFilled: false, passwordFilled: false } }]
      }) as unknown as Browser['scripting']['executeScript'],
    },
  }
}

beforeEach(() => {
  native.requestFill.mockReset()
  native.requestFill.mockResolvedValue({
    ok: true,
    credential: { username: 'jamie', password: 'hunter2' },
    matchKind: 'exact',
  })
})

describe('login coordinator', () => {
  it('fills the active page and reports success', async () => {
    const browser = browserForLoginPage()
    const coordinator = createCoordinator(browser)

    const result = await coordinator.fillActivePage()

    expect(result.phase).toEqual({
      name: 'complete',
      usernameFilled: true,
      passwordFilled: true,
      matchKind: 'exact',
    })
    expect(native.requestFill).toHaveBeenCalledWith(
      browser,
      pageOrigin,
      expect.objectContaining({ signal: expect.any(AbortSignal), fields: 'both' }),
    )
  })

  it('keeps the matched rule the desktop reported', async () => {
    native.requestFill.mockResolvedValue({
      ok: true,
      credential: { username: 'jamie', password: 'hunter2' },
      matchKind: 'wwwAlias',
    })
    const coordinator = createCoordinator(browserForLoginPage())

    const result = await coordinator.fillActivePage()

    expect(result.phase).toEqual({
      name: 'complete',
      usernameFilled: true,
      passwordFilled: true,
      matchKind: 'wwwAlias',
    })
  })

  it('reports a lookalike warning without writing a credential', async () => {
    native.requestFill.mockResolvedValue({
      ok: false,
      code: 'lookalike-domain',
      lookalike: 'apple.example',
    })
    const browser = browserForLoginPage()
    const coordinator = createCoordinator(browser)

    await expect(coordinator.fillActivePage()).resolves.toEqual({
      phase: { name: 'failed', code: 'lookalike-domain', lookalike: 'apple.example' },
    })
    const writes = bridgeFillCalls(browser)
    expect(writes.some((details) => details.args?.[4] === 'fill')).toBe(false)
    for (const details of writes) {
      expect(['prepare', 'clear']).toContain(details.args?.[4])
    }
  })

  it('cancels the fill when the caller aborts while awaiting desktop approval', async () => {
    const browser = browserForLoginPage()
    const coordinator = createCoordinator(browser)
    const controller = new AbortController()
    native.requestFill.mockImplementation(
      (_browser: Browser, _origin: string, options: { signal?: AbortSignal }) =>
        new Promise((resolve) => {
          options.signal?.addEventListener('abort', () => resolve({ ok: false, code: 'cancelled' }), { once: true })
        }),
    )

    const pending = coordinator.fillActivePage(controller.signal)
    controller.abort()
    const result = await pending

    expect(result.phase).toEqual({ name: 'failed', code: 'cancelled' })
  })

  it('fills one same-origin child frame and keeps every write bound to it', async () => {
    const browser = browserForFramedLogin([
      { frameId: 0, result: { ok: false, code: 'no-fields' } },
      { frameId: 4, result: readyLogin(pageOrigin) },
    ])
    const coordinator = createCoordinator(browser)

    await expect(coordinator.fillActivePage()).resolves.toEqual({
      phase: { name: 'complete', usernameFilled: true, passwordFilled: true, matchKind: 'exact' },
    })
    expect(native.requestFill).toHaveBeenCalledWith(
      browser,
      pageOrigin,
      expect.objectContaining({ signal: expect.any(AbortSignal), fields: 'both' }),
    )
    const writes = bridgeFillCalls(browser)
    expect(writes).toHaveLength(3)
    for (const details of writes) {
      expect(details.target).toEqual({ tabId: 3, frameIds: [4] })
      expect(details.args?.[1]).toBe(pageOrigin)
    }
  })

  it('does not fill a cross-origin child frame', async () => {
    const browser = browserForFramedLogin([
      { frameId: 0, result: { ok: false, code: 'no-fields' } },
      { frameId: 4, result: readyLogin(otherOrigin) },
    ])
    const coordinator = createCoordinator(browser)

    await expect(coordinator.fillActivePage()).resolves.toEqual({ phase: { name: 'failed', code: 'no-fields' } })
    expect(native.requestFill).not.toHaveBeenCalled()
    expect(bridgeFillCalls(browser)).toHaveLength(0)
  })

  it('fails closed when two same-origin child frames have a surface', async () => {
    const browser = browserForFramedLogin([
      { frameId: 0, result: { ok: false, code: 'no-fields' } },
      { frameId: 4, result: readyLogin(pageOrigin) },
      { frameId: 9, result: readyLogin(pageOrigin) },
    ])
    const coordinator = createCoordinator(browser)

    await expect(coordinator.fillActivePage()).resolves.toEqual({ phase: { name: 'failed', code: 'multiple-matches' } })
    expect(native.requestFill).not.toHaveBeenCalled()
    expect(bridgeFillCalls(browser)).toHaveLength(0)
  })
})

function browserForFramedLogin(inspections: Array<{ frameId: number; result: unknown }>): Browser {
  return {
    runtime: {
      getManifest: () => ({ version: '0.1.0' }),
      getURL: (path) => path,
      connectNative: vi.fn(),
    },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 3, url: `${pageOrigin}/login` }]),
    },
    scripting: {
      executeScript: vi.fn(async (details: ScriptInjectionDetails<unknown>) => {
        if ('files' in details) return []
        if (details.func.name === 'invokeBridgeInspection') return inspections
        return [{ result: { ok: true, usernameFilled: true, passwordFilled: true } }]
      }) as unknown as Browser['scripting']['executeScript'],
    },
  }
}

function bridgeFillCalls(browser: Browser): ScriptFunctionInjection<unknown>[] {
  return (browser.scripting.executeScript as ReturnType<typeof vi.fn>).mock.calls
    .map(([details]) => details as ScriptInjectionDetails<unknown>)
    .filter((details): details is ScriptFunctionInjection<unknown> => !('files' in details) && details.func.name === 'invokeBridgeFill')
}
