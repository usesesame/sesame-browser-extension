import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import http from 'node:http'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type BrowserContext, type Page, type Worker } from 'playwright-core'

const root = resolve(import.meta.dirname, '..', '..')
const extensionDir = join(root, 'dist', 'integration')
const inlineScriptId = 'sesame-inline-button'
const documentToken = 'fictional-document-token-0123456789'
const replacedToken = 'fictional-document-token-0123456789-replaced'
const approved = { username: 'jamie@example.test', password: 'fictional-pass-1' }

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

function findChromiumExecutable(): string {
  const configured = process.env.SESAME_BROWSER_TEST_EXECUTABLE
  if (configured) {
    if (existsSync(configured)) return configured
    throw new Error(`SESAME_BROWSER_TEST_EXECUTABLE points at a missing file: ${configured}`)
  }
  const candidates = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/opt/google/chrome/chrome',
    '/opt/helium-browser-bin/chrome',
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
  throw new Error(
    'No Chrome or Chromium executable found. Install one or set SESAME_BROWSER_TEST_EXECUTABLE.',
  )
}

function startServer(): Promise<{ server: http.Server; origin: string }> {
  return new Promise((resolveServer, rejectServer) => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(loginPage)
    })
    server.once('error', rejectServer)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        rejectServer(new Error('unexpected listen address'))
        return
      }
      resolveServer({ server, origin: `http://127.0.0.1:${address.port}` })
    })
  })
}

let context!: BrowserContext
let worker!: Worker
let page!: Page
let primaryServer!: http.Server
let secondaryServer!: http.Server
let primaryOrigin = ''
let secondaryOrigin = ''
let profileDir = ''

async function openFixture(path = '/login'): Promise<Page> {
  await page.goto(`${primaryOrigin}${path}`)
  await injectBridge(page)
  return page
}

async function injectBridge(target: Page): Promise<void> {
  const url = target.url()
  const result = await worker.evaluate(async (expected) => {
    const tabs = await chrome.tabs.query({})
    const tab = tabs.find((candidate) => candidate.url === expected)
    if (!tab?.id) return { ok: false }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
    return { ok: true }
  }, url)
  expect(result.ok, `content bridge injection for ${url}`).toBe(true)
}

async function callBridge(target: Page, name: string, ...args: unknown[]): Promise<unknown> {
  const url = target.url()
  return worker.evaluate(async ([expected, functionName, callArguments]) => {
    const tabs = await chrome.tabs.query({})
    const tab = tabs.find((candidate) => candidate.url === expected)
    if (!tab?.id) return { ok: false, code: 'browser-test-no-tab' }
    const bridgeName = String(functionName)
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (name: string, ...rest: unknown[]) => {
        const callable = (globalThis as Record<string, unknown>)[name]
        return typeof callable === 'function' ? callable(...rest) : { ok: false, code: 'content-bridge-unavailable' }
      },
      args: [bridgeName, ...callArguments],
    })
    return injection?.result ?? { ok: false, code: 'content-bridge-unavailable' }
  }, [url, name, args])
}

beforeAll(async () => {
  if (!existsSync(extensionDir)) {
    throw new Error('dist/integration is missing: run npm run build:integration first')
  }
  const primary = await startServer()
  const secondary = await startServer()
  primaryServer = primary.server
  secondaryServer = secondary.server
  primaryOrigin = primary.origin
  secondaryOrigin = secondary.origin
  profileDir = mkdtempSync(join(tmpdir(), 'sesame-browser-tests-'))
  context = await chromium.launchPersistentContext(profileDir, {
    executablePath: findChromiumExecutable(),
    args: [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  })
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15000 })
  await waitForInlineRegistration()
  page = await context.newPage()
})

async function waitForInlineRegistration(): Promise<void> {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const scripts = await worker.evaluate(async () => chrome.scripting.getRegisteredContentScripts())
    if (scripts.some((script) => script.id === inlineScriptId)) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 200))
  }
  throw new Error('the inline content script never registered')
}

afterAll(async () => {
  await context?.close()
  primaryServer?.close()
  secondaryServer?.close()
  if (profileDir) rmSync(profileDir, { recursive: true, force: true })
})

