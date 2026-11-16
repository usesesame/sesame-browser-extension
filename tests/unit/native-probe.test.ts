import { describe, expect, it, vi } from 'vitest'
import type { Browser, NativePort } from '../../src/platform/chrome'
import { NATIVE_PROBE_BUDGET_MS, openDesktop, probeNativeHost, requestFill } from '../../src/background/native-connection'
import { NATIVE_PROBE_TIMEOUT_MS } from '../../src/protocol/native'
import { CONNECTION_RESPONSE_TIMEOUT_MS, presentConnection } from '../../src/protocol/connection-presentation'

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
    version: request.version,
    type: 'capabilities',
    requestId: request.requestId,
    installed: true,
    desktopAvailable: true,
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

  it('keeps a whole probe of a silent desktop inside its budget and reports a timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    try {
      const { browser, requests } = fakeBrowser([{}, {}])
      let settled = false
      const probe = probeNativeHost(browser, { timeoutMs: 300, budgetMs: 450, retryDelayMs: 0 })
        .finally(() => { settled = true })

      await vi.advanceTimersByTimeAsync(300)
      expect(requests).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(1)
      expect(requests).toHaveLength(2)
      expect(settled).toBe(false)

      await vi.advanceTimersByTimeAsync(148)
      expect(settled).toBe(false)

      await vi.advanceTimersByTimeAsync(1)
      const result = await probe
      expect(result).toMatchObject({ ok: false, code: 'timeout', attempts: 2, latencyMs: 450 })
      expect(requests).toHaveLength(2)
      expect(presentConnection(result.ok ? 'connected' : result.code).title).toBe('Sesame is taking too long')
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips the retry when the pause would use up the budget', async () => {
    const { browser, requests } = fakeBrowser([{}, {}])
    const result = await probeNativeHost(browser, { timeoutMs: 200, budgetMs: 250, retryDelayMs: 100 })

    expect(result).toMatchObject({ ok: false, code: 'timeout', attempts: 1 })
    expect(requests).toHaveLength(1)
  })

  it('answers the popup and onboarding before they give up on the background', () => {
    expect(NATIVE_PROBE_BUDGET_MS).toBeGreaterThanOrEqual(NATIVE_PROBE_TIMEOUT_MS)
    expect(NATIVE_PROBE_BUDGET_MS + 1_000).toBeLessThanOrEqual(CONNECTION_RESPONSE_TIMEOUT_MS)
  })

  it('does not retry when no native host is registered', async () => {
    const { browser, requests } = fakeBrowser([
      { disconnectWith: 'Specified native messaging host not found.' },
    ])
    const result = await probeNativeHost(browser, { sleep: async () => {}, timeoutMs: 200 })

    expect(result).toEqual({ ok: false, code: 'host-not-found', latencyMs: expect.any(Number), attempts: 1 })
    expect(requests).toHaveLength(1)
  })

  it('rejects a retired capabilities reply during the current probe', async () => {
    const { browser } = fakeBrowser([
      {
        reply: (request) => ({
          version: 1,
          type: 'capabilities',
          requestId: request.requestId,
          installed: true,
          desktopAvailable: true,
          locked: true,
          fillAvailable: false,
        }),
      },
    ])
    const result = await probeNativeHost(browser, { timeoutMs: 200 })

    expect(result).toMatchObject({ ok: false, code: 'protocol-mismatch' })
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

  it('carries a lookalike warning and its stored host back to the fill caller', async () => {
    const { browser, requests } = fakeBrowser([
      {
        reply: (request) => ({
          version: request.version,
          type: 'fill-unavailable',
          requestId: request.requestId,
          reason: 'lookalike',
          lookalike: 'apple.example',
        }),
      },
    ])

    await expect(requestFill(browser, 'https://example.test', { timeoutMs: 200 })).resolves.toEqual({
      ok: false,
      code: 'lookalike-domain',
      lookalike: 'apple.example',
    })
    expect(requests[0]).toMatchObject({ version: 7, type: 'fill', origin: 'https://example.test' })
  })
})

