import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import http from 'node:http'
import https from 'node:https'
import { join, resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type BrowserContext, type Page, type Worker } from 'playwright-core'

const root = resolve(import.meta.dirname, '..', '..')
let extensionDir = join(root, 'dist', 'integration')
let extensionTempRoot = ''
const inlineScriptId = 'sesame-inline-button'
const documentToken = 'fictional-document-token-0123456789'
const replacedToken = 'fictional-document-token-0123456789-replaced'
const approved = { username: 'jamie@example.test', password: 'fictional-pass-1' }
const nativeHostRegistered = process.env.SESAME_NATIVE_HOST_TEST === '1'
const nativeHostExpectsDesktop = nativeHostRegistered && process.env.SESAME_NATIVE_HOST_EXPECT_DESKTOP === '1'
const manualNativeFill = nativeHostRegistered && process.env.SESAME_MANUAL_NATIVE_FILL === '1'

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

const usernameStepPage = `<!doctype html><html><body>
<form id="login-form" action="/signin" method="post">
<h1>Sign in</h1>
<label for="username">Username</label>
<input id="username" name="username" type="email" autocomplete="username" required>
<button type="submit" id="signin">Next</button>
</form>
</body></html>`

const passwordStepPage = `<!doctype html><html><body>
<form id="login-form" action="/signin" method="post">
<h1>Enter your password</h1>
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required>
<button type="submit" id="signin">Sign in</button>
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
<label for="postal">Postal code</label>
<input id="postal" name="postal" type="text" autocomplete="postal-code">
</form>
</body></html>`

const cardPage = `<!doctype html><html><body>
<form id="payment">
<h1>Payment</h1>
<label for="cardname">Name on card</label>
<input id="cardname" name="cardname" type="text" autocomplete="cc-name">
<label for="cardnumber">Card number</label>
<input id="cardnumber" name="cardnumber" type="text" autocomplete="cc-number">
<label for="expiry">Expiry</label>
<input id="expiry" name="expiry" type="text" autocomplete="cc-exp">
<label for="cvc">Security code</label>
<input id="cvc" name="cvc" type="text" autocomplete="cc-csc">
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

function pageBody(path: string): string {
  return path === '/username' ? usernameStepPage
    : path === '/password' ? passwordStepPage
      : path === '/identity' ? identityPage
        : path === '/card' ? cardPage
          : path === '/registration' ? registrationPage
            : path === '/password-change' ? passwordChangePage : loginPage
}

function handlePage(request: http.IncomingMessage, response: http.ServerResponse): void {
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
  response.writeHead(200, { 'content-type': 'text/html' })
  response.end(pageBody(path))
}

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
    const server = http.createServer(handlePage)
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

function startTlsServer(directory: string): Promise<{ server: https.Server; origin: string }> {
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', join(directory, 'key.pem'),
    '-out', join(directory, 'cert.pem'),
    '-days', '2',
    '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1',
  ], { stdio: 'ignore' })
  return new Promise((resolveServer, rejectServer) => {
    const server = https.createServer({
      key: readFileSync(join(directory, 'key.pem')),
      cert: readFileSync(join(directory, 'cert.pem')),
    }, handlePage)
    server.once('error', rejectServer)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        rejectServer(new Error('unexpected listen address'))
        return
      }
      resolveServer({ server, origin: `https://127.0.0.1:${address.port}` })
    })
  })
}

let context!: BrowserContext
let worker!: Worker
let page!: Page
let primaryServer!: http.Server
let secondaryServer!: http.Server
let tlsServer!: https.Server
let primaryOrigin = ''
let secondaryOrigin = ''
let tlsOrigin = ''
let tlsDirectory = ''
let profileDir = ''

async function openFixture(path = '/login'): Promise<Page> {
  await page.goto(`${primaryOrigin}${path}`)
  await injectBridge(page)
  return page
}

async function openTlsFixture(path: string): Promise<Page> {
  await page.goto(`${tlsOrigin}${path}`)
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

async function findTabId(url: string): Promise<number> {
  return worker.evaluate(async (expected) => {
    const tabs = await chrome.tabs.query({})
    return tabs.find((tab) => tab.url === expected)?.id ?? -1
  }, url)
}

async function openReadyPopup(extensionId: string, tabId: number, url: string): Promise<Page> {
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  await popup.evaluate(({ tabId: expectedTabId, url: expectedUrl }) => {
    const runtime = chrome.runtime as unknown as {
      sendMessage: (message: { type?: string }) => Promise<unknown>
    }
    const tabs = chrome.tabs as unknown as { query: unknown }
    const original = runtime.sendMessage.bind(chrome.runtime)
    runtime.sendMessage = async (message) => message?.type === 'sesame:connect'
      ? {
          state: 'ready',
          title: 'Connected',
          message: 'Ready to fill from this browser.',
          capabilities: { desktopAvailable: true, locked: false, fillAvailable: true },
          diagnostic: { code: 'connected' },
        }
      : original(message)
    tabs.query = async () => [{ id: expectedTabId, url: expectedUrl }]
  }, { tabId, url })
  return popup
}

async function openInstalledPopup(extensionId: string, tabId: number, url: string): Promise<Page> {
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  await popup.evaluate(({ tabId: expectedTabId, url: expectedUrl }) => {
    const tabs = chrome.tabs as unknown as { query: unknown }
    tabs.query = async () => [{ id: expectedTabId, url: expectedUrl }]
  }, { tabId, url })
  return popup
}

interface CdpNode {
  nodeId: number
  parentId?: number
  nodeName: string
  nodeValue?: string
  shadowRoots?: CdpNode[]
  children?: CdpNode[]
  contentDocument?: CdpNode
}

function findTextNode(node: CdpNode, text: string): CdpNode | undefined {
  if (node.nodeName === '#text' && node.nodeValue === text) return node
  for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) {
    const found = findTextNode(child, text)
    if (found) return found
  }
  return node.contentDocument ? findTextNode(node.contentDocument, text) : undefined
}

