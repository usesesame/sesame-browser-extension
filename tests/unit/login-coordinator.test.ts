import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Browser, ScriptInjectionDetails } from '../../src/platform/chrome'

const native = vi.hoisted(() => ({ requestFill: vi.fn() }))

vi.mock('../../src/background/native-connection', () => ({
  probeNativeHost: vi.fn(),
  requestFill: native.requestFill,
  requestIdentityFill: vi.fn(),
  requestCardFill: vi.fn(),
}))

import { createCoordinator } from '../../src/background/coordinator'

const pageOrigin = 'https://example.test'

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
          return [{ result: { ok: true, surface: { ok: true, origin: pageOrigin }, hasPasswordField: true, hasUsernameField: true } }]
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
  native.requestFill.mockResolvedValue({ ok: true, credential: { username: 'jamie', password: 'hunter2' } })
})

describe('login coordinator', () => {
  it('fills the active page and reports success', async () => {
    const browser = browserForLoginPage()
    const coordinator = createCoordinator(browser)

    const result = await coordinator.fillActivePage()

    expect(result.phase).toEqual({ name: 'complete', usernameFilled: true, passwordFilled: true })
    expect(native.requestFill).toHaveBeenCalledWith(
      browser,
      pageOrigin,
      expect.objectContaining({ signal: expect.any(AbortSignal), fields: 'both' }),
    )
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
})
