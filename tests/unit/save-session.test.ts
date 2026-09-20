import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Browser } from '../../src/platform/chrome'
import type { SignupCapturePayload } from '../../src/background/signup-capture'

const native = vi.hoisted(() => ({ requestSave: vi.fn() }))

vi.mock('../../src/background/native-connection', () => ({
  requestSave: native.requestSave,
}))

import { createSaveSessionController, safeSignupCapturePayload } from '../../src/background/signup-capture'

const payload: SignupCapturePayload = {
  origin: 'https://example.test',
  username: 'jamie@example.test',
  password: 'fictional-pass-1',
  kind: 'new',
}

beforeEach(() => {
  native.requestSave.mockReset()
  native.requestSave.mockResolvedValue({ ok: true })
})

describe('signup capture payload', () => {
  it('accepts a capture whose frame origin matches the claimed origin', () => {
    expect(safeSignupCapturePayload(payload, 'https://example.test/signup')).toEqual(payload)
  })

  it('rejects a mismatched frame origin', () => {
    expect(safeSignupCapturePayload(payload, 'https://other.test/signup')).toBeNull()
  })

  it('rejects an oversized password', () => {
    expect(safeSignupCapturePayload({ ...payload, password: 'x'.repeat(4097) }, 'https://example.test/signup')).toBeNull()
  })

  it('rejects an unknown kind', () => {
    expect(safeSignupCapturePayload({ ...payload, kind: 'reuse' }, 'https://example.test/signup')).toBeNull()
  })
})

describe('save session controller', () => {
  it('arms a tab and drops the arm after the TTL', () => {
    vi.useFakeTimers()
    try {
      const controller = createSaveSessionController({ ttlMs: 1_000 })
      controller.arm(7, 'https://example.test')
      expect(controller.isArmed(7)).toBe(true)
      vi.advanceTimersByTime(1_001)
      expect(controller.isArmed(7)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the arm on the same origin and drops it after a cross-origin navigation', () => {
    const controller = createSaveSessionController()
    controller.arm(4, 'https://example.test')
    controller.handleTabUpdated(4, { url: 'https://example.test/step-2' })
    expect(controller.isArmed(4)).toBe(true)
    controller.handleTabUpdated(4, { url: 'https://other.test/signup' })
    expect(controller.isArmed(4)).toBe(false)
  })

  it('refuses a save from a tab that was never armed', async () => {
    const controller = createSaveSessionController()

    await expect(controller.save({} as Browser, 9, payload)).resolves.toEqual({ ok: false, code: 'save-not-armed' })
    expect(native.requestSave).not.toHaveBeenCalled()
  })

  it('refuses a save whose payload origin differs from the armed origin', async () => {
    const controller = createSaveSessionController()
    controller.arm(3, 'https://example.test')

    await expect(controller.save({} as Browser, 3, { ...payload, origin: 'https://other.test' })).resolves.toEqual({
      ok: false,
      code: 'save-origin-mismatch',
    })
    expect(native.requestSave).not.toHaveBeenCalled()
    expect(controller.isArmed(3)).toBe(true)
  })

  it('sends the armed values through the native save request and disarms the tab', async () => {
    const controller = createSaveSessionController()
    controller.arm(3, 'https://example.test')

    await expect(controller.save({} as Browser, 3, payload)).resolves.toEqual({ ok: true })

    expect(native.requestSave).toHaveBeenCalledWith(
      {},
      'https://example.test',
      { username: 'jamie@example.test', password: 'fictional-pass-1', kind: 'new' },
      expect.objectContaining({ timeoutMs: undefined }),
    )
    expect(controller.isArmed(3)).toBe(false)
  })

  it('passes a declined save back to the caller and keeps the arm for a retry', async () => {
    native.requestSave.mockResolvedValue({ ok: false, code: 'approval-declined' })
    const controller = createSaveSessionController()
    controller.arm(3, 'https://example.test')

    await expect(controller.save({} as Browser, 3, payload)).resolves.toEqual({ ok: false, code: 'approval-declined' })
    expect(controller.isArmed(3)).toBe(true)
  })

  it('reports a failed save when the native request throws and keeps the arm for a retry', async () => {
    native.requestSave.mockRejectedValue(new Error('broken pipe'))
    const controller = createSaveSessionController()
    controller.arm(3, 'https://example.test')

    await expect(controller.save({} as Browser, 3, payload)).resolves.toEqual({ ok: false, code: 'save-failed' })
    expect(controller.isArmed(3)).toBe(true)
  })

  it('refuses a second save while one is in flight', async () => {
    let settle: (value: { ok: true }) => void = () => {}
    native.requestSave.mockReturnValue(new Promise((resolve) => { settle = resolve }))
    const controller = createSaveSessionController()
    controller.arm(3, 'https://example.test')

    const first = controller.save({} as Browser, 3, payload)
    await expect(controller.save({} as Browser, 3, payload)).resolves.toEqual({ ok: false, code: 'save-in-progress' })

    settle({ ok: true })
    await expect(first).resolves.toEqual({ ok: true })
  })

  it('clears the arm and the in-flight marker when the tab closes', () => {
    const controller = createSaveSessionController()
    controller.arm(5, 'https://example.test')
    controller.handleTabRemoved(5)
    expect(controller.isArmed(5)).toBe(false)
  })
})
