import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import http from 'node:http'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type BrowserContext, type Page, type Worker } from 'playwright-core'

const root = resolve(import.meta.dirname, '..', '..')
const extensionDir = join(root, 'dist', 'integration')
const approvedPassword = 'fictional-popup-pass'

const loginPage = `<!doctype html><html><body>
<form id="login-form" action="/signin" method="post">
<h1>Sign in</h1>
<label for="username">Username</label>
<input id="username" name="username" type="email" autocomplete="username" required>
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required>
<button type="submit" id="signin">Sign in</button>
</form>
</body></html>`

const passwordChangePage = `<!doctype html><html><body>
<form id="change-form" action="/password-changed" method="post">
<h1>Change password</h1>
<label for="current">Current password</label>
<input id="current" name="current" type="password" autocomplete="current-password">
<label for="new">New password</label>
<input id="new" name="new" type="password" autocomplete="new-password">
<label for="confirm">Confirm new password</label>
<input id="confirm" name="confirm" type="password" autocomplete="new-password">
<button type="submit" id="save">Change password</button>
</form>
</body></html>`

const registrationPage = `<!doctype html><html><body>
<form id="signup-form" action="/signup" method="post">
<h1>Create account</h1>
<label for="email">Email</label>
<input id="email" name="email" type="email" autocomplete="username">
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="new-password">
<label for="confirm">Confirm password</label>
<input id="confirm" name="confirm" type="password" autocomplete="new-password">
<button type="submit" id="create">Create account</button>
</form>
</body></html>`

const identityPage = `<!doctype html><html><body>
<form id="checkout">
<h1>Contact details</h1>
<label for="name">Full name</label>
<input id="name" name="name" type="text" autocomplete="name">
<label for="email">Email</label>
<input id="email" name="email" type="email" autocomplete="email">
<label for="phone">Phone</label>
<input id="phone" name="phone" type="tel" autocomplete="tel">
</form>
</body></html>`

function findChromiumExecutable(): string {
  const configured = process.env.SESAME_BROWSER_TEST_EXECUTABLE
  if (configured) {
    if (existsSync(configured)) return configured
    throw new Error(`SESAME_BROWSER_TEST_EXECUTABLE points at a missing file: ${configured}`)
  }
  const pinned = chromium.executablePath()
  if (pinned && existsSync(pinned)) return pinned
  const candidates = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/opt/google/chrome/chrome',
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  const discovered = spawnSync(
    'sh',
    ['-c', 'command -v google-chrome-stable google-chrome chromium chromium-browser'],
    { encoding: 'utf8' },
  )
  const first = discovered.stdout.split('\n').map((line) => line.trim()).find(Boolean)
  if (first) return first
  throw new Error('No Chrome or Chromium executable found. Install one or set SESAME_BROWSER_TEST_EXECUTABLE.')
}

interface ToolbarPopup {
  evaluate<T>(expression: string): Promise<T>
  click(label: string): Promise<void>
  close(): Promise<void>
}

interface DevToolsTarget {
  id: string
  type: string
  url: string
  webSocketDebuggerUrl?: string
}

let context!: BrowserContext
let worker!: Worker
let server!: http.Server
let origin = ''
let profileDir = ''
let debugPort = 0
let extensionId = ''

function handlePage(request: http.IncomingMessage, response: http.ServerResponse): void {
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
  response.writeHead(200, { 'content-type': 'text/html' })
  response.end(path === '/password-change' ? passwordChangePage
    : path === '/identity' ? identityPage
      : path === '/registration' ? registrationPage : loginPage)
}

async function listTargets(): Promise<DevToolsTarget[]> {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
  return await response.json() as DevToolsTarget[]
}

async function waitForDebugPort(): Promise<number> {
  const file = join(profileDir, 'DevToolsActivePort')
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      const port = Number(readFileSync(file, 'utf8').split('\n')[0])
      if (Number.isInteger(port) && port > 0) return port
    }
    await new Promise((done) => setTimeout(done, 100))
  }
  throw new Error('the browser never published its debugging port')
}

