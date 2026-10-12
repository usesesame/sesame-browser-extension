import { describe, expect, it } from 'vitest'
import { desktopStateFromResponse, onboardingView } from '../../src/onboarding/readiness'

describe('onboarding readiness', () => {
  it('stays not ready when website access is granted without a desktop connection', () => {
    const view = onboardingView('granted', { status: 'blocked', code: 'host-not-found' })
    expect(view.ready).toBe(false)
    expect(view.headline).not.toMatch(/is ready/i)
    expect(view.connection?.action).toBe('install')
    expect(view.showConnectionAction).toBe(true)
    expect(view.showPermissionStep).toBe(false)
  })

  it('is ready only when the desktop is connected and website access is granted', () => {
    expect(onboardingView('granted', { status: 'ready' }).ready).toBe(true)
    expect(onboardingView('not-granted', { status: 'ready' }).ready).toBe(false)
    expect(onboardingView('granted', { status: 'blocked', code: 'host-exited' }).ready).toBe(false)
    expect(onboardingView('granted', { status: 'checking' }).ready).toBe(false)
  })

  it('asks for website access after the desktop connects', () => {
    const view = onboardingView('not-granted', { status: 'ready' })
    expect(view.showPermissionStep).toBe(true)
    expect(view.showConnectionAction).toBe(false)
  })

  it('shows a connection notice only when the desktop is not connected', () => {
    expect(onboardingView('not-granted', { status: 'ready' }).connection).toBeNull()
    expect(onboardingView('granted', { status: 'ready' }).connection).toBeNull()
    expect(onboardingView('not-granted', { status: 'checking' }).connection).toBeNull()
    expect(onboardingView('not-granted', { status: 'blocked', code: 'host-not-found' }).connection?.title)
      .toBe('Sesame desktop app not found')
  })

  it('asks to open the desktop when the helper cannot reach it', () => {
    const view = onboardingView('granted', { status: 'blocked', code: 'desktop-unavailable' })
    expect(view.ready).toBe(false)
    expect(view.connection?.action).toBe('open-desktop')
    expect(view.connection?.actionLabel).toBe('Open Sesame')
  })

  it('treats a failed check as not ready with a retry', () => {
    const view = onboardingView('granted', { status: 'blocked', code: 'timeout' })
    expect(view.ready).toBe(false)
    expect(view.connection?.action).toBe('retry')
    expect(view.showConnectionAction).toBe(true)
  })

  it('parses background responses into desktop states', () => {
    expect(desktopStateFromResponse({ state: 'ready', capabilities: { desktopAvailable: true } }))
      .toEqual({ status: 'ready' })
    expect(desktopStateFromResponse({ state: 'ready' }))
      .toEqual({ status: 'ready' })
    expect(desktopStateFromResponse({ state: 'desktop-offline', diagnostic: { code: 'connected' } }))
      .toEqual({ status: 'blocked', code: 'connected' })
    expect(desktopStateFromResponse({ state: 'unavailable', diagnostic: { code: 'host-not-found' } }))
      .toEqual({ status: 'blocked', code: 'host-not-found' })
    expect(desktopStateFromResponse({ state: 'unavailable', code: 'page-check-failed' }))
      .toEqual({ status: 'blocked', code: 'page-check-failed' })
    expect(desktopStateFromResponse(undefined)).toEqual({ status: 'blocked', code: 'native-runtime-error' })
  })
})
