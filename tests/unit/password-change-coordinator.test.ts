import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Browser, ScriptInjectionDetails } from '../../src/platform/chrome'

const native = vi.hoisted(() => ({ requestFill: vi.fn(), requestChange: vi.fn(), requestCreate: vi.fn(), requestPending: vi.fn() }))
const recorded = vi.hoisted(() => ({ fillCredential: null as Record<string, unknown> | null, fillOk: true }))

vi.mock('../../src/background/native-connection', () => ({
  probeNativeHost: vi.fn(),
  requestFill: native.requestFill,
  requestChange: native.requestChange,
  requestCreate: native.requestCreate,
  requestPending: native.requestPending,
  requestIdentityFill: vi.fn(),
  requestCardFill: vi.fn(),
  requestTotpCode: vi.fn(),
}))

import { createCoordinator } from '../../src/background/coordinator'

const pageOrigin = 'https://example.com'
const handle = 'fictional-handle-for-examples-only-AAAAAAAA'
const style = { style: 'characters', size: 20 } as const

function browserForPage(kind: string): Browser {
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
        const name = details.args?.[0]
        if (name === 'sesameFillGeneratedRegistration') {
          const phase = details.args?.[4]
          if (phase === 'fill') recorded.fillCredential = { password: details.args?.[3] }
          return [{ result: recorded.fillOk || phase !== 'fill'
            ? { version: 1, ok: true, code: 'registration-filled', fieldsFilled: 2 }
            : { version: 1, ok: false, code: 'field-write-failed' } }]
        }
        const phase = details.args?.[5]
        if (phase === 'clear') return [{ result: { version: 1, ok: true, code: 'password-change-filled', currentFilled: 0, newFilled: 0 } }]
        if (phase === 'fill') {
          recorded.fillCredential = { ...(details.args?.[3] as Record<string, unknown>), newPassword: details.args?.[4] }
          if (!recorded.fillOk) return [{ result: { version: 1, ok: false, code: 'field-write-failed' } }]
        }
        return [{ result: { version: 1, ok: true, code: 'password-change-filled', currentFilled: 1, newFilled: 2 } }]
      }) as unknown as Browser['scripting']['executeScript'],
    },
  }
}

beforeEach(() => {
  for (const mock of Object.values(native)) mock.mockReset()
  recorded.fillCredential = null
  recorded.fillOk = true
  native.requestChange.mockResolvedValue({
    ok: true,
    changed: { currentPassword: 'fictional-current-pass-1', newPassword: 'fictional-new-pass-1', handle, matchKind: 'exact' },
  })
  native.requestCreate.mockResolvedValue({ ok: true, created: { password: 'fictional-new-pass-1', handle } })
  native.requestPending.mockResolvedValue({ ok: true, state: 'unconfirmed' })
})