async function attach(target: DevToolsTarget): Promise<ToolbarPopup> {
  const socket = new WebSocket(target.webSocketDebuggerUrl!)
  await new Promise<void>((done, fail) => {
    socket.onopen = () => done()
    socket.onerror = () => fail(new Error('could not attach to the popup'))
  })
  let nextId = 0
  const pending = new Map<number, (message: { result?: { result?: { value?: unknown } } }) => void>()
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number; result?: { result?: { value?: unknown } } }
    if (message.id !== undefined) pending.get(message.id)?.(message)
  }
  const closed = new Promise<{ result?: { result?: { value?: unknown } } }>((done) => {
    socket.onclose = () => done({})
  })
  const send = (method: string, params: Record<string, unknown>) => Promise.race([
    new Promise<{ result?: { result?: { value?: unknown } } }>((done) => {
      const id = ++nextId
      pending.set(id, done)
      socket.send(JSON.stringify({ id, method, params }))
    }),
    closed,
  ])
  const evaluate = async <T>(expression: string): Promise<T> => {
    const reply = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })
    return reply.result?.result?.value as T
  }
  return {
    evaluate,
    async click(label: string) {
      const clicked = await evaluate<boolean>(`(() => {
        const button = [...document.querySelectorAll('button')]
          .find((candidate) => candidate.textContent.trim() === ${JSON.stringify(label)} && !candidate.disabled)
        if (!button) return false
        button.click()
        return true
      })()`)
      expect(clicked, `popup button ${label}`).toBe(true)
    },
    async close() {
      await send('Target.closeTarget', { targetId: target.id })
      socket.close()
    },
  }
}

async function openToolbarPopup(): Promise<ToolbarPopup> {
  await worker.evaluate(async () => { await chrome.action.openPopup() })
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const target = (await listTargets()).find((candidate) => candidate.url === `chrome-extension://${extensionId}/popup.html`)
    if (target?.webSocketDebuggerUrl) return await attach(target)
    await new Promise((done) => setTimeout(done, 100))
  }
  throw new Error('the toolbar popup never opened')
}

async function waitForPopupButton(popup: ToolbarPopup, label: string): Promise<void> {
  await expect.poll(
    () => popup.evaluate<boolean>(`[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === ${JSON.stringify(label)} && !button.disabled)`),
    { timeout: 15000 },
  ).toBe(true)
}

async function popupIsOpen(): Promise<boolean> {
  return (await listTargets()).some((candidate) => candidate.url === `chrome-extension://${extensionId}/popup.html`)
}

async function installDeferredNativeHost(): Promise<void> {
  await worker.evaluate(() => {
    const target = globalThis as typeof globalThis & {
      __sesameDeferred?: {
        requests: number
        cancelled: number
        delivered: number
        release: () => void
      }
    }
    const runtime = chrome.runtime as unknown as { connectNative: unknown }
    const waiting: Array<{ deliver: () => void; port: { closed: boolean; delivered: boolean; waiting: boolean } }> = []
    const state = {
      requests: 0,
      cancelled: 0,
      delivered: 0,
      release() {
        for (const entry of waiting.splice(0)) {
          if (!entry.port.closed) {
            entry.port.delivered = true
            state.delivered += 1
            entry.deliver()
          }
        }
      },
    }
    target.__sesameDeferred = state
    runtime.connectNative = () => {
      const messageListeners: Array<(message: unknown) => void> = []
      const port = { closed: false, delivered: false, waiting: false }
      const listeners = (message: unknown) => messageListeners.forEach((listener) => listener(message))
      return {
        name: 'app.usesesame.browser',
        postMessage(request: { type?: string; requestId?: string; version?: number; fields?: string }) {
          const base = { version: request?.version ?? 1, requestId: request?.requestId }
          queueMicrotask(() => {
            if (request?.type === 'capabilities') {
              listeners({ ...base, type: 'capabilities', installed: true, desktopAvailable: true })
              return
            }
            state.requests += 1
            port.waiting = true
            waiting.push({
              port,
              deliver: () => {
                if (request?.type === 'identity') {
                  const identity: Record<string, string> = {}
                  for (const key of (request.fields ?? '').split(',')) {
                    identity[key] = key === 'email' ? 'jamie@example.test' : `Fictional ${key}`
                  }
                  listeners({ ...base, type: 'identity', identity })
                } else {
                  const fields = request.fields ?? 'both'
                  listeners({
                    ...base,
                    type: 'fill',
                    matchKind: 'exact',
                    ...(fields === 'password' ? {} : { username: 'jamie@example.test' }),
                    ...(fields === 'username' ? {} : { password: 'fictional-popup-pass' }),
                  })
                }
              },
            })
          })
        },
        disconnect() {
          if (port.waiting && !port.closed && !port.delivered) state.cancelled += 1
          port.closed = true
        },
        onMessage: {
          addListener: (callback: (message: unknown) => void) => { messageListeners.push(callback) },
          removeListener: () => {},
        },
        onDisconnect: {
          addListener: () => {},
          removeListener: () => {},
        },
      }
    }
  })
}