async function clickClosedShadowText(target: Page, text: string): Promise<void> {
  const cdp = await target.context().newCDPSession(target)
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true }) as { root: CdpNode }
    const textNode = findTextNode(root, text)
    if (!textNode?.parentId) throw new Error(`closed shadow text not found: ${text}`)
    const { object } = await cdp.send('DOM.resolveNode', { nodeId: textNode.parentId }) as {
      object: { objectId?: string }
    }
    if (!object.objectId) throw new Error(`closed shadow node did not resolve: ${text}`)
    await cdp.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: 'function () { this.click() }',
      returnByValue: true,
    })
  } finally {
    await cdp.detach()
  }
}

async function mockNativeHostInWorker(): Promise<void> {
  await worker.evaluate(() => {
    const target = globalThis as typeof globalThis & {
      __sesameTestRestore?: () => void
      __sesameSaveRequests?: number
      __sesameLastSave?: Record<string, unknown>
    }
    const runtime = chrome.runtime as unknown as { connectNative: unknown }
    const original = runtime.connectNative
    const previous = target.__sesameTestRestore
    target.__sesameSaveRequests = 0
    delete target.__sesameLastSave
    target.__sesameTestRestore = () => {
      runtime.connectNative = original
      delete target.__sesameSaveRequests
      delete target.__sesameLastSave
      previous?.()
    }
    runtime.connectNative = () => {
      const messageListeners: Array<(message: unknown) => void> = []
      const disconnectListeners: Array<() => void> = []
      return {
        name: 'app.usesesame.browser',
        postMessage(request: { type?: string; requestId?: string; version?: number; fields?: string }) {
          queueMicrotask(() => {
            const base = { version: request?.version ?? 1, requestId: request?.requestId }
            if (request?.type === 'capabilities') {
              messageListeners.forEach((listener) => listener({
                ...base,
                type: 'capabilities',
                installed: true,
                desktopAvailable: true,
                locked: false,
                fillAvailable: true,
              }))
            } else if (request?.type === 'fill') {
              const fields = request.fields ?? 'both'
              messageListeners.forEach((listener) => listener({
                ...base,
                type: 'fill',
                ...(fields === 'password' ? {} : { username: 'jamie@example.test' }),
                ...(fields === 'username' ? {} : { password: 'fictional-inline-pass' }),
              }))
            } else if (request?.type === 'save') {
              target.__sesameSaveRequests = (target.__sesameSaveRequests ?? 0) + 1
              target.__sesameLastSave = request
              messageListeners.forEach((listener) => listener({
                ...base,
                type: 'saved',
                saved: true,
              }))
            } else {
              disconnectListeners.forEach((listener) => listener())
            }
          })
        },
        disconnect() {},
        onMessage: {
          addListener: (callback: (message: unknown) => void) => { messageListeners.push(callback) },
          removeListener: () => {},
        },
        onDisconnect: {
          addListener: (callback: () => void) => { disconnectListeners.push(callback) },
          removeListener: () => {},
        },
      }
    }
  })
}

async function installMissingNativeHost(): Promise<void> {
  await worker.evaluate(() => {
    const target = globalThis as typeof globalThis & { __sesameOriginalConnectNative?: unknown }
    const runtime = chrome.runtime as unknown as { connectNative: unknown }
    if (!target.__sesameOriginalConnectNative) {
      target.__sesameOriginalConnectNative = runtime.connectNative
    }
    runtime.connectNative = () => {
      throw new Error('Specified native messaging host not found.')
    }
  })
}

async function useRegisteredNativeHost(): Promise<void> {
  await worker.evaluate(() => {
    const target = globalThis as typeof globalThis & { __sesameOriginalConnectNative?: unknown }
    const runtime = chrome.runtime as unknown as { connectNative: unknown }
    if (!target.__sesameOriginalConnectNative) return
    runtime.connectNative = target.__sesameOriginalConnectNative
    delete target.__sesameOriginalConnectNative
  })
}

async function countNativeSaves(): Promise<number> {
  return worker.evaluate(() => {
    const target = globalThis as typeof globalThis & { __sesameSaveRequests?: number }
    return target.__sesameSaveRequests ?? 0
  })
}

async function lastNativeSave(): Promise<Record<string, unknown> | undefined> {
  return worker.evaluate(() => {
    const target = globalThis as typeof globalThis & { __sesameLastSave?: Record<string, unknown> }
    return target.__sesameLastSave
  })
}

async function overrideWorkerTab(tabId: number, url: string): Promise<void> {
  await worker.evaluate(({ tabId: expectedTabId, url: expectedUrl }) => {
    const target = globalThis as typeof globalThis & { __sesameTestRestore?: () => void }
    const tabs = chrome.tabs as unknown as { query: unknown }
    const originalQuery = tabs.query
    const previous = target.__sesameTestRestore
    target.__sesameTestRestore = () => {
      tabs.query = originalQuery
      previous?.()
    }
    tabs.query = async () => [{ id: expectedTabId, url: expectedUrl }]
  }, { tabId, url })
}

