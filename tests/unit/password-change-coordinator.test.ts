import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Browser, ScriptInjectionDetails } from '../../src/platform/chrome'

const native = vi.hoisted(() => ({ requestFill: vi.fn() }))
const recorded = vi.hoisted(() => ({ fillCredential: null as Record<string, unknown> | null }))

vi.mock('../../src/background/native-connection', () => ({
  probeNativeHost: vi.fn(),
  requestFill: native.requestFill,
  requestIdentityFill: vi.fn(),
  requestCardFill: vi.fn(),
}))

import { createCoordinator } from '../../src/background/coordinator'

const pageOrigin = 'https://example.test'
const generatedPassword = 'fictional-generated-pass-1'

function browserForChangePage(kind: string): Browser {
  return {
    runtime: {
      getManifest: () => ({ version: '0.1.0' }),
      getURL: (path) => path,
      connectNative: vi.fn(),
    },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 5, url: `${pageOrigin}/settings/password` }]),
    },
    scripting: {
      executeScript: vi.fn(async (details: ScriptInjectionDetails<unknown>) => {
        if ('files' in details) return []
        if (details.func.name === 'invokeBridgeInspection') return [{ result: kind }]
        const phase = details.args?.[5]
        if (phase === 'clear') return [{ result: { version: 1, ok: true, code: 'password-change-filled', currentFilled: 0, newFilled: 0 } }]
        if (phase === 'fill') recorded.fillCredential = { ...(details.args?.[3] as Record<string, unknown>) }
        return [{ result: { version: 1, ok: true, code: 'password-change-filled', currentFilled: 1, newFilled: 2 } }]
      }) as unknown as Browser['scripting']['executeScript'],
    },
  }
}

beforeEach(() => {
  native.requestFill.mockReset()
  recorded.fillCredential = null
  native.requestFill.mockResolvedValue({ ok: true, credential: { username: '', password: 'fictional-current-pass-1' } })
})

describe('password change coordinator', () => {
  it('requests only the password, fills the change surface, and reports the captured page', async () => {
    const browser = browserForChangePage('password-change')
    const coordinator = createCoordinator(browser)

    const result = await coordinator.changePasswordActivePage(generatedPassword)

    expect(result).toEqual({
      ok: true,
      tabId: 5,
      origin: pageOrigin,
      username: '',
      currentFilled: 1,
      newFilled: 2,
    })
    expect(native.requestFill).toHaveBeenCalledWith(
      browser,
      pageOrigin,
      expect.objectContaining({ signal: expect.any(AbortSignal), fields: 'password' }),
    )
    expect(recorded.fillCredential).toEqual({ username: '', password: 'fictional-current-pass-1' })
    const fillCall = (browser.scripting.executeScript as ReturnType<typeof vi.fn>).mock.calls
      .find(([details]) => details.args?.[5] === 'fill')
    expect(fillCall?.[0].args?.slice(0, 3)).toEqual(['sesameFillPasswordChangeSurface', pageOrigin, expect.any(String)])
    expect(fillCall?.[0].args?.[4]).toBe(generatedPassword)
    expect(fillCall?.[0].args?.[5]).toBe('fill')
  })

  it('refuses a surface that is not a password-change form without asking the desktop', async () => {
    const browser = browserForChangePage('login')
    const coordinator = createCoordinator(browser)

    await expect(coordinator.changePasswordActivePage(generatedPassword)).resolves.toEqual({
      ok: false,
      code: 'not-password-change-form',
    })
    expect(native.requestFill).not.toHaveBeenCalled()
  })

  it('passes a declined approval back and fills nothing', async () => {
    native.requestFill.mockResolvedValue({ ok: false, code: 'approval-declined' })
    const browser = browserForChangePage('password-change')
    const coordinator = createCoordinator(browser)

    await expect(coordinator.changePasswordActivePage(generatedPassword)).resolves.toEqual({
      ok: false,
      code: 'approval-declined',
    })
    const fillCall = (browser.scripting.executeScript as ReturnType<typeof vi.fn>).mock.calls
      .find(([details]) => details.args?.[5] === 'fill')
    expect(fillCall).toBeUndefined()
  })

  it('refuses a second change while one is in flight', async () => {
    let settle: (value: { ok: false; code: string }) => void = () => {}
    native.requestFill.mockImplementation(
      () => new Promise((resolve) => { settle = resolve }),
    )
    const browser = browserForChangePage('password-change')
    const coordinator = createCoordinator(browser)

    const first = coordinator.changePasswordActivePage(generatedPassword)
    await expect(coordinator.changePasswordActivePage(generatedPassword)).resolves.toEqual({
      ok: false,
      code: 'fill-in-progress',
    })

    settle({ ok: false, code: 'approval-declined' })
    await expect(first).resolves.toEqual({ ok: false, code: 'approval-declined' })
  })
})