describe('password change coordinator', () => {
  it('asks the desktop for a change, fills both passwords and reports the fill', async () => {
    const browser = browserForPage('password-change')
    const coordinator = createCoordinator(browser)

    const result = await coordinator.changePasswordActivePage(style)

    expect(result).toEqual({ ok: true, tabId: 5, origin: pageOrigin, handle, currentFilled: 1, newFilled: 2 })
    expect(native.requestChange).toHaveBeenCalledWith(browser, pageOrigin, style, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(native.requestFill).not.toHaveBeenCalled()
    expect(recorded.fillCredential).toEqual({ username: '', password: 'fictional-current-pass-1', newPassword: 'fictional-new-pass-1' })
    expect(native.requestPending).toHaveBeenCalledWith(browser, pageOrigin, handle, 'filled')
  })

  it('reports a failed fill so the desktop can suggest going back', async () => {
    recorded.fillOk = false
    const browser = browserForPage('password-change')
    const coordinator = createCoordinator(browser)

    await expect(coordinator.changePasswordActivePage(style)).resolves.toEqual({ ok: false, code: 'field-write-failed' })
    expect(native.requestPending).toHaveBeenCalledWith(browser, pageOrigin, handle, 'notFilled')
  })

  it('reports a page that changed after approval as not filled', async () => {
    const browser = browserForPage('password-change')
    ;(browser.tabs.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ id: 5, url: `${pageOrigin}/settings/password` }])
      .mockResolvedValueOnce([{ id: 9, url: 'https://other.example.com/' }])
    const coordinator = createCoordinator(browser)

    await expect(coordinator.changePasswordActivePage(style)).resolves.toEqual({ ok: false, code: 'page-changed' })
    expect(native.requestPending).toHaveBeenCalledWith(browser, pageOrigin, handle, 'notFilled')
  })

  it('refuses a surface that is not a password-change form without asking the desktop', async () => {
    const coordinator = createCoordinator(browserForPage('login'))
    await expect(coordinator.changePasswordActivePage(style)).resolves.toEqual({ ok: false, code: 'not-password-change-form' })
    expect(native.requestChange).not.toHaveBeenCalled()
    expect(native.requestPending).not.toHaveBeenCalled()
  })

  it('passes a declined approval back, fills nothing and reports nothing', async () => {
    native.requestChange.mockResolvedValue({ ok: false, code: 'approval-declined' })
    const browser = browserForPage('password-change')
    const coordinator = createCoordinator(browser)

    await expect(coordinator.changePasswordActivePage(style)).resolves.toEqual({ ok: false, code: 'approval-declined' })
    expect(recorded.fillCredential).toBeNull()
    expect(native.requestPending).not.toHaveBeenCalled()
  })

  it('passes an older desktop refusal back without generating anything itself', async () => {
    native.requestChange.mockResolvedValue({ ok: false, code: 'pending-version-unsupported' })
    const coordinator = createCoordinator(browserForPage('password-change'))
    await expect(coordinator.changePasswordActivePage(style)).resolves.toEqual({ ok: false, code: 'pending-version-unsupported' })
    expect(recorded.fillCredential).toBeNull()
  })

  it('refuses a second change while one is in flight', async () => {
    let settle: (value: { ok: false; code: string }) => void = () => {}
    native.requestChange.mockImplementation(() => new Promise((resolve) => { settle = resolve }))
    const coordinator = createCoordinator(browserForPage('password-change'))

    const first = coordinator.changePasswordActivePage(style)
    await expect(coordinator.changePasswordActivePage(style)).resolves.toEqual({ ok: false, code: 'fill-in-progress' })

    settle({ ok: false, code: 'approval-declined' })
    await expect(first).resolves.toEqual({ ok: false, code: 'approval-declined' })
  })
})

describe('sign-up coordinator', () => {
  it('asks the desktop to create the login, fills the password and reports the fill', async () => {
    const browser = browserForPage('registration')
    const coordinator = createCoordinator(browser)

    const result = await coordinator.createPasswordActivePage({ style: 'passphrase', size: 6 })

    expect(result).toEqual({ ok: true, tabId: 5, origin: pageOrigin, handle, fieldsFilled: 2 })
    expect(native.requestCreate).toHaveBeenCalledWith(browser, pageOrigin, { style: 'passphrase', size: 6 }, expect.any(Object))
    expect(recorded.fillCredential).toEqual({ password: 'fictional-new-pass-1' })
    expect(native.requestPending).toHaveBeenCalledWith(browser, pageOrigin, handle, 'filled')
  })

  it('refuses a password-change form for sign-up', async () => {
    const coordinator = createCoordinator(browserForPage('password-change'))
    await expect(coordinator.createPasswordActivePage(style)).resolves.toEqual({ ok: false, code: 'password-change-form' })
    expect(native.requestCreate).not.toHaveBeenCalled()
  })

  it('reports a sign-up fill that failed', async () => {
    recorded.fillOk = false
    const browser = browserForPage('registration')
    const coordinator = createCoordinator(browser)
    await expect(coordinator.createPasswordActivePage(style)).resolves.toEqual({ ok: false, code: 'field-write-failed' })
    expect(native.requestPending).toHaveBeenCalledWith(browser, pageOrigin, handle, 'notFilled')
  })
})