async function restoreWorkerMocks(): Promise<void> {
  await worker.evaluate(() => {
    const target = globalThis as typeof globalThis & { __sesameTestRestore?: () => void }
    target.__sesameTestRestore?.()
    delete target.__sesameTestRestore
  })
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
  tlsDirectory = mkdtempSync(join(tmpdir(), 'sesame-browser-tls-'))
  const tls = await startTlsServer(tlsDirectory)
  tlsServer = tls.server
  tlsOrigin = tls.origin
  profileDir = mkdtempSync(join(tmpdir(), 'sesame-browser-tests-'))
  if (nativeHostRegistered) {
    const manifestSource = process.env.SESAME_NATIVE_HOST_MANIFEST
    if (manifestSource) {
      if (!existsSync(manifestSource)) {
        throw new Error(`SESAME_NATIVE_HOST_MANIFEST points at a missing file: ${manifestSource}`)
      }
      const nativeHostsDir = join(profileDir, 'NativeMessagingHosts')
      mkdirSync(nativeHostsDir, { recursive: true })
      copyFileSync(manifestSource, join(nativeHostsDir, 'app.usesesame.browser.json'))
    }

    extensionTempRoot = mkdtempSync(join(tmpdir(), 'sesame-native-extension-'))
    extensionDir = join(extensionTempRoot, 'integration')
    cpSync(join(root, 'dist', 'integration'), extensionDir, { recursive: true })
    const copiedManifestPath = join(extensionDir, 'manifest.json')
    const shipping = JSON.parse(readFileSync(join(root, 'manifests', 'chrome.json'), 'utf8')) as { key: string }
    const copiedManifest = JSON.parse(readFileSync(copiedManifestPath, 'utf8')) as Record<string, unknown>
    copiedManifest.key = shipping.key
    writeFileSync(copiedManifestPath, JSON.stringify(copiedManifest, null, 2))
  }
  context = await chromium.launchPersistentContext(profileDir, {
    executablePath: findChromiumExecutable(),
    args: [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--ignore-certificate-errors',
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  })
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15000 })
  await installMissingNativeHost()
  await waitForInlineRegistration()
  page = await context.newPage()
})