async function nativeCounts(): Promise<{ requests: number; cancelled: number; delivered: number }> {
  return worker.evaluate(() => {
    const target = globalThis as typeof globalThis & { __sesameDeferred?: { requests: number; cancelled: number; delivered: number } }
    const state = target.__sesameDeferred
    return { requests: state?.requests ?? 0, cancelled: state?.cancelled ?? 0, delivered: state?.delivered ?? 0 }
  })
}

async function approvePendingRequests(): Promise<void> {
  await worker.evaluate(() => {
    const target = globalThis as typeof globalThis & { __sesameDeferred?: { release: () => void } }
    target.__sesameDeferred?.release()
  })
}

async function restoreNativeHost(): Promise<void> {
  await worker.evaluate(() => {
    const target = globalThis as typeof globalThis & { __sesameDeferred?: unknown; __sesameOriginalConnectNative?: unknown }
    const runtime = chrome.runtime as unknown as { connectNative: unknown }
    runtime.connectNative = () => { throw new Error('Specified native messaging host not found.') }
    delete target.__sesameDeferred
  })
}

async function openFixture(path: string): Promise<Page> {
  const page = await context.newPage()
  await page.goto(`${origin}${path}`)
  await page.bringToFront()
  await expect.poll(
    () => worker.evaluate(async (expected) => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      return tab?.url === expected
    }, page.url()),
    { timeout: 10000 },
  ).toBe(true)
  return page
}

beforeAll(async () => {
  if (!existsSync(extensionDir)) {
    throw new Error('dist/integration is missing: run npm run build:integration first')
  }
  server = http.createServer(handlePage)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('unexpected listen address')
  origin = `http://127.0.0.1:${address.port}`
  profileDir = mkdtempSync(join(tmpdir(), 'sesame-toolbar-popup-'))
  context = await chromium.launchPersistentContext(profileDir, {
    executablePath: findChromiumExecutable(),
    args: [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--remote-debugging-port=0',
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  })
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15000 })
  extensionId = new URL(worker.url()).host
  debugPort = await waitForDebugPort()
})

afterAll(async () => {
  await context?.close()
  server?.close()
  if (profileDir) rmSync(profileDir, { recursive: true, force: true })
})

async function startPopupFill(path: string, label: string): Promise<{ page: Page; popup: ToolbarPopup }> {
  const page = await openFixture(path)
  await installDeferredNativeHost()
  const popup = await openToolbarPopup()
  await waitForPopupButton(popup, label)
  await popup.click(label)
  await expect.poll(async () => (await nativeCounts()).requests, { timeout: 10000 }).toBe(1)
  return { page, popup }
}

async function closePopupAndSettle(popup: ToolbarPopup): Promise<void> {
  await popup.close()
  await expect.poll(popupIsOpen, { timeout: 5000 }).toBe(false)
  await new Promise((done) => setTimeout(done, 500))
}

async function finish(page: Page, popup: ToolbarPopup): Promise<void> {
  if (await popupIsOpen()) await popup.close()
  await restoreNativeHost()
  if (!page.isClosed()) await page.close()
}

