import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..', '..')
const read = (...parts: string[]) => readFileSync(resolve(root, ...parts), 'utf8')
const popup = read('src', 'popup', 'App.svelte')
const onboarding = read('src', 'onboarding', 'App.svelte')
const options = read('src', 'options', 'App.svelte')
const readme = read('README.md')
const design = read('DESIGN.md')

type Command = { suggested_key: { default: string; mac: string } }
const commands = JSON.parse(read('manifests', 'chrome.json')).commands as Record<string, Command>
const login = commands['fill-login'].suggested_key
const identity = commands['fill-identity'].suggested_key

describe('keyboard shortcut documentation', () => {
  it('names the login and identity shortcuts for Windows, Linux and Mac in the popup', () => {
    for (const key of [login.default, login.mac, identity.default, identity.mac]) {
      expect(popup).toContain(key)
    }
    expect(popup).toContain('on Windows and Linux')
    expect(popup).toContain('on Mac')
  })

  it('names the login and identity shortcuts for Windows, Linux and Mac on options and onboarding', () => {
    for (const surface of [onboarding, options]) {
      for (const key of [login.default, login.mac, identity.default, identity.mac]) {
        expect(surface).toContain(`<kbd>${key}</kbd>`)
      }
      expect(surface).toContain('on Windows and Linux')
      expect(surface).toContain('on Mac')
    }
  })

  it('names the login shortcut for both platforms in the README and design notes', () => {
    for (const document of [readme, design]) {
      expect(document).toContain(`\`${login.default}\` on Windows and Linux`)
      expect(document).toContain(`\`${login.mac}\` on Mac`)
    }
  })
})
