import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Browser, ScriptInjectionDetails } from '../../src/platform/chrome'

const native = vi.hoisted(() => ({ requestTotpCode: vi.fn() }))

vi.mock('../../src/background/native-connection', () => ({
  probeNativeHost: vi.fn(),
  requestFill: vi.fn(),
  requestIdentityFill: vi.fn(),
  requestCardFill: vi.fn(),
  requestTotpCode: native.requestTotpCode,
}))

import { createCoordinator } from '../../src/background/coordinator'

const pageOrigin = 'https://example.test'

function browserForCodePage(surfaceOrigin = pageOrigin, kind: 'single' | 'split' = 'single'): Browser {
  return {
    runtime: {
      getManifest: () => ({ version: '0.1.0' }),
      getURL: (path) => path,
      connectNative: vi.fn(),
    },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 11, url: `${pageOrigin}/login` }]),
    },
    scripting: {
      executeScript: vi.fn(async (details: ScriptInjectionDetails<unknown>) => {
        if ('files' in details) return []
        if (details.func.name === 'invokeBridgeInspection') {
          return [{
            result: {
              ok: true,
              surface: { ok: true, origin: surfaceOrigin },
              kind,
              fields: kind === 'split' ? 6 : 1,
            },
          }]
        }
        const phase = details.args?.[4]
        if (phase === 'prepare') return [{ result: { ok: true, kind, filledFields: kind === 'split' ? 6 : 1 } }]
        if (phase === 'fill') return [{ result: { ok: true, kind, filledFields: kind === 'split' ? 6 : 1 } }]
        return [{ result: { ok: true, kind, filledFields: 0 } }]
      }) as unknown as Browser['scripting']['executeScript'],
    },
  }
}

beforeEach(() => {
  native.requestTotpCode.mockReset()
  native.requestTotpCode.mockResolvedValue({
    ok: true,
    totpCode: '287082',
    remainingSeconds: 18,
  })
})

describe('one-time code coordinator', () => {
  it('asks for a code for the exact page origin and fills it', async () => {
    const browser = browserForCodePage()
    const coordinator = createCoordinator(browser)

    await expect(coordinator.fillOneTimeCodeActivePage()).resolves.toEqual({
      ok: true,
      remainingSeconds: 18,
    })
    expect(native.requestTotpCode).toHaveBeenCalledWith(
      browser,
      pageOrigin,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('reports the surface kind without returning page text', async () => {
    const browser = browserForCodePage(pageOrigin, 'split')
    const coordinator = createCoordinator(browser)

    await expect(coordinator.inspectOneTimeCodeActivePage()).resolves.toEqual({
      state: 'ready',
      kind: 'split',
    })
  })

  it('clears the code from the delivered result after the write', async () => {
    const browser = browserForCodePage()
    const coordinator = createCoordinator(browser)
    const delivered = { ok: true, totpCode: '287082', remainingSeconds: 18 }
    native.requestTotpCode.mockResolvedValue(delivered)

    await expect(coordinator.fillOneTimeCodeActivePage()).resolves.toEqual({
      ok: true,
      remainingSeconds: 18,
    })
    expect(delivered.totpCode).toBe('')
  })

  it('refuses a content surface that reports another origin', async () => {
    const browser = browserForCodePage('https://lookalike.test')
    const coordinator = createCoordinator(browser)

    await expect(coordinator.fillOneTimeCodeActivePage()).resolves.toEqual({
      ok: false,
      code: 'origin-mismatch',
    })
    expect(native.requestTotpCode).not.toHaveBeenCalled()
  })

  it('reports an unavailable inspection when the surface fails closed', async () => {
    const browser = browserForCodePage()
    const executeScript = browser.scripting.executeScript as unknown as ReturnType<typeof vi.fn>
    executeScript.mockImplementation(async (details: ScriptInjectionDetails<unknown>) => {
      if ('files' in details) return []
      if (details.func.name === 'invokeBridgeInspection') {
        return [{ result: { ok: false, code: 'multiple-matches' } }]
      }
      return [{ result: { ok: true, kind: 'single', filledFields: 1 } }]
    })
    const coordinator = createCoordinator(browser)

    await expect(coordinator.inspectOneTimeCodeActivePage()).resolves.toEqual({
      state: 'unavailable',
      code: 'multiple-matches',
    })
  })

  it('cancels the code request when the caller aborts', async () => {
    const browser = browserForCodePage()
    const coordinator = createCoordinator(browser)
    const controller = new AbortController()
    native.requestTotpCode.mockImplementation(
      (_browser: Browser, _origin: string, options: { signal?: AbortSignal }) =>
        new Promise((resolve) => {
          options.signal?.addEventListener('abort', () => resolve({ ok: false, code: 'cancelled' }), { once: true })
        }),
    )

    const pending = coordinator.fillOneTimeCodeActivePage(controller.signal)
    controller.abort()

    await expect(pending).resolves.toEqual({ ok: false, code: 'cancelled' })
  })
})