async function clipboardWrites(): Promise<string[]> {
  const stored = await worker.evaluate(async () => chrome.storage.session.get(null))
  return Object.keys(stored).filter((key) => key.startsWith('clip:')).sort().map((key) => String(stored[key]))
}

const fieldValue = (page: Page, id: string) =>
  page.evaluate((target) => (document.getElementById(target) as HTMLInputElement).value, id)

describe('toolbar popup lifecycle', () => {
  it('fills when the desktop approves while the popup stays open', async () => {
    const { page, popup } = await startPopupFill('/login', 'Fill login')
    try {
      await approvePendingRequests()
      await expect.poll(() => fieldValue(page, 'password'), { timeout: 10000 }).toBe(approvedPassword)
      expect((await nativeCounts()).cancelled).toBe(0)
    } finally {
      await finish(page, popup)
    }
  }, 40000)

  it('keeps a login approval alive after the popup closes and fills once the desktop approves', async () => {
    const { page, popup } = await startPopupFill('/login', 'Fill login')
    try {
      await closePopupAndSettle(popup)
      expect((await nativeCounts()).cancelled).toBe(0)
      await approvePendingRequests()
      await expect.poll(() => fieldValue(page, 'password'), { timeout: 10000 }).toBe(approvedPassword)
      expect(await fieldValue(page, 'username')).toBe('jamie@example.test')
    } finally {
      await finish(page, popup)
    }
  }, 40000)

  it('keeps a password-change approval alive after the popup closes', async () => {
    const { page, popup } = await startPopupFill('/password-change', 'Change password')
    try {
      await closePopupAndSettle(popup)
      expect((await nativeCounts()).cancelled).toBe(0)
      await approvePendingRequests()
      await expect.poll(() => fieldValue(page, 'current'), { timeout: 10000 }).toBe(approvedPassword)
      const next = await fieldValue(page, 'new')
      expect(next.length).toBeGreaterThanOrEqual(16)
      expect(await fieldValue(page, 'confirm')).toBe(next)
    } finally {
      await finish(page, popup)
    }
  }, 40000)

  it('keeps an identity approval alive after the popup closes', async () => {
    const { page, popup } = await startPopupFill('/identity', 'Fill identity')
    try {
      await closePopupAndSettle(popup)
      expect((await nativeCounts()).cancelled).toBe(0)
      await approvePendingRequests()
      await expect.poll(() => fieldValue(page, 'email'), { timeout: 10000 }).toBe('jamie@example.test')
    } finally {
      await finish(page, popup)
    }
  }, 40000)

  it('cancels the pending approval and fills nothing when the document reloads after the popup closes', async () => {
    const { page, popup } = await startPopupFill('/login', 'Fill login')
    try {
      await closePopupAndSettle(popup)
      await page.reload()
      await expect.poll(async () => (await nativeCounts()).cancelled, { timeout: 10000 }).toBe(1)
      await approvePendingRequests()
      await new Promise((done) => setTimeout(done, 500))
      expect(await fieldValue(page, 'password')).toBe('')
      expect((await nativeCounts()).delivered).toBe(0)
    } finally {
      await finish(page, popup)
    }
  }, 40000)

  it('cancels the pending approval when the tab closes after the popup closes', async () => {
    const { page, popup } = await startPopupFill('/login', 'Fill login')
    try {
      await closePopupAndSettle(popup)
      await page.close()
      await expect.poll(async () => (await nativeCounts()).cancelled, { timeout: 10000 }).toBe(1)
      await approvePendingRequests()
      expect((await nativeCounts()).delivered).toBe(0)
    } finally {
      await finish(page, popup)
    }
  }, 40000)

  it('cancels the pending approval when the inline settings change after the popup closes', async () => {
    const { page, popup } = await startPopupFill('/login', 'Fill login')
    try {
      await closePopupAndSettle(popup)
      await worker.evaluate(async (pausedOrigin) => {
        await chrome.storage.local.set({
          inlineSettingsV1: { version: 2, pausedOrigins: [pausedOrigin], onboardingDismissed: true, cardSuggestionsEnabled: true },
        })
      }, origin)
      await expect.poll(async () => (await nativeCounts()).cancelled, { timeout: 10000 }).toBe(1)
      await approvePendingRequests()
      await new Promise((done) => setTimeout(done, 500))
      expect(await fieldValue(page, 'password')).toBe('')
    } finally {
      await worker.evaluate(async () => { await chrome.storage.local.remove('inlineSettingsV1') })
      await finish(page, popup)
    }
  }, 40000)

  it('ignores a navigation in a different tab while the approval is pending', async () => {
    const { page, popup } = await startPopupFill('/login', 'Fill login')
    const other = await context.newPage()
    try {
      await other.goto(`${origin}/identity`)
      await page.bringToFront()
      await closePopupAndSettle(popup)
      await other.reload()
      await new Promise((done) => setTimeout(done, 500))
      expect((await nativeCounts()).cancelled).toBe(0)
      await approvePendingRequests()
      await expect.poll(() => fieldValue(page, 'password'), { timeout: 10000 }).toBe(approvedPassword)
    } finally {
      await other.close()
      await finish(page, popup)
    }
  }, 40000)

  it('clears a temporarily copied password when the popup closes', async () => {
    const page = await openFixture('/registration')
    const popup = await openToolbarPopup()
    try {
      await popup.evaluate(`(() => {
        let held = ''
        const record = (value) => chrome.storage.session.set({ [\`clip:\${(performance.timeOrigin + performance.now()).toFixed(3).padStart(20, '0')}\`]: value })
        Object.defineProperty(navigator, 'clipboard', {
          value: {
            writeText: async (value) => { held = value; await record(value) },
            readText: async () => held,
          },
        })
      })()`)
      await waitForPopupButton(popup, 'Create password')
      await popup.click('Create password')
      await waitForPopupButton(popup, 'Copy temporarily')
      await popup.click('Copy temporarily')
      await expect.poll(async () => (await clipboardWrites()).at(-1) ?? '', { timeout: 5000 }).toMatch(/.{16,}/)
      expect((await clipboardWrites()).at(-1)).toBe(await fieldValue(page, 'password'))
      await closePopupAndSettle(popup)
      await expect.poll(async () => (await clipboardWrites()).at(-1), { timeout: 5000 }).toBe('')
    } finally {
      await worker.evaluate(async () => { await chrome.storage.session.clear() })
      await finish(page, popup)
    }
  }, 40000)
})

