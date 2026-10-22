import { describe, expect, it } from 'vitest'
import { setupSteps } from '../../src/onboarding/readiness'

describe('setup steps', () => {
  it('starts with the desktop app and holds website access back', () => {
    const steps = setupSteps('not-granted', { status: 'blocked', code: 'host-not-found' })
    expect(steps.map((step) => step.state)).toEqual(['current', 'waiting'])
  })

  it('says it is looking while the connection is being checked', () => {
    const [desktop] = setupSteps('not-granted', { status: 'checking' })
    expect(desktop.detail).toBe('Looking for the desktop app.')
    expect(desktop.state).toBe('current')
  })

  it('tells a person without the desktop app to install it', () => {
    const [desktop] = setupSteps('not-granted', { status: 'blocked', code: 'host-not-found' })
    expect(desktop.detail).toBe('Download and install Sesame, then open it once.')
  })

  it('explains other connection problems on the desktop step', () => {
    const [desktop] = setupSteps('granted', { status: 'blocked', code: 'desktop-unavailable' })
    expect(desktop.detail).toBe('The browser helper is installed, but the desktop app is not running.')
  })

  it('moves to website access once the desktop is connected', () => {
    const steps = setupSteps('not-granted', { status: 'ready' })
    expect(steps.map((step) => step.state)).toEqual(['done', 'current'])
    expect(steps[0].detail).toBe('')
    expect(steps[1].detail).toMatch(/popup and the keyboard shortcuts still work/)
  })

  it('marks both done only when connected and allowed, with no detail left', () => {
    const steps = setupSteps('granted', { status: 'ready' })
    expect(steps.map((step) => step.state)).toEqual(['done', 'done'])
    expect(steps.map((step) => step.detail)).toEqual(['', ''])
    expect(setupSteps('granted', { status: 'blocked', code: 'host-exited' }).map((step) => step.state)).toEqual(['current', 'done'])
  })

  it('leaves the website step without detail until the desktop is connected', () => {
    const [, website] = setupSteps('not-granted', { status: 'blocked', code: 'host-not-found' })
    expect(website.detail).toBe('')
  })
})