function desktopBeforeSiteRules(request: Record<string, unknown>): unknown {
  if (request.version !== 5) {
    return { version: request.version, type: 'error', requestId: request.requestId, message: 'Unsupported protocol version.' }
  }
  return { version: 5, type: 'fill', requestId: request.requestId, password: 'fictional-value', matchKind: 'exact' }
}

describe('fill against a desktop before site rules', () => {
  it('asks once at version seven, then once at version five for the same page', async () => {
    const { browser, requests } = fakeBrowser([{ reply: desktopBeforeSiteRules }, { reply: desktopBeforeSiteRules }])

    await expect(requestFill(browser, 'https://example.test', { timeoutMs: 200, fields: 'password' })).resolves.toEqual({
      ok: true,
      credential: { username: '', password: 'fictional-value' },
      matchKind: 'exact',
    })
    expect(requests).toHaveLength(2)
    expect(requests[0]).toMatchObject({ version: 7, type: 'fill', origin: 'https://example.test', fields: 'password' })
    expect(requests[1]).toMatchObject({ version: 5, type: 'fill', origin: 'https://example.test', fields: 'password' })
    expect(requests[1].requestId).not.toBe(requests[0].requestId)
  })

  it('asks only once when the desktop answers version seven', async () => {
    const { browser, requests } = fakeBrowser([{
      reply: (request) => ({ version: request.version, type: 'fill', requestId: request.requestId, username: 'person@example.test', password: 'fictional-value', matchKind: 'site' }),
    }])

    await expect(requestFill(browser, 'https://login.example.test', { timeoutMs: 200 })).resolves.toMatchObject({ ok: true, matchKind: 'site' })
    expect(requests).toHaveLength(1)
  })

  it('refuses a site match that a host sends to the version five retry', async () => {
    const hostile = (request: Record<string, unknown>) => request.version === 5
      ? { version: 5, type: 'fill', requestId: request.requestId, username: 'person@example.test', password: 'fictional-value', matchKind: 'site' }
      : desktopBeforeSiteRules(request)
    const { browser, requests } = fakeBrowser([{ reply: hostile }, { reply: hostile }])

    await expect(requestFill(browser, 'https://login.example.test', { timeoutMs: 200 })).resolves.toEqual({ ok: false, code: 'unsafe-response' })
    expect(requests).toHaveLength(2)
  })

  it('does not retry on any other rejection', async () => {
    for (const reply of [
      (request: Record<string, unknown>) => ({ version: request.version, type: 'error', requestId: request.requestId, message: 'Invalid browser request.' }),
      (request: Record<string, unknown>) => ({ version: 1, type: 'error', requestId: request.requestId, message: 'Unsupported protocol version.' }),
      (request: Record<string, unknown>) => ({ version: request.version, type: 'error', requestId: 'another-request', message: 'Unsupported protocol version.' }),
      (request: Record<string, unknown>) => ({ version: request.version, type: 'fill-unavailable', requestId: request.requestId, reason: 'approvalDeclined' }),
    ]) {
      const { browser, requests } = fakeBrowser([{ reply }, { reply: desktopBeforeSiteRules }])
      const result = await requestFill(browser, 'https://example.test', { timeoutMs: 200 })
      expect(result).toMatchObject({ ok: false })
      expect(requests).toHaveLength(1)
    }
  })

  it('does not retry after the fill is cancelled', async () => {
    const controller = new AbortController()
    const { browser, requests } = fakeBrowser([
      { reply: (request) => { controller.abort(); return desktopBeforeSiteRules(request) } },
      { reply: desktopBeforeSiteRules },
    ])

    await expect(requestFill(browser, 'https://example.test', { timeoutMs: 200, signal: controller.signal }))
      .resolves.toEqual({ ok: false, code: 'cancelled' })
    expect(requests).toHaveLength(1)
  })
})
