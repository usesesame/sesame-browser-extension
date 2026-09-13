import { describe, expect, it } from 'vitest'
import type { Browser, NativePort } from '../../src/platform/chrome'
import { openDesktop, probeNativeHost } from '../../src/background/native-connection'

interface PortScript {
  reply?: (request: Record<string, unknown>) => unknown
  disconnectWith?: string
}

function fakeBrowser(scripts: PortScript[]): { browser: Browser; requests: Record<string, unknown>[] } {
  const requests: Record<string, unknown>[] = []
  let call = 0
  const browser: Browser = {
    runtime: {
      getManifest: () => ({ version: '0.1.0' }),
      getURL: (path) => path,
      connectNative: () => {
        const script = scripts[call] ?? {}
        call += 1
        browser.runtime.lastError = undefined
        const messageListeners: Array<(message: unknown) => void> = []
        const disconnectListeners: Array<() => void> = []
        const port: NativePort = {
          name: 'app.usesesame.browser',
          postMessage(message) {
            requests.push(message as Record<string, unknown>)
            if (script.disconnectWith !== undefined) {
              queueMicrotask(() => {
                browser.runtime.lastError = { message: script.disconnectWith }
                disconnectListeners.forEach((listener) => listener())
              })
              return
            }
            if (script.reply) {
              queueMicrotask(() => {
                messageListeners.forEach((listener) => listener(script.reply!(message as Record<string, unknown>)))
              })
            }
          },
          disconnect: () => {},
          onMessage: {
            addListener: (callback) => { messageListeners.push(callback) },
            removeListener: () => {},
          },
          onDisconnect: {
            addListener: (callback) => { disconnectListeners.push(callback) },
            removeListener: () => {},
          },
        }
        return port
      },
    },
    tabs: { query: async () => [] },
    scripting: { executeScript: async () => [] },
  }
  return { browser, requests }
}

function capabilitiesReply(request: Record<string, unknown>): unknown {
  return {
    version: 1,
    type: 'capabilities',
    requestId: request.requestId,
    installed: true,
    desktopAvailable: true,
    locked: false,
    fillAvailable: true,
  }
}

describe('native connection probe', () => {
  it('retries a transient host exit with a fresh request id and succeeds', async () => {
    const { browser, requests } = fakeBrowser([
      { disconnectWith: 'Native host has exited.' },
      { reply: capabilitiesReply },
    ])
    const result = await probeNativeHost(browser, { sleep: async () => {}, timeoutMs: 200 })

    expect(result).toMatchObject({ ok: true, attempts: 2 })
    expect(requests).toHaveLength(2)
    expect(new Set(requests.map((request) => request.requestId)).size).toBe(2)
  })

  it('does not retry when no native host is registered', async () => {
    const { browser, requests } = fakeBrowser([
      { disconnectWith: 'Specified native messaging host not found.' },
    ])
    const result = await probeNativeHost(browser, { sleep: async () => {}, timeoutMs: 200 })

    expect(result).toEqual({ ok: false, code: 'host-not-found', latencyMs: expect.any(Number), attempts: 1 })
    expect(requests).toHaveLength(1)
  })

  it('reports a failed activation instead of claiming the desktop opened', async () => {
    const { browser } = fakeBrowser([
      {
        reply: (request) => ({
          version: 1,
          type: 'activated',
          requestId: request.requestId,
          opened: false,
        }),
      },
    ])

    await expect(openDesktop(browser, { timeoutMs: 200 })).resolves.toEqual({
      ok: false,
      code: 'desktop-launch-failed',
    })
  })
})
