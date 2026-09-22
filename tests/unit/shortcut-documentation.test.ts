import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..', '..')
const popup = readFileSync(resolve(root, 'src', 'popup', 'App.svelte'), 'utf8')
const onboarding = readFileSync(resolve(root, 'src', 'onboarding', 'App.svelte'), 'utf8')
const options = readFileSync(resolve(root, 'src', 'options', 'App.svelte'), 'utf8')

describe('keyboard shortcut documentation', () => {
  it('names the identity shortcut beside the login shortcut', () => {
    expect(popup).toContain('Ctrl+Shift+L')
    expect(popup).toContain('Ctrl+Shift+I')
    for (const surface of [onboarding, options]) {
      expect(surface).toContain('<kbd>L</kbd>')
      expect(surface).toContain('<kbd>I</kbd>')
    }
  })
})
