import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Browser, ScriptInjectionDetails } from '../../src/platform/chrome'

const native = vi.hoisted(() => ({ requestCardFill: vi.fn() }))

vi.mock('../../src/background/native-connection', () => ({
  probeNativeHost: vi.fn(),
  requestFill: vi.fn(),
  requestIdentityFill: vi.fn(),
  requestCardFill: native.requestCardFill,
}))

import { createCoordinator } from '../../src/background/coordinator'

const pageOrigin = 'https://checkout.example.test'
const stripeOrigin = 'https://js.stripe.com'

function browserForCardPage(): Browser {
  return {
    runtime: {
      getManifest: () => ({ version: '0.1.0' }),
      getURL: (path) => path,
      connectNative: vi.fn(),
    },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 7, url: `${pageOrigin}/pay` }]),
    },
    scripting: {
      executeScript: vi.fn(async (details: ScriptInjectionDetails<unknown>) => {
        if ('files' in details) return []
        if (details.func.name === 'invokeCardInspection') {
          return [
            { frameId: 0, result: { ok: true, origin: pageOrigin, fields: ['cardholderName'], embedded: false } },
            { frameId: 12, result: { ok: true, origin: stripeOrigin, fields: ['number', 'securityCode'], embedded: true } },
          ]
        }
        const phase = details.args?.[3]
        const frameId = details.target.frameIds?.[0]
        if (phase === 'prepare') {
          return frameId === 0
            ? [{ frameId, result: { ok: true, filledFields: ['cardholderName'] } }]
            : [{ frameId, result: { ok: true, filledFields: ['number', 'securityCode'] } }]
        }
        if (phase === 'fill') {
          return frameId === 0
            ? [{ frameId, result: { ok: true, filledFields: ['cardholderName'] } }]
            : [{ frameId, result: { ok: true, filledFields: ['number', 'securityCode'] } }]
        }
        return [{ frameId, result: { ok: true, filledFields: [] } }]
      }) as unknown as Browser['scripting']['executeScript'],
    },
  }
}

beforeEach(() => {
  native.requestCardFill.mockReset()
  native.requestCardFill.mockResolvedValue({
    ok: true,
    card: { cardholderName: 'Jamie Example', number: '4111111111111111', securityCode: '123' },
  })
})

describe('card coordinator', () => {
  it('fills mixed merchant and Stripe frames while approving the merchant origin', async () => {
    const browser = browserForCardPage()
    const coordinator = createCoordinator(browser)

    await expect(coordinator.fillCardActivePage()).resolves.toEqual({
      ok: true,
      filledFields: ['cardholderName', 'number', 'securityCode'],
    })
    expect(native.requestCardFill).toHaveBeenCalledWith(
      browser,
      pageOrigin,
      ['cardholderName', 'number', 'securityCode'],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })
})
