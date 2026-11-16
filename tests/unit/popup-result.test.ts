import { describe, expect, it, vi } from 'vitest'
import { createPopupResultRelay, type PopupResultDeps } from '../../src/background/popup-result'
import type { PublicFillResult } from '../../src/background/fill-result'

const pageOrigin = 'https://example.test'
const lookalikeResult: PublicFillResult = { state: 'unavailable', code: 'lookalike-domain', lookalike: 'examp1e.test' }

function fakePort() {
  const disconnectListeners: Array<() => void> = []
  return {
    postMessage: vi.fn(),
    onDisconnect: { addListener: (callback: () => void) => { disconnectListeners.push(callback) } },
    closePopup: () => disconnectListeners.forEach((listener) => listener()),
  }
}

function deps(overrides: Partial<PopupResultDeps> = {}): PopupResultDeps {
  return {
    queryActiveTab: vi.fn().mockResolvedValue({ id: 7, url: `${pageOrigin}/sign-in` }),
    tabOrigin: vi.fn().mockResolvedValue(pageOrigin),
    pageOrigin: (url) => (url ? new URL(url).origin : null),
    showStatus: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
}

describe('popup fill results', () => {
  it('answers the popup while it is open and leaves the page alone', async () => {
    const port = fakePort()
    const relayDeps = deps()
    const deliver = createPopupResultRelay(port, relayDeps)

    await expect(deliver(lookalikeResult, lookalikeResult)).resolves.toBe('popup')
    expect(port.postMessage).toHaveBeenCalledWith(lookalikeResult)
    expect(relayDeps.showStatus).not.toHaveBeenCalled()
  })

  it('shows a lookalike warning on the page after the popup closed', async () => {
    const port = fakePort()
    const relayDeps = deps()
    const deliver = createPopupResultRelay(port, relayDeps)
    port.closePopup()

    await expect(deliver(lookalikeResult, lookalikeResult)).resolves.toBe('page')
    expect(port.postMessage).not.toHaveBeenCalled()
    expect(relayDeps.showStatus).toHaveBeenCalledWith(7, lookalikeResult)
  })

  it('falls back to the page when the closed port throws', async () => {
    const port = fakePort()
    port.postMessage.mockImplementation(() => { throw new Error('Attempting to use a disconnected port object') })
    const relayDeps = deps()
    const deliver = createPopupResultRelay(port, relayDeps)
    const filled: PublicFillResult = { state: 'filled', usernameFilled: true, passwordFilled: true, matchKind: 'exact' }

    await expect(deliver(filled, filled)).resolves.toBe('page')
    expect(relayDeps.showStatus).toHaveBeenCalledWith(7, filled)
  })

  it('binds the status to the tab the popup was opened on, not the tab active later', async () => {
    const port = fakePort()
    const queryActiveTab = vi.fn()
      .mockResolvedValueOnce({ id: 7, url: `${pageOrigin}/sign-in` })
      .mockResolvedValue({ id: 9, url: 'https://other.example.test/' })
    const relayDeps = deps({ queryActiveTab })
    const deliver = createPopupResultRelay(port, relayDeps)
    port.closePopup()

    await deliver(lookalikeResult, lookalikeResult)
    expect(queryActiveTab).toHaveBeenCalledTimes(1)
    expect(relayDeps.showStatus).toHaveBeenCalledWith(7, lookalikeResult)
  })

  it('drops the status when the tab moved to another site', async () => {
    const port = fakePort()
    const relayDeps = deps({ tabOrigin: vi.fn().mockResolvedValue('https://other.example.test') })
    const deliver = createPopupResultRelay(port, relayDeps)
    port.closePopup()

    await expect(deliver(lookalikeResult, lookalikeResult)).resolves.toBe('dropped')
    expect(relayDeps.showStatus).not.toHaveBeenCalled()
  })

  it('drops the status when the tab is gone or was never a fillable page', async () => {
    for (const relayDeps of [
      deps({ tabOrigin: vi.fn().mockRejectedValue(new Error('No tab with id: 7')) }),
      deps({ queryActiveTab: vi.fn().mockResolvedValue({ id: 7, url: 'chrome://settings/' }), pageOrigin: () => null }),
      deps({ queryActiveTab: vi.fn().mockRejectedValue(new Error('tabs unavailable')) }),
    ]) {
      const port = fakePort()
      const deliver = createPopupResultRelay(port, relayDeps)
      port.closePopup()

      await expect(deliver(lookalikeResult, lookalikeResult)).resolves.toBe('dropped')
      expect(relayDeps.showStatus).not.toHaveBeenCalled()
    }
  })

  it('drops a popup only message once the popup closed', async () => {
    const port = fakePort()
    const relayDeps = deps()
    const deliver = createPopupResultRelay(port, relayDeps)
    port.closePopup()

    await expect(deliver({ state: 'changed', currentFilled: 1, newFilled: 2 })).resolves.toBe('dropped')
    expect(relayDeps.showStatus).not.toHaveBeenCalled()
  })

  it('reports a failed page status as dropped without throwing', async () => {
    const port = fakePort()
    const relayDeps = deps({ showStatus: vi.fn().mockRejectedValue(new Error('Frame was removed')) })
    const deliver = createPopupResultRelay(port, relayDeps)
    port.closePopup()

    await expect(deliver(lookalikeResult, lookalikeResult)).resolves.toBe('dropped')
  })
})
