import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8')

const PINNED_ID = 'idbkfhhjnniibleeanchljhakfhecnlg'
const PERMISSIONS = ['activeTab', 'nativeMessaging', 'scripting', 'storage']

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
