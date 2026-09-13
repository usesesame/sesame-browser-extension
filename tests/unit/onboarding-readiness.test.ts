import { describe, expect, it } from 'vitest'
import { desktopStateFromResponse, onboardingView } from '../../src/onboarding/readiness'

describe('onboarding readiness', () => {
  it('stays not ready when website access is granted without a desktop connection', () => {
    const view = onboardingView('granted', { status: 'blocked', code: 'host-not-found' })
    expect(view.ready).toBe(false)
    expect(view.headline).not.toMatch(/is ready/i)
    expect(view.connection.action).toBe('install')
    expect(view.showConnectionAction).toBe(true)
    expect(view.showPermissionStep).toBe(false)
  })

  it('is ready only when the desktop is connected and website access is granted', () => {
    expect(onboardingView('granted', { status: 'ready', fillAvailable: true }).ready).toBe(true)
    expect(onboardingView('not-granted', { status: 'ready', fillAvailable: true }).ready).toBe(false)
    expect(onboardingView('granted', { status: 'locked' }).ready).toBe(false)
    expect(onboardingView('granted', { status: 'checking' }).ready).toBe(false)
  })

  it('asks for website access after the desktop connects', () => {
    const view = onboardingView('not-granted', { status: 'ready', fillAvailable: true })
    expect(view.showPermissionStep).toBe(true)
    expect(view.showConnectionAction).toBe(false)
    expect(view.connection.state).toBe('ready')
  })

  it('offers to open and unlock a locked desktop', () => {
    const view = onboardingView('granted', { status: 'locked' })
    expect(view.ready).toBe(false)
    expect(view.connection.action).toBe('open-desktop')
    expect(view.connection.actionLabel).toBe('Unlock Sesame')
  })

  it('treats a failed check as not ready with a retry', () => {
    const view = onboardingView('granted', { status: 'blocked', code: 'timeout' })
    expect(view.ready).toBe(false)
    expect(view.connection.action).toBe('retry')
    expect(view.showConnectionAction).toBe(true)
  })

  it('parses background responses into desktop states', () => {
    expect(desktopStateFromResponse({ state: 'ready', capabilities: { fillAvailable: true } }))
      .toEqual({ status: 'ready', fillAvailable: true })
    expect(desktopStateFromResponse({ state: 'ready', capabilities: {} }))
      .toEqual({ status: 'ready', fillAvailable: false })
    expect(desktopStateFromResponse({ state: 'locked' })).toEqual({ status: 'locked' })
    expect(desktopStateFromResponse({ state: 'unavailable', diagnostic: { code: 'host-not-found' } }))
      .toEqual({ status: 'blocked', code: 'host-not-found' })
    expect(desktopStateFromResponse({ state: 'unavailable', code: 'page-check-failed' }))
      .toEqual({ status: 'blocked', code: 'page-check-failed' })
    expect(desktopStateFromResponse(undefined)).toEqual({ status: 'blocked', code: 'native-runtime-error' })
  })
})
