// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachInlineButton, overlayHost } from '../../src/content/overlay'
import { stubVisibilityObserver, trustedClick, visibilityObserver } from './release-visibility-stub'

beforeEach(() => {
  stubVisibilityObserver()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function buttonIn(roots: ShadowRoot[], label: string): HTMLButtonElement {
  return roots.flatMap((root) => [...root.querySelectorAll('button')])
    .find((button) => button.textContent === label) as HTMLButtonElement
}

async function armRelease(roots: ShadowRoot[], label: string) {
  visibilityObserver().report({ isVisible: true, isIntersecting: true })
  await vi.waitFor(() => expect(buttonIn(roots, label).disabled).toBe(false))
}

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

function focusFirstInput() {
  document.querySelector('input')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
}

describe('the inline control on a payment field', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    overlayHost()?.remove()
    document.body.innerHTML = ''
  })

  it('offers to fill a card on a checkout field', () => {
    const roots = captureShadow()
    document.body.innerHTML = '<input autocomplete="cc-number" />'
    giveInputsLayout()
    const detach = attachInlineButton(baseOptions())
    focusFirstInput()
    const labels = visibleLabels(roots)
    expect(labels).toContain('Fill card')
    expect(labels).not.toContain('Fill with Sesame')
    detach()
  })

  it('still offers the card on a page that also has a sign-in form', () => {
    const roots = captureShadow()
    document.body.innerHTML = '<input type="text" autocomplete="username" /><input type="password" /><input autocomplete="cc-number" />'
    giveInputsLayout()
    const detach = attachInlineButton(baseOptions())
    document.querySelectorAll('input')[2].dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(visibleLabels(roots)).toContain('Fill card')
    detach()
  })

  it('leaves a sign-in field to the sign-in controls', () => {
    const roots = captureShadow()
    document.body.innerHTML = '<input type="text" autocomplete="username" /><input type="password" />'
    giveInputsLayout()
    const detach = attachInlineButton(baseOptions())
    focusFirstInput()
    const labels = visibleLabels(roots)
    expect(labels.length).toBeGreaterThan(0)
    expect(labels).not.toContain('Fill card')
    detach()
  })

  it('asks the background to fill the card when the control is used', async () => {
    const roots = captureShadow()
    const onFillCardRequest = vi.fn().mockResolvedValue({ ok: true, filledFields: ['number'] })
    document.body.innerHTML = '<input autocomplete="cc-number" />'
    giveInputsLayout()
    const detach = attachInlineButton({ ...baseOptions(), onFillCardRequest })
    focusFirstInput()
    await armRelease(roots, 'Fill card')
    const button = roots.flatMap((root) => [...root.querySelectorAll('button')])
      .find((candidate) => candidate.textContent === 'Fill card')!
    trustedClick(button)
    await vi.waitFor(() => expect(onFillCardRequest).toHaveBeenCalledTimes(1))
    detach()
  })
})

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

describe('the inline control on a one-time code field', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    overlayHost()?.remove()
    document.body.innerHTML = ''
  })

  it('offers to fill the code on a single field', () => {
    const roots = captureShadow()
    document.body.innerHTML = '<input autocomplete="one-time-code" />'
    giveInputsLayout()
    const detach = attachInlineButton(baseOptions())
    focusFirstInput()
    const labels = visibleLabels(roots)
    expect(labels).toContain('Fill code')
    expect(labels).not.toContain('Fill with Sesame')
    expect(labels).not.toContain('Fill card')
    detach()
  })

  it('offers the code on any box of a split group', () => {
    const roots = captureShadow()
    document.body.innerHTML = `<form>${'<input maxlength="1" />'.repeat(6)}</form>`
    giveInputsLayout()
    const detach = attachInlineButton(baseOptions())
    document.querySelectorAll('input')[3].dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(visibleLabels(roots)).toContain('Fill code')
    detach()
  })

  it('asks the background for a code and reports the remaining window', async () => {
    const roots = captureShadow()
    const onFillOneTimeCodeRequest = vi.fn().mockResolvedValue({ ok: true, remainingSeconds: 18 })
    document.body.innerHTML = '<input autocomplete="one-time-code" />'
    giveInputsLayout()
    const detach = attachInlineButton({ ...baseOptions(), onFillOneTimeCodeRequest })
    focusFirstInput()
    await armRelease(roots, 'Fill code')
    const button = roots.flatMap((root) => [...root.querySelectorAll('button')])
      .find((candidate) => candidate.textContent === 'Fill code')!
    trustedClick(button)
    await vi.waitFor(() => expect(onFillOneTimeCodeRequest).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => {
      expect(roots.flatMap((root) => [...root.querySelectorAll('.status')]).map((node) => node.textContent))
        .toContain('Code filled. About 18 seconds remain.')
    })
    expect(visibleLabels(roots)).not.toContain('Copy password')
    detach()
  })

  it('shows an existing failure message when the desktop is unavailable', async () => {
    const roots = captureShadow()
    const onFillOneTimeCodeRequest = vi.fn().mockResolvedValue({ ok: false, code: 'desktop-unavailable' })
    document.body.innerHTML = '<input autocomplete="one-time-code" />'
    giveInputsLayout()
    const detach = attachInlineButton({ ...baseOptions(), onFillOneTimeCodeRequest })
    focusFirstInput()
    await armRelease(roots, 'Fill code')
    const button = roots.flatMap((root) => [...root.querySelectorAll('button')])
      .find((candidate) => candidate.textContent === 'Fill code')!
    trustedClick(button)
    await vi.waitFor(() => {
      expect(roots.flatMap((root) => [...root.querySelectorAll('.status')]).map((node) => node.textContent))
        .toContain('Open Sesame, then try again.')
    })
    detach()
  })
})

describe('the card control matches the login control', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    overlayHost()?.remove()
    document.body.innerHTML = ''
  })

  it('wears the primary treatment, not the secondary one', () => {
    const roots = captureShadow()
    document.body.innerHTML = '<input autocomplete="cc-number" />'
    giveInputsLayout()
    const detach = attachInlineButton(baseOptions())
    focusFirstInput()
    const card = roots.flatMap((root) => [...root.querySelectorAll('button')])
      .find((button) => button.textContent === 'Fill card')!
    const login = roots.flatMap((root) => [...root.querySelectorAll('button')])
      .find((button) => button.textContent === 'Fill with Sesame')!
    expect(card.className).toBe(login.className)
    expect(card.className).not.toContain('identity')
    detach()
  })
})

describe('re-injecting the content script', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    overlayHost()?.remove()
    document.body.innerHTML = ''
  })

  function hostCount(): number {
    const id = overlayHost()?.id
    return id ? document.querySelectorAll(`#${id}`).length : 0
  }

  it('leaves one overlay in the page, not one per injection', () => {
    document.body.innerHTML = '<input autocomplete="cc-number" />'
    giveInputsLayout()
    const first = attachInlineButton(baseOptions())
    focusFirstInput()
    expect(hostCount()).toBe(1)

    const second = attachInlineButton(baseOptions())
    focusFirstInput()
    expect(hostCount()).toBe(1)

    second()
    first()
  })
})
