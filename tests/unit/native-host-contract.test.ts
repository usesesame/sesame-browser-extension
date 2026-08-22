import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NATIVE_HOST } from '../../src/protocol/native'

const root = resolve(import.meta.dirname, '..', '..')
const read = (...parts: string[]) => JSON.parse(readFileSync(join(root, ...parts), 'utf8'))

const contract = read('contracts', 'native-host.json')
const chromeManifest = read('manifests', 'chrome.json')
const installer = readFileSync(join(root, 'install-native-host.ps1'), 'utf8')

function extensionIdForKey(base64Key: string): string {
  const digest = createHash('sha256').update(Buffer.from(base64Key, 'base64')).digest('hex').slice(0, 32)
  return Array.from(digest, (character) => String.fromCharCode(97 + Number.parseInt(character, 16))).join('')
}

describe('native host contract', () => {
  it('pins the extension ID that this manifest key actually produces', () => {
    expect(contract.official_extension_id).toBe(extensionIdForKey(chromeManifest.key))
  })

  it('allows exactly the origin belonging to that extension', () => {
    expect(contract.allowed_origins).toEqual([`chrome-extension://${contract.official_extension_id}/`])
  })

  it('names the same host the protocol module connects to', () => {
    expect(contract.host_name).toBe(NATIVE_HOST)
  })

  it('points at a desktop source file that the installer script also references', () => {
    expect(contract.desktop_source.repository_path).toMatch(/^src-tauri\/src\/.+browser_host\.rs$/)
    expect(contract.desktop_source.commit).toMatch(/^[0-9a-f]{40}$/)
  })

  it('refuses to register a host separated from the desktop executable', () => {
    expect(installer).toMatch(/Join-Path \(Split-Path -Parent \$resolvedHost\) 'sesame\.exe'/)
    expect(installer).toMatch(/Test-Path -LiteralPath \$desktopPath -PathType Leaf/)
  })
})

describe('vendored browser contract', () => {
  for (const version of ['v1', 'v2']) {
    const vendored = join(root, 'contracts', 'browser', version)
    const source = read('contracts', 'browser', version, 'SOURCE.json')

    it(`${version} records a digest matching every file it vendors`, () => {
      for (const [name, expected] of Object.entries(source.files as Record<string, string>)) {
        const path = join(vendored, name)
        expect(existsSync(path), `${name} is recorded but missing`).toBe(true)
        expect(createHash('sha256').update(readFileSync(path)).digest('hex'), name).toBe(expected)
      }
    })

    it(`${version} tracks the repository the desktop is actually published from`, () => {
      expect(source.publication.repository).toBe('usesesame/sesame-desktop')
      expect(source.implementationSourceCommit).toMatch(/^[0-9a-f]{40}$/)
    })
  }
})