describe('extension browser suite', () => {
  it('starts the background service worker from the built extension', () => {
    expect(worker.url()).toMatch(/^chrome-extension:\/\/[a-p]{32}\/background\.js$/)
  })

  it('detects a real sign-in form through the content bridge', async () => {
    const current = await openFixture()
    const inspection = await callBridge(current, 'sesameInspectLoginSurface')
    expect(inspection).toMatchObject({
      ok: true,
      hasPasswordField: true,
      hasUsernameField: true,
      surface: { ok: true, origin: primaryOrigin },
    })
  })

  it('rejects a fill prepared for a different origin', async () => {
    const current = await openFixture()
    const prepared = await callBridge(
      current,
      'sesameFillLoginSurface',
      secondaryOrigin,
      documentToken,
      null,
      'prepare',
    )
    expect(prepared).toMatchObject({ ok: false, code: 'origin-mismatch' })
  })

  it('rejects a document token that no document issued', async () => {
    const current = await openFixture()
    const shortToken = await callBridge(
      current,
      'sesameFillLoginSurface',
      primaryOrigin,
      'short-token',
      null,
      'prepare',
    )
    expect(shortToken).toMatchObject({ ok: false, code: 'stale-document' })
    const neverPrepared = await callBridge(
      current,
      'sesameFillLoginSurface',
      primaryOrigin,
      documentToken,
      approved,
      'fill',
    )
    expect(neverPrepared).toMatchObject({ ok: false, code: 'stale-document' })
  })

  it('fails closed when the document is replaced between approval and fill', async () => {
    const current = await openFixture('/login')
    const prepared = await callBridge(
      current,
      'sesameFillLoginSurface',
      primaryOrigin,
      documentToken,
      null,
      'prepare',
    )
    expect(prepared).toMatchObject({ ok: true })
    await current.goto(`${primaryOrigin}/login?replaced=1`)
    await injectBridge(current)
    const stale = await callBridge(
      current,
      'sesameFillLoginSurface',
      primaryOrigin,
      documentToken,
      approved,
      'fill',
    )
    expect(stale).toMatchObject({ ok: false, code: 'stale-document' })
    const rebound = await callBridge(
      current,
      'sesameFillLoginSurface',
      primaryOrigin,
      replacedToken,
      null,
      'prepare',
    )
    expect(rebound).toMatchObject({ ok: true })
  })

  it('writes only the approved fields after a matching prepare', async () => {
    const current = await openFixture()
    const prepared = await callBridge(
      current,
      'sesameFillLoginSurface',
      primaryOrigin,
      documentToken,
      null,
      'prepare',
    )
    expect(prepared).toMatchObject({ ok: true })
    const filled = await callBridge(
      current,
      'sesameFillLoginSurface',
      primaryOrigin,
      documentToken,
      approved,
      'fill',
    )
    expect(filled).toMatchObject({ ok: true, usernameFilled: true, passwordFilled: true })
    const values = await current.evaluate(() => ({
      username: (document.getElementById('username') as HTMLInputElement).value,
      password: (document.getElementById('password') as HTMLInputElement).value,
    }))
    expect(values).toEqual({ username: approved.username, password: approved.password })
    expect(new URL(current.url()).pathname).toBe('/login')
  })

  it('detaches the inline overlay when the site is paused', async () => {
    const current = await openFixture()
    await current.evaluate(() => (document.getElementById('username') as HTMLInputElement).focus())
    await expect.poll(
      async () => current.evaluate(() => document.querySelector('[id^="sesame-overlay-"]') !== null),
      { timeout: 10000 },
    ).toBe(true)
    await worker.evaluate(async (origin) => {
      const stored = await chrome.storage.local.get('inlineSettingsV1')
      const settings = (stored['inlineSettingsV1'] as Record<string, unknown> | undefined) ?? {
        version: 2,
        pausedOrigins: [],
        onboardingDismissed: true,
        cardSuggestionsEnabled: true,
      }
      await chrome.storage.local.set({
        inlineSettingsV1: { ...settings, pausedOrigins: [origin], onboardingDismissed: true },
      })
    }, primaryOrigin)
    const policy = await worker.evaluate(async (expected) => {
      const tabs = await chrome.tabs.query({})
      const tab = tabs.find((candidate) => candidate.url === expected)
      if (!tab?.id) return { enabled: true }
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => chrome.runtime.sendMessage({ type: 'sesame:inline-policy' }),
      })
      return (injection?.result ?? { enabled: true }) as { enabled?: boolean }
    }, current.url())
    expect(policy.enabled).toBe(false)
    await expect.poll(
      async () => current.evaluate(() => document.querySelector('[id^="sesame-overlay-"]') === null),
      { timeout: 10000 },
    ).toBe(true)
  })

  it('closes the fill port for callers other than the popup', async () => {
    const guard = await worker.evaluate(
      () => new Promise<{ disconnected: boolean; messages: number }>((resolvePromise) => {
        const port = chrome.runtime.connect({ name: 'sesame:fill' })
        let messages = 0
        port.onMessage.addListener(() => { messages += 1 })
        port.onDisconnect.addListener(() => resolvePromise({ disconnected: true, messages }))
        setTimeout(() => resolvePromise({ disconnected: false, messages }), 2000)
        port.postMessage({ type: 'start' })
      }),
    )
    expect(guard.disconnected).toBe(true)
    expect(guard.messages).toBe(0)
  })

  it('reports the desktop as unavailable in the popup without a native host', async () => {
    const extensionId = new URL(worker.url()).host
    const popup = await context.newPage()
    await popup.goto(`chrome-extension://${extensionId}/popup.html`)
    await expect.poll(
      async () => popup.evaluate(() => document.body.innerText),
      { timeout: 10000 },
    ).toMatch(/desktop app is not running/)
    expect(await popup.evaluate(() => document.body.innerText)).toMatch(/Open Sesame/)
  })
})