afterEach(async () => {
  if (nativeHostRegistered) await installMissingNativeHost()
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
  tlsServer?.close()
  if (profileDir) rmSync(profileDir, { recursive: true, force: true })
  if (extensionTempRoot) rmSync(extensionTempRoot, { recursive: true, force: true })
  if (tlsDirectory) rmSync(tlsDirectory, { recursive: true, force: true })
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

  it('fills only the username on a username-only step', async () => {
    const current = await openFixture('/username')
    const prepared = await callBridge(
      current,
      'sesameFillLoginSurface',
      primaryOrigin,
      documentToken,
      null,
      'prepare',
    )
    expect(prepared).toMatchObject({ ok: true, usernameFilled: true, passwordFilled: false })
    const filled = await callBridge(
      current,
      'sesameFillLoginSurface',
      primaryOrigin,
      documentToken,
      approved,
      'fill',
    )
    expect(filled).toMatchObject({ ok: true, usernameFilled: true, passwordFilled: false })
    const values = await current.evaluate(() => ({
      username: (document.getElementById('username') as HTMLInputElement).value,
      inputs: Array.from(document.querySelectorAll('input')).map((input) => input.value),
      text: document.body.innerText,
    }))
    expect(values.username).toBe(approved.username)
    expect(values.inputs).not.toContain(approved.password)
    expect(values.text).not.toContain(approved.password)
  })

  it('fills only the password on a password-only step', async () => {
    const current = await openFixture('/password')
    const prepared = await callBridge(
      current,
      'sesameFillLoginSurface',
      primaryOrigin,
      documentToken,
      null,
      'prepare',
    )
    expect(prepared).toMatchObject({ ok: true, usernameFilled: false, passwordFilled: true })
    const filled = await callBridge(
      current,
      'sesameFillLoginSurface',
      primaryOrigin,
      documentToken,
      approved,
      'fill',
    )
    expect(filled).toMatchObject({ ok: true, usernameFilled: false, passwordFilled: true })
    const values = await current.evaluate(() => ({
      password: (document.getElementById('password') as HTMLInputElement).value,
      inputs: Array.from(document.querySelectorAll('input')).map((input) => input.value),
      text: document.body.innerText,
    }))
    expect(values.password).toBe(approved.password)
    expect(values.inputs).not.toContain(approved.username)
    expect(values.text).not.toContain(approved.username)
  })

  it('fills only the approved identity fields after a matching prepare', async () => {
    const approvedIdentity = {
      fullName: 'Jamie Example',
      email: 'jamie@example.test',
      phone: '+31 20 555 0100',
    }
    const current = await openFixture('/identity')
    const prepared = await callBridge(
      current,
      'sesameFillIdentitySurface',
      primaryOrigin,
      documentToken,
      null,
      'prepare',
    )
    expect(prepared).toMatchObject({ ok: true })
    expect((prepared as { filledFields: string[] }).filledFields)
      .toEqual(expect.arrayContaining(['fullName', 'email', 'phone']))
    const filled = await callBridge(
      current,
      'sesameFillIdentitySurface',
      primaryOrigin,
      documentToken,
      approvedIdentity,
      'fill',
    )
    expect(filled).toMatchObject({ ok: true })
    expect((filled as { filledFields: string[] }).filledFields)
      .toEqual(expect.arrayContaining(['fullName', 'email', 'phone']))
    const values = await current.evaluate(() => ({
      fullName: (document.getElementById('name') as HTMLInputElement).value,
      email: (document.getElementById('email') as HTMLInputElement).value,
      phone: (document.getElementById('phone') as HTMLInputElement).value,
      postalCode: (document.getElementById('postal') as HTMLInputElement).value,
    }))
    expect(values).toEqual({
      fullName: approvedIdentity.fullName,
      email: approvedIdentity.email,
      phone: approvedIdentity.phone,
      postalCode: '',
    })
  })

  it('refuses card fill on an insecure page', async () => {
    const current = await openFixture()
    const prepared = await callBridge(
      current,
      'sesameFillCardSurface',
      primaryOrigin,
      documentToken,
      null,
      'prepare',
    )
    expect(prepared).toMatchObject({ ok: false, code: 'insecure-page' })
  })

  it('fills only the approved card fields on a secure page', async () => {
    const approvedCard = {
      cardholderName: 'Jamie Example',
      number: '4242 4242 4242 4242',
      expiryMonth: '12',
      expiryYear: '2030',
      securityCode: '123',
    }
    const current = await openTlsFixture('/card')
    const prepared = await callBridge(
      current,
      'sesameFillCardSurface',
      tlsOrigin,
      documentToken,
      null,
      'prepare',
    )
    expect(prepared).toMatchObject({ ok: true })
    expect((prepared as { filledFields: string[] }).filledFields)
      .toEqual(expect.arrayContaining(['cardholderName', 'number', 'securityCode']))
    const filled = await callBridge(
      current,
      'sesameFillCardSurface',
      tlsOrigin,
      documentToken,
      approvedCard,
      'fill',
    )
    expect(filled).toMatchObject({ ok: true })
    const values = await current.evaluate(() => ({
      cardholderName: (document.getElementById('cardname') as HTMLInputElement).value,
      number: (document.getElementById('cardnumber') as HTMLInputElement).value,
      expiry: (document.getElementById('expiry') as HTMLInputElement).value,
      securityCode: (document.getElementById('cvc') as HTMLInputElement).value,
    }))
    expect(values).toEqual({
      cardholderName: approvedCard.cardholderName,
      number: approvedCard.number,
      expiry: '12/2030',
      securityCode: approvedCard.securityCode,
    })
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
    await worker.evaluate(async () => {
      const stored = await chrome.storage.local.get('inlineSettingsV1')
      const settings = (stored['inlineSettingsV1'] as Record<string, unknown> | undefined) ?? {}
      await chrome.storage.local.set({ inlineSettingsV1: { ...settings, pausedOrigins: [] } })
    })
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

  it('reports a missing desktop app in the popup with install and retry actions', async () => {
    const extensionId = new URL(worker.url()).host
    const popup = await context.newPage()
    await popup.goto(`chrome-extension://${extensionId}/popup.html`)
    await expect.poll(
      async () => popup.evaluate(() => document.body.innerText),
      { timeout: 10000 },
    ).toMatch(/Sesame desktop app not found/)
    const body = await popup.evaluate(() => document.body.innerText)
    expect(body).not.toMatch(/desktop app is not running/)
    await expect.poll(
      async () => popup.getByRole('button', { name: 'Get Sesame' }).isVisible(),
      { timeout: 5000 },
    ).toBe(true)
    await expect.poll(
      async () => popup.getByRole('button', { name: /check desktop connection and page again/i }).isEnabled(),
      { timeout: 5000 },
    ).toBe(true)
    await popup.close()
  }, 15000)

  it('shows optional website access without implying the desktop is ready', async () => {
    const extensionId = new URL(worker.url()).host
    const popup = await context.newPage()
    await popup.goto(`chrome-extension://${extensionId}/popup.html`)
    await expect.poll(
      async () => popup.evaluate(() => document.body.innerText),
      { timeout: 10000 },
    ).toMatch(/Sesame desktop app not found/)
    await popup.evaluate(() => {
      const permissions = chrome.permissions as { getAll: () => Promise<{ origins?: string[] }> }
      permissions.getAll = async () => ({ origins: ['https://*/*'] })
    })
    await popup.getByRole('button', { name: /check desktop connection and page again/i }).click()
    await expect.poll(
      async () => popup.evaluate(() => document.body.innerText),
      { timeout: 5000 },
    ).toMatch(/Available on login fields/)
    expect(await popup.evaluate(() => document.body.innerText)).toMatch(/Sesame desktop app not found/)
    await popup.evaluate(() => {
      const permissions = chrome.permissions as {
        getAll: () => Promise<{ origins?: string[] }>
        request: (details: { origins: string[] }) => Promise<boolean>
      }
      permissions.getAll = async () => ({ origins: [] })
      permissions.request = async () => false
    })
    await popup.getByRole('button', { name: /check desktop connection and page again/i }).click()
    await expect.poll(
      async () => popup.getByRole('button', { name: 'Enable', exact: true }).isVisible(),
      { timeout: 5000 },
    ).toBe(true)
    await popup.getByRole('button', { name: 'Enable', exact: true }).press('Enter')
    await expect.poll(
      async () => popup.evaluate(() => document.body.innerText),
      { timeout: 5000 },
    ).toMatch(/Website access was not granted/)
    await popup.close()
  }, 20000)

  it('does not claim readiness in onboarding without the desktop app', async () => {
    const extensionId = new URL(worker.url()).host
    const onboarding = await context.newPage()
    await onboarding.goto(`chrome-extension://${extensionId}/onboarding.html`)
    await expect.poll(
      async () => onboarding.evaluate(() => document.body.innerText),
      { timeout: 10000 },
    ).toMatch(/Sesame desktop app not found/)
    const body = await onboarding.evaluate(() => document.body.innerText)
    expect(body).not.toMatch(/Sesame is ready/)
    await expect.poll(
      async () => onboarding.locator('section[aria-live="polite"]').isVisible(),
      { timeout: 5000 },
    ).toBe(true)
    const install = onboarding.getByRole('link', { name: 'Get Sesame' })
    await expect.poll(async () => install.isVisible(), { timeout: 5000 }).toBe(true)
    expect(await install.getAttribute('href')).toBe('https://github.com/usesesame/sesame-desktop/releases/latest')
    await expect.poll(
      async () => onboarding.getByRole('button', { name: 'Enable on websites' }).isVisible(),
      { timeout: 5000 },
    ).toBe(true)
    await expect.poll(
      async () => onboarding.getByRole('button', { name: 'Check again' }).isEnabled(),
      { timeout: 5000 },
    ).toBe(true)
    await onboarding.close()
  }, 15000)

  it('rechecks the desktop connection from onboarding and keeps the not-ready state', async () => {
    const extensionId = new URL(worker.url()).host
    const onboarding = await context.newPage()
    await onboarding.goto(`chrome-extension://${extensionId}/onboarding.html`)
    await expect.poll(
      async () => onboarding.evaluate(() => document.body.innerText),
      { timeout: 10000 },
    ).toMatch(/Sesame desktop app not found/)
    await onboarding.getByRole('button', { name: 'Check again' }).click()
    await expect.poll(
      async () => onboarding.evaluate(() => document.body.innerText),
      { timeout: 10000 },
    ).toMatch(/still not connected/)
    expect(await onboarding.evaluate(() => document.body.innerText)).not.toMatch(/Sesame is ready/)
    await onboarding.close()
  }, 15000)

  it('stays not ready when website access is rejected in onboarding', async () => {
    const extensionId = new URL(worker.url()).host
    const onboarding = await context.newPage()
    await onboarding.goto(`chrome-extension://${extensionId}/onboarding.html`)
    await expect.poll(
      async () => onboarding.evaluate(() => document.body.innerText),
      { timeout: 10000 },
    ).toMatch(/Sesame desktop app not found/)
    await onboarding.evaluate(() => {
      const permissions = chrome.permissions as {
        request: (details: { origins: string[] }) => Promise<boolean>
      }
      permissions.request = async () => false
    })
    await onboarding.getByRole('button', { name: 'Enable on websites' }).press('Enter')
    await expect.poll(
      async () => onboarding.evaluate(() => document.body.innerText),
      { timeout: 5000 },
    ).toMatch(/Website access was not granted/)
    expect(await onboarding.evaluate(() => document.body.innerText)).not.toMatch(/Sesame is ready/)
    await onboarding.close()
  }, 15000)

  it('recomputes the onboarding state after reopening', async () => {
    const extensionId = new URL(worker.url()).host
    const first = await context.newPage()
    await first.goto(`chrome-extension://${extensionId}/onboarding.html`)
    await expect.poll(
      async () => first.evaluate(() => document.body.innerText),
      { timeout: 10000 },
    ).toMatch(/Sesame desktop app not found/)
    await first.close()
    const second = await context.newPage()
    await second.goto(`chrome-extension://${extensionId}/onboarding.html`)
    await expect.poll(
      async () => second.evaluate(() => document.body.innerText),
      { timeout: 10000 },
    ).toMatch(/Sesame desktop app not found/)
    expect(await second.evaluate(() => document.body.innerText)).not.toMatch(/Sesame is ready/)
    await second.close()
  }, 20000)

  it('maps mocked desktop states to the right primary action', async () => {
    const extensionId = new URL(worker.url()).host
    const cases = [
      { reply: { state: 'locked', diagnostic: { code: 'connected' } }, action: 'Unlock Sesame' },
      { reply: { state: 'desktop-offline', diagnostic: { code: 'connected' } }, action: 'Open Sesame' },
      { reply: { state: 'unavailable', diagnostic: { code: 'protocol-mismatch' } }, action: 'Update Sesame' },
      { reply: { state: 'unavailable', diagnostic: { code: 'host-not-found' } }, action: 'Get Sesame' },
      { reply: { state: 'unavailable', diagnostic: { code: 'host-forbidden' } }, action: 'Reload extension' },
      { reply: { state: 'unavailable', diagnostic: { code: 'timeout' } }, action: 'Check again' },
    ]
    for (const testCase of cases) {
      const popup = await context.newPage()
      await popup.goto(`chrome-extension://${extensionId}/popup.html`)
      await popup.evaluate((reply) => {
        const runtime = chrome.runtime as {
          sendMessage: (message: { type?: string }) => Promise<unknown>
        }
        runtime.sendMessage = async (message) => message?.type === 'sesame:connect'
          ? reply
          : { state: 'unavailable', code: 'page-check-failed' }
      }, testCase.reply)
      await popup.getByRole('button', { name: /check desktop connection and page again/i }).click()
      await expect.poll(
        async () => popup.getByRole('button', { name: testCase.action, exact: true }).isVisible(),
        { timeout: 5000 },
      ).toBe(true)
      await popup.close()
    }
  }, 30000)

  it('announces the connection state and keeps the diagnostic control usable', async () => {
    const extensionId = new URL(worker.url()).host
    const popup = await context.newPage()
    await popup.goto(`chrome-extension://${extensionId}/popup.html`)
    await popup.evaluate(() => {
      const runtime = chrome.runtime as {
        sendMessage: (message: { type?: string }) => Promise<unknown>
      }
      runtime.sendMessage = async (message) => message?.type === 'sesame:connect'
        ? {
            state: 'unavailable',
            diagnostic: {
              code: 'host-not-found',
              checkedAt: new Date().toISOString(),
              extensionVersion: '0.0.0',
            },
          }
        : { state: 'unavailable', code: 'page-check-failed' }
    })
    await popup.getByRole('button', { name: 'Check desktop connection and page again' }).click()
    await expect.poll(
      async () => popup.locator('section.card[role="status"]').count(),
      { timeout: 5000 },
    ).toBeGreaterThan(0)
    expect(await popup.locator('main').innerText()).toMatch(/Sesame desktop app not found/)
    await popup.locator('details.diagnostics summary').click()
    const height = await popup.locator('details.diagnostics button').evaluate((element) => element.getBoundingClientRect().height)
    expect(height).toBeGreaterThanOrEqual(24)
    await popup.close()
  }, 20000)

  it('reports a desktop decline when the fill approval is cancelled', async () => {
    const extensionId = new URL(worker.url()).host
    const current = await openFixture('/login')
    const fixtureUrl = current.url()
    const tabId = await findTabId(fixtureUrl)
    expect(tabId).toBeGreaterThan(0)
    await worker.evaluate(({ tabId: expectedTabId, url }) => {
      const target = globalThis as typeof globalThis & { __sesameTestRestore?: () => void }
      const runtime = chrome.runtime as unknown as { connectNative: unknown }
      const tabs = chrome.tabs as unknown as { query: unknown }
      const originalConnect = runtime.connectNative
      const originalQuery = tabs.query
      target.__sesameTestRestore = () => {
        runtime.connectNative = originalConnect
        tabs.query = originalQuery
      }
      runtime.connectNative = () => {
        const messageListeners: Array<(message: unknown) => void> = []
        const disconnectListeners: Array<() => void> = []
        return {
          name: 'app.usesesame.browser',
          postMessage(request: { requestId?: string; version?: number }) {
            queueMicrotask(() => {
              messageListeners.forEach((listener) => listener({
                version: request?.version ?? 1,
                type: 'fill-unavailable',
                requestId: request?.requestId,
                reason: 'approvalDeclined',
              }))
            })
          },
          disconnect() {},
          onMessage: {
            addListener: (callback: (message: unknown) => void) => { messageListeners.push(callback) },
            removeListener: () => {},
          },
          onDisconnect: {
            addListener: (callback: () => void) => { disconnectListeners.push(callback) },
            removeListener: () => {},
          },
        }
      }
      tabs.query = async () => [{ id: expectedTabId, url }]
    }, { tabId, url: fixtureUrl })

    const popup = await openReadyPopup(extensionId, tabId, fixtureUrl)
    try {
      await popup.getByRole('button', { name: /check desktop connection and page again/i }).click()
      await expect.poll(
        async () => popup.getByRole('button', { name: 'Fill login', exact: true }).isVisible(),
        { timeout: 10000 },
      ).toBe(true)
      await popup.getByRole('button', { name: 'Fill login', exact: true }).click()
      await expect.poll(
        async () => popup.evaluate(() => document.body.innerText),
        { timeout: 15000 },
      ).toMatch(/declined in Sesame/)
    } finally {
      if (!popup.isClosed()) await popup.close()
      await worker.evaluate(() => {
        const target = globalThis as typeof globalThis & { __sesameTestRestore?: () => void }
        target.__sesameTestRestore?.()
        delete target.__sesameTestRestore
      })
    }
  }, 30000)

  it('fails closed when the fill port closes before an answer', async () => {
    const extensionId = new URL(worker.url()).host
    const current = await openFixture('/login')
    const fixtureUrl = current.url()
    const tabId = await findTabId(fixtureUrl)
    expect(tabId).toBeGreaterThan(0)
    await worker.evaluate(({ tabId: expectedTabId, url }) => {
      const target = globalThis as typeof globalThis & { __sesameTestRestore?: () => void }
      const tabs = chrome.tabs as unknown as { query: unknown }
      const originalQuery = tabs.query
      target.__sesameTestRestore = () => { tabs.query = originalQuery }
      tabs.query = async () => [{ id: expectedTabId, url }]
    }, { tabId, url: fixtureUrl })
    const popup = await openReadyPopup(extensionId, tabId, fixtureUrl)
    try {
      await popup.evaluate(() => {
        const runtime = chrome.runtime as unknown as { connect: unknown }
        runtime.connect = () => {
          const disconnectListeners: Array<() => void> = []
          return {
            name: 'sesame:fill',
            postMessage() {
              queueMicrotask(() => disconnectListeners.forEach((listener) => listener()))
            },
            disconnect() {},
            onMessage: { addListener: () => {}, removeListener: () => {} },
            onDisconnect: {
              addListener: (callback: () => void) => { disconnectListeners.push(callback) },
              removeListener: () => {},
            },
          }
        }
      })
      await popup.getByRole('button', { name: /check desktop connection and page again/i }).click()
      await expect.poll(
        async () => popup.getByRole('button', { name: 'Fill login', exact: true }).isVisible(),
        { timeout: 10000 },
      ).toBe(true)
      await popup.getByRole('button', { name: 'Fill login', exact: true }).click()
      await expect.poll(
        async () => popup.evaluate(() => document.body.innerText),
        { timeout: 10000 },
      ).toMatch(/desktop connection closed/)
    } finally {
      if (!popup.isClosed()) await popup.close()
      await worker.evaluate(() => {
        const target = globalThis as typeof globalThis & { __sesameTestRestore?: () => void }
        target.__sesameTestRestore?.()
        delete target.__sesameTestRestore
      })
    }
  }, 30000)

  it('fills from the inline control on the page', async () => {
    const current = await openFixture('/login')
    const fixtureUrl = current.url()
    const tabId = await findTabId(fixtureUrl)
    expect(tabId).toBeGreaterThan(0)
    await worker.evaluate(({ tabId: expectedTabId, url }) => {
      const target = globalThis as typeof globalThis & { __sesameTestRestore?: () => void }
      const tabs = chrome.tabs as unknown as { query: unknown }
      const originalQuery = tabs.query
      const previous = target.__sesameTestRestore
      target.__sesameTestRestore = () => {
        tabs.query = originalQuery
        previous?.()
      }
      tabs.query = async () => [{ id: expectedTabId, url }]
    }, { tabId, url: fixtureUrl })
    await mockNativeHostInWorker()
    try {
      const extensionId = new URL(worker.url()).host
      const warmup = await context.newPage()
      await warmup.goto(`chrome-extension://${extensionId}/popup.html`)
      await expect.poll(
        async () => warmup.evaluate(() => document.body.innerText),
        { timeout: 5000 },
      ).toMatch(/Connected/)
      await warmup.close()
      await current.evaluate(() => (document.getElementById('username') as HTMLInputElement).focus())
      await expect.poll(
        async () => current.evaluate(() => document.querySelector('[id^="sesame-overlay-"]') !== null),
        { timeout: 10000 },
      ).toBe(true)
      await clickClosedShadowText(current, 'Fill with Sesame')
      await expect.poll(
        async () => current.evaluate(() => ({
          username: (document.getElementById('username') as HTMLInputElement).value,
          password: (document.getElementById('password') as HTMLInputElement).value,
        })),
        { timeout: 15000 },
      ).toEqual({ username: 'jamie@example.test', password: 'fictional-inline-pass' })
    } finally {
      await restoreWorkerMocks()
    }
  }, 30000)

  it('saves a registration only after the popup action', async () => {
    const extensionId = new URL(worker.url()).host
    const current = await openFixture('/registration')
    const fixtureUrl = current.url()
    const tabId = await findTabId(fixtureUrl)
    expect(tabId).toBeGreaterThan(0)
    await overrideWorkerTab(tabId, fixtureUrl)
    await mockNativeHostInWorker()
    const popup = await openReadyPopup(extensionId, tabId, fixtureUrl)
    try {
      await popup.getByRole('button', { name: /check desktop connection and page again/i }).click()
      await expect.poll(
        async () => popup.getByRole('button', { name: 'Create password', exact: true }).isVisible(),
        { timeout: 10000 },
      ).toBe(true)
      await popup.getByRole('button', { name: 'Create password', exact: true }).click()
      await expect.poll(
        async () => popup.getByRole('button', { name: 'Save this login', exact: true }).isVisible(),
        { timeout: 10000 },
      ).toBe(true)
      expect(await countNativeSaves()).toBe(0)
      await popup.getByRole('button', { name: 'Save this login', exact: true }).click()
      await expect.poll(
        async () => popup.evaluate(() => document.body.innerText),
        { timeout: 15000 },
      ).toMatch(/Login saved in Sesame/)
      expect(await countNativeSaves()).toBe(1)
    } finally {
      if (!popup.isClosed()) await popup.close()
      await restoreWorkerMocks()
    }
  }, 30000)

  it('fills a password-change form and saves the generated password after the form clears', async () => {
    const extensionId = new URL(worker.url()).host
    const current = await openFixture('/password-change')
    const fixtureUrl = current.url()
    const tabId = await findTabId(fixtureUrl)
    expect(tabId).toBeGreaterThan(0)
    await overrideWorkerTab(tabId, fixtureUrl)
    await mockNativeHostInWorker()
    const popup = await openReadyPopup(extensionId, tabId, fixtureUrl)
    try {
      await popup.getByRole('button', { name: /check desktop connection and page again/i }).click()
      await expect.poll(
        async () => popup.getByRole('button', { name: 'Change password', exact: true }).isVisible(),
        { timeout: 10000 },
      ).toBe(true)
      await popup.getByRole('button', { name: 'Change password', exact: true }).click()
      const generated = await popup.locator('.generated-password code').innerText()
      expect(generated.length).toBeGreaterThanOrEqual(16)
      await expect.poll(
        async () => current.evaluate(() => ({
          current: (document.getElementById('current') as HTMLInputElement).value,
          next: (document.getElementById('new') as HTMLInputElement).value,
          confirm: (document.getElementById('confirm') as HTMLInputElement).value,
        })),
        { timeout: 15000 },
      ).toEqual({ current: 'fictional-inline-pass', next: generated, confirm: generated })
      await current.evaluate(() => {
        document.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((input) => { input.value = '' })
      })
      await current.goto(`${primaryOrigin}/password-changed`)
      await popup.getByRole('button', { name: 'Save this login', exact: true }).click()
      await expect.poll(
        async () => popup.evaluate(() => document.body.innerText),
        { timeout: 15000 },
      ).toMatch(/Login saved in Sesame/)
      expect(await countNativeSaves()).toBe(1)
      expect(await lastNativeSave()).toMatchObject({
        type: 'save',
        kind: 'update',
        origin: primaryOrigin,
        password: generated,
      })
    } finally {
      if (!popup.isClosed()) await popup.close()
      await restoreWorkerMocks()
    }
  }, 30000)

  it('does not read or save when the registration form is submitted', async () => {
    const extensionId = new URL(worker.url()).host
    const current = await openFixture('/registration')
    const fixtureUrl = current.url()
    const tabId = await findTabId(fixtureUrl)
    expect(tabId).toBeGreaterThan(0)
    await overrideWorkerTab(tabId, fixtureUrl)
    await mockNativeHostInWorker()
    const popup = await openReadyPopup(extensionId, tabId, fixtureUrl)
    try {
      await popup.getByRole('button', { name: /check desktop connection and page again/i }).click()
      await expect.poll(
        async () => popup.getByRole('button', { name: 'Create password', exact: true }).isVisible(),
        { timeout: 10000 },
      ).toBe(true)
      await popup.getByRole('button', { name: 'Create password', exact: true }).click()
      await expect.poll(
        async () => popup.getByRole('button', { name: 'Save this login', exact: true }).isVisible(),
        { timeout: 10000 },
      ).toBe(true)
      await current.evaluate(() => (document.getElementById('signup-form') as HTMLFormElement).requestSubmit())
      await expect.poll(
        async () => new URL(current.url()).pathname,
        { timeout: 5000 },
      ).toBe('/signup')
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(await countNativeSaves()).toBe(0)
    } finally {
      if (!popup.isClosed()) await popup.close()
      await restoreWorkerMocks()
    }
  }, 30000)

  it('does not offer a save before a Sesame fill', async () => {
    const extensionId = new URL(worker.url()).host
    const fresh = await context.newPage()
    await fresh.goto(`${primaryOrigin}/registration`)
    await injectBridge(fresh)
    const fixtureUrl = fresh.url()
    const tabId = await findTabId(fixtureUrl)
    expect(tabId).toBeGreaterThan(0)
    await overrideWorkerTab(tabId, fixtureUrl)
    const popup = await openReadyPopup(extensionId, tabId, fixtureUrl)
    try {
      await popup.getByRole('button', { name: /check desktop connection and page again/i }).click()
      await expect.poll(
        async () => popup.getByRole('button', { name: 'Create password', exact: true }).isVisible(),
        { timeout: 10000 },
      ).toBe(true)
      expect(await popup.getByRole('button', { name: 'Save this login', exact: true }).count()).toBe(0)
    } finally {
      if (!popup.isClosed()) await popup.close()
      if (!fresh.isClosed()) await fresh.close()
      await restoreWorkerMocks()
    }
  }, 30000)

  it('refuses a held save from a page context', async () => {
    const fresh = await context.newPage()
    try {
      await fresh.goto(`${primaryOrigin}/password-change`)
      await injectBridge(fresh)
      const tabId = await findTabId(fresh.url())
      expect(tabId).toBeGreaterThan(0)
      const response = await worker.evaluate(async ({ tabId: expectedTabId }) => {
        const [injection] = await chrome.scripting.executeScript({
          target: { tabId: expectedTabId },
          func: (tab) => chrome.runtime.sendMessage({ type: 'sesame:save-held', tabId: tab }),
          args: [expectedTabId],
        })
        return injection?.result ?? null
      }, { tabId })
      expect(response).toEqual({ ok: false, code: 'save-not-armed' })
    } finally {
      if (!fresh.isClosed()) await fresh.close()
    }
  }, 15000)

  it('refuses to arm a save session from a page context', async () => {
    const fresh = await context.newPage()
    try {
      await fresh.goto(`${primaryOrigin}/registration`)
      await injectBridge(fresh)
      const tabId = await findTabId(fresh.url())
      expect(tabId).toBeGreaterThan(0)
      const armed = await worker.evaluate(async ({ tabId: expectedTabId, origin }) => {
        const [injection] = await chrome.scripting.executeScript({
          target: { tabId: expectedTabId },
          func: (tab, claimedOrigin) => chrome.runtime.sendMessage({ type: 'sesame:arm-save', tabId: tab, origin: claimedOrigin }),
          args: [expectedTabId, origin],
        })
        return injection?.result ?? null
      }, { tabId, origin: primaryOrigin })
      expect(armed).toEqual({ armed: false })
      const state = await worker.evaluate(async ({ tabId: expectedTabId }) => {
        const [injection] = await chrome.scripting.executeScript({
          target: { tabId: expectedTabId },
          func: (tab) => chrome.runtime.sendMessage({ type: 'sesame:save-state', tabId: tab }),
          args: [expectedTabId],
        })
        return injection?.result ?? null
      }, { tabId })
      expect(state).toEqual({ armed: false, held: false })
    } finally {
      if (!fresh.isClosed()) await fresh.close()
    }
  }, 15000)

  it.skipIf(!nativeHostRegistered)('answers through the registered native host', async () => {
    await useRegisteredNativeHost()
    const extensionId = new URL(worker.url()).host
    const popup = await context.newPage()
    await popup.goto(`chrome-extension://${extensionId}/popup.html`)
    try {
      const connection = await popup.evaluate(async () => chrome.runtime.sendMessage({
        type: 'sesame:connect',
        force: true,
      }) as {
        state?: string
        capabilities?: { desktopAvailable?: boolean; locked?: boolean; fillAvailable?: boolean }
        diagnostic?: { code?: string; host?: string }
      })
      expect(connection?.diagnostic?.host).toBe('app.usesesame.browser')
      expect(connection?.diagnostic?.code).toBe('connected')
      expect(['desktop-offline', 'locked', 'ready']).toContain(connection?.state)
      if (nativeHostExpectsDesktop) {
        expect(connection?.capabilities?.desktopAvailable).toBe(true)
      }
    } finally {
      if (!popup.isClosed()) await popup.close()
    }
  }, 30000)

  it.skipIf(!manualNativeFill)('saves and fills a disposable login through the registered native host', async () => {
    await useRegisteredNativeHost()
    const extensionId = new URL(worker.url()).host
    const fixture = await openFixture('/registration')
    await fixture.fill('#email', 'jamie@example.test')
    const registrationUrl = fixture.url()
    const registrationTabId = await findTabId(registrationUrl)
    expect(registrationTabId).toBeGreaterThan(0)
    await overrideWorkerTab(registrationTabId, registrationUrl)
    const savePopup = await openInstalledPopup(extensionId, registrationTabId, registrationUrl)
    let generated = ''
    try {
      await savePopup.getByRole('button', { name: /check desktop connection and page again/i }).click()
      await expect.poll(
        async () => savePopup.getByRole('button', { name: 'Create password', exact: true }).isVisible(),
        { timeout: 30000 },
      ).toBe(true)
      await savePopup.getByRole('button', { name: 'Create password', exact: true }).click()
      generated = await savePopup.locator('.generated-password code').innerText()
      expect(generated.length).toBeGreaterThan(0)
      await savePopup.getByRole('button', { name: 'Save this login', exact: true }).click()
      await expect.poll(
        async () => savePopup.evaluate(() => document.body.innerText),
        { timeout: 300000 },
      ).toMatch(/Login saved in Sesame/)
    } finally {
      if (!savePopup.isClosed()) await savePopup.close()
      await restoreWorkerMocks()
    }

    await fixture.goto(`${primaryOrigin}/login`)
    await injectBridge(fixture)
    const loginUrl = fixture.url()
    const loginTabId = await findTabId(loginUrl)
    expect(loginTabId).toBeGreaterThan(0)
    await overrideWorkerTab(loginTabId, loginUrl)
    const fillPopup = await openInstalledPopup(extensionId, loginTabId, loginUrl)
    try {
      await fillPopup.getByRole('button', { name: /check desktop connection and page again/i }).click()
      await expect.poll(
        async () => fillPopup.getByRole('button', { name: 'Fill login', exact: true }).isVisible(),
        { timeout: 30000 },
      ).toBe(true)
      await fillPopup.getByRole('button', { name: 'Fill login', exact: true }).click()
      await expect.poll(
        async () => fixture.evaluate(() => (document.getElementById('username') as HTMLInputElement).value),
        { timeout: 300000 },
      ).toBe('jamie@example.test')
      expect(await fixture.evaluate(() => (document.getElementById('password') as HTMLInputElement).value)).toBe(generated)
    } finally {
      if (!fillPopup.isClosed()) await fillPopup.close()
      await restoreWorkerMocks()
    }
  }, 660000)
})
