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

  it('moves to website access once the desktop is connected', () => {
    const steps = setupSteps('not-granted', { status: 'ready' })
    expect(steps.map((step) => step.state)).toEqual(['done', 'current'])
  })

  it('marks both done only when connected and allowed', () => {
    expect(setupSteps('granted', { status: 'ready' }).map((step) => step.state)).toEqual(['done', 'done'])
    expect(setupSteps('granted', { status: 'blocked', code: 'host-exited' }).map((step) => step.state)).toEqual(['current', 'done'])
  })
})
