import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type BrowserContext, type Page, type Worker } from 'playwright-core'
import { findChromiumExecutable } from '../support/chromium-executable'

const root = resolve(import.meta.dirname, '..', '..')
const packagesDirectory = resolve(root, process.env.SESAME_PACKAGED_TEST_DIRECTORY ?? 'store-packages')

interface PackageRecord {
  packages: { browser: string; filename: string; channel: string; extensionId: string; sha256: string }[]
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T

let temporaryRoot = ''
let unpackedDirectory = ''
let zipManifestText = ''
let expectedExtensionId = ''
let context!: BrowserContext
let worker!: Worker
let extensionId = ''
const consoleErrors: string[] = []

function describeMessage(source: string, text: string): string {
  return `${source}: ${text}`
}

async function openExtensionPage(name: string): Promise<{ page: Page; errors: string[] }> {
  const errors: string[] = []
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(describeMessage(name, message.text()))
  })
  page.on('pageerror', (error) => errors.push(describeMessage(name, error.message)))
  page.on('requestfailed', (request) => errors.push(describeMessage(name, `request failed: ${request.url()}`)))
  const response = await page.goto(`chrome-extension://${extensionId}/${name}.html`)
  expect(response?.ok(), `${name}.html loads from the packaged extension`).toBe(true)
  await page.waitForLoadState('networkidle')
  await expect.poll(async () => page.locator('#app').evaluate((node) => node.childElementCount), { timeout: 10000 }).toBeGreaterThan(0)
  await page.waitForTimeout(500)
  return { page, errors }
}

beforeAll(async () => {
  const version = readJson<{ version: string }>(join(root, 'package.json')).version
  const filename = `sesame-extension-${version}-chromium.zip`
  const zipPath = join(packagesDirectory, filename)
  if (!existsSync(zipPath)) {
    throw new Error(`${zipPath} is missing: run npm run release:check or npm run package:stores first`)
  }

  const record = readJson<PackageRecord>(join(packagesDirectory, 'store-release.json'))
  const entry = record.packages.find((candidate) => candidate.filename === filename)
  if (!entry || entry.channel !== 'download' || entry.browser !== 'chromium') {
    throw new Error(`store-release.json does not list ${filename} as the Chromium download`)
  }
  const digest = createHash('sha256').update(readFileSync(zipPath)).digest('hex')
  if (digest !== entry.sha256) throw new Error(`${filename} is not the package that store-release.json records`)
  expectedExtensionId = entry.extensionId

  temporaryRoot = mkdtempSync(join(tmpdir(), 'sesame-packaged-extension-'))
  unpackedDirectory = join(temporaryRoot, 'unpacked')
  mkdirSync(unpackedDirectory)
  execFileSync('unzip', ['-q', zipPath, '-d', unpackedDirectory])
  zipManifestText = execFileSync('unzip', ['-p', zipPath, 'manifest.json'], { encoding: 'utf8' })

  context = await chromium.launchPersistentContext(join(temporaryRoot, 'profile'), {
    executablePath: findChromiumExecutable(),
    args: [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--disable-extensions-except=${unpackedDirectory}`,
      `--load-extension=${unpackedDirectory}`,
    ],
  })
  context.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(describeMessage('context', message.text()))
  })
  context.on('weberror', (error) => consoleErrors.push(describeMessage('context', error.error().message)))
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => {
    throw new Error('the service worker did not start from the unzipped package')
  })
  extensionId = new URL(worker.url()).host
}, 60000)

afterAll(async () => {
  await context?.close()
  if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true })
})

describe('the Chromium package that ships', () => {
  it('starts the service worker from the unzipped package', () => {
    expect(worker.url()).toBe(`chrome-extension://${extensionId}/background.js`)
    expect(extensionId).toBe(expectedExtensionId)
  })

  it('loads the manifest that is in the zip, without the test key or extra host permissions', async () => {
    const zipManifest = JSON.parse(zipManifestText) as Record<string, unknown>
    const loaded = await worker.evaluate(() => chrome.runtime.getManifest()) as Record<string, unknown>
    expect(loaded).toEqual(zipManifest)

    const shipping = readJson<Record<string, unknown>>(join(root, 'manifests', 'chrome.json'))
    const testKey = readFileSync(join(root, 'manifests', 'integration-public-key.txt'), 'utf8').trim()
    expect(loaded.key).toBe(shipping.key)
    expect(loaded.key).not.toBe(testKey)
    expect(loaded).not.toHaveProperty('host_permissions')
    expect(loaded.permissions).toEqual(shipping.permissions)
    expect(loaded.optional_host_permissions).toEqual(shipping.optional_host_permissions)
  })

  it('opens the popup page without a console error', async () => {
    const { page, errors } = await openExtensionPage('popup')
    await page.close()
    expect(errors).toEqual([])
  })

  it('opens the options page without a console error', async () => {
    const { page, errors } = await openExtensionPage('options')
    await page.close()
    expect(errors).toEqual([])
  })

  it('logs no console error anywhere in the extension', () => {
    expect(consoleErrors).toEqual([])
  })
})
