import { describe, expect, it, vi } from 'vitest'
import type { Browser, NativePort, ScriptInjectionDetails } from '../../src/platform/chrome'
import { createCoordinator } from '../../src/background/coordinator'
import { probeNativeHost, requestFill } from '../../src/background/native-connection'

const pageOrigin = 'https://example.test'

type HostReply = (request: Record<string, unknown>) => unknown

function olderDesktopReply(request: Record<string, unknown>): unknown {
  return {
    version: 1,
    type: 'error',
    requestId: request.requestId,
    message: 'Unsupported protocol version.',
  }
}

function currentDesktopReply(request: Record<string, unknown>): unknown {
  if (request.type === 'capabilities') {
    return { version: request.version, type: 'capabilities', requestId: request.requestId, installed: true, desktopAvailable: true }
  }
  return {
    version: request.version,
    type: 'fill',
    requestId: request.requestId,
    username: 'jamie',
    password: 'hunter2',
    matchKind: 'exact',
  }
}

function hostBrowser(hosts: HostReply[]): { browser: Browser; requests: Record<string, unknown>[]; injections: string[] } {
  const requests: Record<string, unknown>[] = []
  const injections: string[] = []
  let connection = 0
  const browser: Browser = {
    runtime: {
      getManifest: () => ({ version: '0.1.0' }),
      getURL: (path) => path,
      connectNative: () => {
        const host = hosts[Math.min(connection, hosts.length - 1)]
        connection += 1
        const listeners: Array<(message: unknown) => void> = []
        const port: NativePort = {
          name: 'app.usesesame.browser',
          postMessage(message) {
            const request = message as Record<string, unknown>
            requests.push(request)
            queueMicrotask(() => listeners.forEach((listener) => listener(host(request))))
          },
          disconnect: () => {},
          onMessage: { addListener: (callback) => { listeners.push(callback) }, removeListener: () => {} },
          onDisconnect: { addListener: () => {}, removeListener: () => {} },
        }
        return port
      },
    },
    tabs: { query: vi.fn().mockResolvedValue([{ id: 3, url: `${pageOrigin}/login` }]) },
    scripting: {
      executeScript: vi.fn(async (details: ScriptInjectionDetails<unknown>) => {
        if ('files' in details) return []
        injections.push(`${details.func.name}:${String(details.args?.[4])}`)
        if (details.func.name === 'invokeBridgeInspection') {
          return [{ frameId: 0, result: { ok: true, surface: { ok: true, origin: pageOrigin }, hasPasswordField: true, hasUsernameField: true } }]
        }
        return [{ result: { ok: true, usernameFilled: true, passwordFilled: true } }]
      }) as unknown as Browser['scripting']['executeScript'],
    },
  }
  return { browser, requests, injections }
}

describe('an older desktop that speaks only protocol 1 and 2', () => {
  it('fails the probe once as a protocol mismatch without retrying', async () => {
    const { browser, requests } = hostBrowser([olderDesktopReply])

    const result = await probeNativeHost(browser, { sleep: async () => {}, timeoutMs: 200 })

    expect(result).toEqual({ ok: false, code: 'protocol-mismatch', latencyMs: expect.any(Number), attempts: 1 })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ version: 6, type: 'capabilities' })
  })

  it('tells the user which desktop version to install', async () => {
    const { browser } = hostBrowser([olderDesktopReply])
    const coordinator = createCoordinator(browser)

    const state = await coordinator.checkConnection()

    expect(state).toMatchObject({
      state: 'unavailable',
      title: 'Update needed',
      message: expect.stringContaining('0.3.0'),
      diagnostic: expect.objectContaining({ code: 'protocol-mismatch' }),
    })
    expect(coordinator.state().phase).toEqual({ name: 'failed', code: 'protocol-mismatch' })
  })

  it('refuses a fill with the same code and writes nothing to the page', async () => {
    const { browser, injections } = hostBrowser([olderDesktopReply])
    const coordinator = createCoordinator(browser)

    const result = await coordinator.fillActivePage()

    expect(result.phase).toEqual({ name: 'failed', code: 'protocol-mismatch' })
    expect(injections.filter((entry) => entry.endsWith(':fill'))).toEqual([])
    await expect(requestFill(browser, pageOrigin, { timeoutMs: 200 })).resolves.toEqual({ ok: false, code: 'protocol-mismatch' })
  })

  it('fills after the desktop is upgraded without reloading the extension', async () => {
    const { browser } = hostBrowser([olderDesktopReply, olderDesktopReply, currentDesktopReply])
    const coordinator = createCoordinator(browser)

    expect((await coordinator.checkConnection()).state).toBe('unavailable')
    expect((await coordinator.fillActivePage()).phase).toMatchObject({ name: 'failed', code: 'protocol-mismatch' })

    const filled = await coordinator.fillActivePage()

    expect(filled.phase).toEqual({ name: 'complete', usernameFilled: true, passwordFilled: true, matchKind: 'exact' })
    expect((await coordinator.checkConnection()).state).toBe('ready')
  })

  it('does not accept an error that claims a newer version than the request', async () => {
    const forged = (request: Record<string, unknown>) => ({ ...(olderDesktopReply(request) as object), version: 7 })
    const { browser } = hostBrowser([forged])

    await expect(probeNativeHost(browser, { timeoutMs: 200 })).resolves.toMatchObject({ ok: false, code: 'protocol-mismatch' })
  })

  it('does not treat a stale reply for another request as a connection', async () => {
    const stale = (request: Record<string, unknown>) => ({ ...(olderDesktopReply(request) as object), requestId: 'another-request' })
    const { browser } = hostBrowser([stale])

    const result = await probeNativeHost(browser, { timeoutMs: 200 })

    expect(result).toMatchObject({ ok: false })
    expect(result).not.toMatchObject({ ok: true })
  })
})
