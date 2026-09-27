// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { attachInlineButton, overlayHost, showFillStatus } from '../../src/content/overlay'

function giveInputsLayout() {
  for (const input of document.querySelectorAll('input')) {
    input.setAttribute('style', 'opacity:1;display:block;visibility:visible')
    input.getBoundingClientRect = () => ({ width: 180, height: 32, top: 10, left: 10, bottom: 42, right: 190, x: 10, y: 10, toJSON: () => ({}) }) as DOMRect
  }
}

function captureShadow(): ShadowRoot[] {
  const roots: ShadowRoot[] = []
  const original = Element.prototype.attachShadow
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
    const root = original.call(this, { ...init, mode: 'open' })
    roots.push(root)
    return root
  })
  return roots
}

function baseOptions() {
  return {
    onFillRequest: vi.fn(),
    onConnectionCheck: vi.fn(),
    onOpenDesktop: vi.fn(),
    onFillIdentityRequest: vi.fn(),
    onFillCardRequest: vi.fn(),
  }
}

function statusText(roots: ShadowRoot[]): string {
  return roots.flatMap((root) => [...root.querySelectorAll('[role="status"]')])
    .map((node) => node.textContent ?? '')
    .join('')
}

describe('the overlay status entry point', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    overlayHost()?.remove()
    document.body.innerHTML = ''
  })

  it('reports no overlay before one is attached', () => {
    expect(showFillStatus({ code: 'cancelled' })).toBe(false)
  })

  it('shows the same text the overlay button would', () => {
    const roots = captureShadow()
    document.body.innerHTML = '<input type="text" autocomplete="username" /><input type="password" name="password" />'
    giveInputsLayout()
    const detach = attachInlineButton(baseOptions())
    document.querySelector('input')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))

    expect(showFillStatus({ state: 'unavailable', code: 'cancelled' })).toBe(true)
    expect(statusText(roots)).toBe('Fill was cancelled. Nothing was filled.')
    detach()
  })

  it('reports no overlay after it is detached', () => {
    document.body.innerHTML = '<input type="text" autocomplete="username" /><input type="password" name="password" />'
    giveInputsLayout()
    const detach = attachInlineButton(baseOptions())
    document.querySelector('input')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    detach()

    expect(showFillStatus({ state: 'unavailable', code: 'cancelled' })).toBe(false)
  })
})
