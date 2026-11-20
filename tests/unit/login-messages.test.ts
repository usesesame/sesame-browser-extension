import { describe, expect, it } from 'vitest'
import { SAVE_MESSAGES, noFillableLoginMessage } from '../../src/popup/login-messages'

describe('popup login messages', () => {
  it('does not claim that no login is saved when the desktop finds none it can fill', () => {
    const message = noFillableLoginMessage('never.adatum.example')
    expect(message).toBe("Sesame has no login it can fill on never.adatum.example. In Sesame, check the login's website and its Browser filling setting.")
    expect(message).not.toMatch(/no login is saved/i)
  })

  it('names both reasons the desktop declines a save', () => {
    const message = SAVE_MESSAGES['approval-declined']
    expect(message).toMatch(/^Nothing was saved\./)
    expect(message).toContain('declined in Sesame')
    expect(message).toContain('never saves in Settings, Browser')
  })
})