describe('card suggestions setting', () => {
  async function sendCardFill(): Promise<{ ok: boolean; code?: string }> {
    const extensionPage = await context.newPage()
    try {
      await extensionPage.goto(`chrome-extension://${extensionId}/options.html`)
      return await extensionPage.evaluate(() => chrome.runtime.sendMessage({ type: 'sesame:autofill-card' }))
    } finally {
      await extensionPage.close()
    }
  }

  async function setCardSuggestions(enabled: boolean): Promise<void> {
    await worker.evaluate(async (value) => {
      await chrome.storage.local.set({
        inlineSettingsV1: { version: 2, pausedOrigins: [], onboardingDismissed: true, cardSuggestionsEnabled: value },
      })
    }, enabled)
  }

  it('refuses the inline card fill message while card suggestions are off', async () => {
    const page = await openFixture('/login')
    await setCardSuggestions(false)
    try {
      expect(await sendCardFill()).toEqual({ ok: false, code: 'card-suggestions-disabled' })
    } finally {
      await worker.evaluate(async () => { await chrome.storage.local.remove('inlineSettingsV1') })
      await page.close()
    }
  }, 30000)

  it('passes the inline card fill message on when card suggestions are on', async () => {
    const page = await openFixture('/login')
    await setCardSuggestions(true)
    try {
      const result = await sendCardFill()
      expect(result.ok).toBe(false)
      expect(result.code).not.toBe('card-suggestions-disabled')
    } finally {
      await worker.evaluate(async () => { await chrome.storage.local.remove('inlineSettingsV1') })
      await page.close()
    }
  }, 30000)
})
