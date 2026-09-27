// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachInlineButton, overlayHost } from '../../src/content/overlay'

function layout(input: HTMLInputElement): void {
  input.getBoundingClientRect = () => ({
    width: 200, height: 30, top: 0, left: 0, right: 200, bottom: 30, x: 0, y: 0, toJSON: () => ({}),
  }) as DOMRect
}

function openShadowRoot(parent: ParentNode): ShadowRoot {
  const host = document.createElement('div')
  parent.append(host)
  return host.attachShadow({ mode: 'open' })
}

function addLoginForm(root: ShadowRoot): { password: HTMLInputElement } {
  const form = document.createElement('form')
  const username = document.createElement('input')
  username.type = 'email'
  username.autocomplete = 'username'
  const password = document.createElement('input')
  password.type = 'password'
  password.autocomplete = 'current-password'
  form.append(username, password)
  root.append(form)
  layout(username)
  layout(password)
  return { password }
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
    onFillOneTimeCodeRequest: vi.fn(),
  }
}

beforeEach(() => {
  vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible', opacity: '1' }))
  overlayHost()?.remove()
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the inline control follows open shadow roots', () => {
  it('shows the control for a password field inside nested shadow roots', () => {
    const roots = captureShadow()
    const second = openShadowRoot(openShadowRoot(document.body))
    const { password } = addLoginForm(second)

    const detach = attachInlineButton(baseOptions())
    password.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }))

    const labels = roots.flatMap((root) => [...root.querySelectorAll('button')])
      .filter((button) => !button.hidden)
      .map((button) => button.textContent ?? '')
    expect(labels).toContain('Fill with Sesame')
    detach()
  })

  it('hides when the focused shadow field is disabled', async () => {
    captureShadow()
    const root = openShadowRoot(document.body)
    const { password } = addLoginForm(root)

    const detach = attachInlineButton(baseOptions())
    password.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }))
    expect(overlayHost()?.style.display).toBe('block')

    password.disabled = true
    await vi.waitFor(() => expect(overlayHost()?.style.display).toBe('none'))
    detach()
  })
})
