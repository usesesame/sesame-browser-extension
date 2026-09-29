// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachInlineButton, overlayHost } from '../../src/content/overlay'
import { stubVisibilityObserver, visibilityObserver } from './release-visibility-stub'

const WARNING =
  'This page looks like apple.example, a site you saved, but the address is different. Sesame did not fill anything. Check the address bar before you sign in.'

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

function visibleLabels(roots: ShadowRoot[]): string[] {
  return roots.flatMap((root) => [...root.querySelectorAll('button')])
    .filter((button) => !button.hidden)
    .map((button) => button.textContent ?? '')
}

function statusText(roots: ShadowRoot[]): string {
  return roots.flatMap((root) => [...root.querySelectorAll('.status')])
    .map((node) => node.textContent ?? '')
    .join('')
}

function loginButton(roots: ShadowRoot[]): HTMLButtonElement {
  return roots.flatMap((root) => [...root.querySelectorAll('button')])
    .find((candidate) => candidate.textContent === 'Fill with Sesame')!
}

function focusFirstInput() {
  document.querySelector('input')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
}

async function armRelease(roots: ShadowRoot[]) {
  visibilityObserver().report({ isVisible: true, isIntersecting: true })
  await vi.waitFor(() => expect(loginButton(roots).disabled).toBe(false))
}

function baseOptions() {
  return {
    onFillRequest: vi.fn(),
    onConnectionCheck: vi.fn(),
    onOpenDesktop: vi.fn(),
    onFillIdentityRequest: vi.fn(),
    onFillCardRequest: vi.fn(),
    onFillOneTimeCodeRequest: vi.fn(),
  }
}

describe('the inline control after a lookalike fill result', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    overlayHost()?.remove()
    document.body.innerHTML = ''
    stubVisibilityObserver()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the warning in the status line without adding an action', async () => {
    const roots = captureShadow()
    const onFillRequest = vi.fn().mockResolvedValue({
      state: 'unavailable',
      code: 'lookalike-domain',
      lookalike: 'apple.example',
    })
    document.body.innerHTML = '<input type="text" autocomplete="username" /><input type="password" />'
    giveInputsLayout()
    const detach = attachInlineButton({ ...baseOptions(), onFillRequest })
    focusFirstInput()
    await armRelease(roots)
    loginButton(roots).click()
    await vi.waitFor(() => expect(statusText(roots)).toBe(WARNING))
    expect(onFillRequest).toHaveBeenCalledTimes(1)
    expect(visibleLabels(roots)).toContain('Fill with Sesame')
    expect(visibleLabels(roots)).not.toContain('Fill anyway')
    expect(visibleLabels(roots)).not.toContain('Retry')
    for (const root of roots) expect(root.querySelector('.status button')).toBeNull()
    detach()
  })

  it('keeps markup characters in the host as text, never as markup', async () => {
    const roots = captureShadow()
    const onFillRequest = vi.fn().mockResolvedValue({
      state: 'unavailable',
      code: 'lookalike-domain',
      lookalike: 'apple.example<b>sign in</b>',
    })
    document.body.innerHTML = '<input type="text" autocomplete="username" /><input type="password" />'
    giveInputsLayout()
    const detach = attachInlineButton({ ...baseOptions(), onFillRequest })
    focusFirstInput()
    await armRelease(roots)
    loginButton(roots).click()
    await vi.waitFor(() => expect(statusText(roots)).toContain('<b>sign in</b>'))
    for (const root of roots) expect(root.querySelector('b')).toBeNull()
    detach()
  })

  it('keeps the ordinary no-match copy and shows no warning', async () => {
    const roots = captureShadow()
    const onFillRequest = vi.fn().mockResolvedValue({ state: 'unavailable', code: 'no-match' })
    document.body.innerHTML = '<input type="text" autocomplete="username" /><input type="password" />'
    giveInputsLayout()
    const detach = attachInlineButton({ ...baseOptions(), onFillRequest })
    focusFirstInput()
    await armRelease(roots)
    loginButton(roots).click()
    await vi.waitFor(() => expect(statusText(roots)).toBe('No saved login matches this site.'))
    expect(statusText(roots)).not.toMatch(/looks like/)
    detach()
  })
})
