// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { FRAMED_PAGE_MESSAGE, requireTopLevelFrame } from '../../src/shared/frame-guard'

describe('extension pages run only at the top level', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>'
  })

  it('lets a top level page continue', () => {
    expect(requireTopLevelFrame(document, window)).toBe(true)
    expect(document.getElementById('app')).not.toBeNull()
  })

  it('refuses a framed page with a visible message', () => {
    const framed = { top: {} } as unknown as Window
    expect(requireTopLevelFrame(document, framed)).toBe(false)
    expect(document.getElementById('app')).toBeNull()
    expect(document.body.textContent).toContain(FRAMED_PAGE_MESSAGE)
  })
})
