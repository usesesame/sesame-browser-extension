import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Browser, ScriptInjectionDetails } from '../../src/platform/chrome'

const native = vi.hoisted(() => ({ requestIdentityFill: vi.fn() }))

vi.mock('../../src/background/native-connection', () => ({
  probeNativeHost: vi.fn(),
  requestFill: vi.fn(),
  requestIdentityFill: native.requestIdentityFill,
  requestCardFill: vi.fn(),
}))

import { createCoordinator } from '../../src/background/coordinator'

const pageOrigin = 'https://example.test'

function browserForIdentityPage(): Browser {
  return {
    runtime: {
      getManifest: () => ({ version: '0.1.0' }),
      getURL: (path) => path,
      connectNative: vi.fn(),
    },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 5, url: `${pageOrigin}/checkout` }]),
    },
    scripting: {
      executeScript: vi.fn(async (details: ScriptInjectionDetails<unknown>) => {
        if ('files' in details) return []
        if (details.func.name === 'invokeBridgeInspection') {
          return [{ result: { ok: true, surface: { ok: true, origin: pageOrigin }, fields: ['fullName', 'email'] } }]
        }
        const phase = details.args?.[4]
        if (phase === 'fill') return [{ result: { ok: true, filledFields: ['fullName', 'email'] } }]
        return [{ result: { ok: true, filledFields: [] } }]
      }) as unknown as Browser['scripting']['executeScript'],
    },
  }
}

beforeEach(() => {
  native.requestIdentityFill.mockReset()
  native.requestIdentityFill.mockResolvedValue({
    ok: true,
    identity: { fullName: 'Jamie Example', email: 'jamie@example.test' },
  })
})

describe('identity coordinator', () => {
  it('fills the active page and reports success', async () => {
    const browser = browserForIdentityPage()
    const coordinator = createCoordinator(browser)

    await expect(coordinator.fillIdentityActivePage()).resolves.toEqual({
      ok: true,
      filledFields: ['fullName', 'email'],
    })
    expect(native.requestIdentityFill).toHaveBeenCalledWith(
      browser,
      pageOrigin,
      ['fullName', 'email'],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('cancels the fill when the caller aborts while awaiting desktop approval', async () => {
    const browser = browserForIdentityPage()
    const coordinator = createCoordinator(browser)
    const controller = new AbortController()
    native.requestIdentityFill.mockImplementation(
      (_browser: Browser, _origin: string, _fields: readonly string[], options: { signal?: AbortSignal }) =>
        new Promise((resolve) => {
          options.signal?.addEventListener('abort', () => resolve({ ok: false, code: 'cancelled' }), { once: true })
        }),
    )

    const pending = coordinator.fillIdentityActivePage(controller.signal)
    controller.abort()
    const result = await pending

    expect(result).toEqual({ ok: false, code: 'cancelled' })
  })
})
