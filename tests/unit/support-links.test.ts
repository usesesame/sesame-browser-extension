import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SESAME_LINKS } from '../../src/shared/links'
import { HELP_LINKS } from '../../src/options/help-links'
import { DESKTOP_RELEASES_URL } from '../../src/protocol/connection-presentation'

const root = resolve(import.meta.dirname, '..', '..')
const options = readFileSync(resolve(root, 'src', 'options', 'App.svelte'), 'utf8')
const onboarding = readFileSync(resolve(root, 'src', 'onboarding', 'App.svelte'), 'utf8')

describe('support links', () => {
  it('point only at the Sesame website and the Sesame repositories', () => {
    for (const value of Object.values(SESAME_LINKS)) {
      const url = new URL(value)
      expect(url.protocol).toBe('https:')
      const owned = url.hostname === 'usesesame.app' || (url.hostname === 'github.com' && url.pathname.startsWith('/usesesame/'))
      expect(owned).toBe(true)
    }
  })

  it('keep one desktop download address', () => {
    expect(DESKTOP_RELEASES_URL).toBe(SESAME_LINKS.desktopReleases)
  })

  it('appear in settings and open in a new tab without an opener', () => {
    const hrefs = HELP_LINKS.map((link) => link.href)
    for (const key of ['support', 'website', 'privacy', 'security', 'issues', 'source']) {
      expect(hrefs).toContain(SESAME_LINKS[key as keyof typeof SESAME_LINKS])
    }
    expect(options).toContain('{#each HELP_LINKS')
    const anchors = options.match(/<a [^>]*target="_blank"[^>]*>/g) ?? []
    expect(anchors.length).toBeGreaterThanOrEqual(3)
    for (const anchor of anchors) expect(anchor).toContain('rel="noopener noreferrer"')
  })

  it('give every help link a label and a hint', () => {
    for (const link of HELP_LINKS) {
      expect(link.label.length).toBeGreaterThan(0)
      expect(link.hint.length).toBeGreaterThan(0)
    }
  })

  it('give the onboarding page a support and privacy link', () => {
    expect(onboarding).toContain('SESAME_LINKS.support')
    expect(onboarding).toContain('SESAME_LINKS.privacy')
  })

  it('opens the browser shortcut page that matches the browser', () => {
    expect(options).toContain('chrome://extensions/shortcuts')
    expect(options).toContain('edge://extensions/shortcuts')
  })
})
