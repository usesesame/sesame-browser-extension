import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8')

const PINNED_ID = JSON.parse(read('contracts', 'native-host.json')).official_extension_id
const PERMISSIONS = ['activeTab', 'contextMenus', 'nativeMessaging', 'scripting', 'storage']

function idFor(publicKeyBase64) {
  const digest = createHash('sha256').update(Buffer.from(publicKeyBase64, 'base64')).digest().subarray(0, 16)
  return [...digest].map((byte) => 'abcdefghijklmnop'[byte >> 4] + 'abcdefghijklmnop'[byte & 0x0f]).join('')
}

test('the integration build uses a development identity the native host does not allow', () => {
  const integrationKey = read('manifests', 'integration-public-key.txt').trim()
  assert.notEqual(idFor(integrationKey), PINNED_ID, 'the integration build reuses the shipping identity')
  assert.match(
    read('vite.config.ts'),
    /manifests', 'integration-public-key\.txt'/,
    'the integration build no longer reads the development key',
  )
})

test('the shipping extension pins its identity and a minimal permission set', () => {
  for (const browser of ['chrome', 'edge']) {
    const manifest = JSON.parse(read('manifests', `${browser}.json`))
    assert.ok(manifest.key, `${browser} manifest has no pinned extension key`)
    assert.equal(idFor(manifest.key), PINNED_ID, `${browser} manifest no longer derives the pinned extension id`)
    assert.equal(manifest.manifest_version, 3)
    assert.equal(manifest.background?.type, 'module')
    assert.deepEqual([...manifest.permissions].sort(), [...PERMISSIONS].sort(), `${browser} manifest permissions drifted from the minimal set`)
    assert.deepEqual(manifest.optional_host_permissions, ['https://*/*'], `${browser} manifest broadened its optional host permission`)
    assert.equal(manifest.web_accessible_resources, undefined, `${browser} manifest exposes web-accessible resources`)
    assert.equal(manifest.content_scripts, undefined, `${browser} manifest injects scripts on every page instead of on demand`)
  }
})

const BROWSER_OWNED_SHORTCUTS = [
  'Ctrl+Shift+I',
  'Ctrl+Shift+J',
  'Ctrl+Shift+C',
  'Ctrl+Shift+N',
  'Ctrl+Shift+T',
  'Ctrl+Shift+B',
  'Ctrl+Shift+L',
  'Ctrl+Shift+O',
  'Ctrl+Shift+D',
  'Ctrl+Shift+G',
  'Ctrl+Shift+R',
  'Ctrl+Shift+W',
  'Ctrl+Shift+Delete',
  'Alt+Shift+I',
  'Alt+Shift+T',
  'Alt+Shift+A',
  'Alt+Shift+B',
  'Alt+Shift+N',
  'F12',
]

test('no suggested shortcut collides with a Chrome or Edge shortcut on Windows or Linux', () => {
  for (const browser of ['chrome', 'edge', 'firefox']) {
    const commands = JSON.parse(read('manifests', `${browser}.json`)).commands
    const suggested = Object.entries(commands).map(([name, command]) => [name, command.suggested_key.default])
    for (const [name, shortcut] of suggested) {
      assert.ok(!BROWSER_OWNED_SHORTCUTS.includes(shortcut), `${browser} command ${name} suggests ${shortcut}, which the browser already uses`)
    }
    assert.equal(new Set(suggested.map(([, shortcut]) => shortcut)).size, suggested.length, `${browser} suggests one shortcut twice`)
  }
})

test('every browser manifest suggests the same shortcuts', () => {
  const shortcuts = (browser) => JSON.stringify(JSON.parse(read('manifests', `${browser}.json`)).commands)
  assert.equal(shortcuts('edge'), shortcuts('chrome'))
  assert.equal(shortcuts('firefox'), shortcuts('chrome'))
})

test('the documentation names the suggested shortcut for every platform', () => {
  const commands = JSON.parse(read('manifests', 'chrome.json')).commands
  const documents = [read('README.md'), read('DESIGN.md'), read('src', 'popup', 'App.svelte'), read('src', 'options', 'App.svelte'), read('src', 'onboarding', 'App.svelte')]
  for (const [name, command] of Object.entries(commands)) {
    const { default: windowsAndLinux, mac } = command.suggested_key
    assert.match(mac, /^Command\+/, `${name} suggests ${mac} on Mac, which is not a Command shortcut`)
    assert.notEqual(mac, windowsAndLinux, `${name} suggests the same shortcut on every platform`)
    const documented = documents.filter((document) => document.includes(windowsAndLinux))
    assert.ok(documented.length > 0, `${name} suggests ${windowsAndLinux}, which no document names`)
    for (const document of documented) {
      assert.ok(document.includes(mac), `a document names ${windowsAndLinux} for ${name} without ${mac} for Mac`)
    }
  }
})

test('the Mac suggestions are unique and avoid common Command shortcuts', () => {
  const MAC_BROWSER_OWNED_SHORTCUTS = ['Command+Shift+T', 'Command+Shift+N', 'Command+Shift+B', 'Command+Shift+D', 'Command+Shift+J', 'Command+Shift+O', 'Command+Shift+R', 'Command+Shift+Delete']
  for (const browser of ['chrome', 'edge', 'firefox']) {
    const commands = JSON.parse(read('manifests', `${browser}.json`)).commands
    const suggested = Object.entries(commands).map(([name, command]) => [name, command.suggested_key.mac])
    for (const [name, shortcut] of suggested) {
      assert.ok(shortcut, `${browser} command ${name} has no Mac suggestion`)
      assert.ok(!MAC_BROWSER_OWNED_SHORTCUTS.includes(shortcut), `${browser} command ${name} suggests ${shortcut}, which the browser already uses on Mac`)
    }
    assert.equal(new Set(suggested.map(([, shortcut]) => shortcut)).size, suggested.length, `${browser} suggests one Mac shortcut twice`)
  }
})
