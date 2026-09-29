// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachInlineButton, overlayHost } from '../../src/content/overlay'
import { stubVisibilityObserver, trustedClick, visibilityObserver } from './release-visibility-stub'

function giveInputsLayout() {
  for (const input of document.querySelectorAll('input')) {
    input.setAttribute('style', 'opacity:1;display:block;visibility:visible')
    input.getBoundingClientRect = () => ({
      width: 180, height: 32, top: 10, left: 10, bottom: 42, right: 190, x: 10, y: 10, toJSON: () => ({}),
    }) as DOMRect
  }
}

function giveHostCenterLayout(): HTMLElement {
  const host = overlayHost()
  if (!host) throw new Error('no overlay host')
  host.getBoundingClientRect = () => ({
    width: 120, height: 30, top: 200, left: 100, bottom: 230, right: 220, x: 100, y: 200, toJSON: () => ({}),
  }) as DOMRect
  return host
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

function focusFirstInput() {
  document.querySelector('input')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
}

function buttonIn(roots: ShadowRoot[], label: string): HTMLButtonElement {
  return roots.flatMap((root) => [...root.querySelectorAll('button')])
    .find((button) => button.textContent === label) as HTMLButtonElement
}

function styleText(roots: ShadowRoot[]): string {
  return roots.flatMap((root) => [...root.querySelectorAll('style')])
    .map((style) => style.textContent ?? '')
    .join('')
}

function statusText(roots: ShadowRoot[]): string {
  return roots.flatMap((root) => [...root.querySelectorAll('.status')])
    .map((node) => node.textContent ?? '')
    .join('')
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

function openLogin() {
  const roots = captureShadow()
  document.body.innerHTML = '<input type="text" autocomplete="username" /><input type="password" />'
  giveInputsLayout()
  const onFillRequest = vi.fn().mockResolvedValue({ state: 'filled', matchKind: 'exact' })
  const detach = attachInlineButton({ ...baseOptions(), onFillRequest })
  focusFirstInput()
  return { roots, onFillRequest, detach }
}

async function settle(ms = 150) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

describe('the inline release gate', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    overlayHost()?.remove()
    document.body.innerHTML = ''
    stubVisibilityObserver()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('tracks v2 visibility with a delay of at least 100 ms', () => {
    const { detach } = openLogin()
    const observer = visibilityObserver()
    expect(observer.options?.trackVisibility).toBe(true)
    expect(observer.options?.delay ?? 0).toBeGreaterThanOrEqual(100)
    expect(observer.observed).toContain(overlayHost())
    detach()
  })

  it('keeps the closed shadow host opaque with the token styles', () => {
    const { roots, detach } = openLogin()
    const css = styleText(roots)
    expect(css).toMatch(/:host\s*\{[^}]*all:\s*initial/)
    expect(css).toMatch(/:host\s*\{[^}]*opacity:\s*1\s*!important/)
    detach()
  })

  it('does not arm the release control while the overlay is not visible', async () => {
    const { roots, onFillRequest, detach } = openLogin()
    const button = buttonIn(roots, 'Fill with Sesame')
    expect(button.disabled).toBe(true)
    visibilityObserver().report({ isVisible: false, isIntersecting: true })
    await settle()
    expect(button.disabled).toBe(true)
    button.click()
    await settle(0)
    expect(onFillRequest).not.toHaveBeenCalled()
    detach()
  })

  it('drops an unconfirmed reading when the overlay stops being visible', async () => {
    const { roots, onFillRequest, detach } = openLogin()
    const button = buttonIn(roots, 'Fill with Sesame')
    visibilityObserver().report({ isVisible: true, isIntersecting: true })
    visibilityObserver().report({ isVisible: false, isIntersecting: true })
    await settle()
    expect(button.disabled).toBe(true)
    button.click()
    await settle(0)
    expect(onFillRequest).not.toHaveBeenCalled()
    detach()
  })

  it('arms only after visibility holds, then releases one request', async () => {
    const { roots, onFillRequest, detach } = openLogin()
    const button = buttonIn(roots, 'Fill with Sesame')
    visibilityObserver().report({ isVisible: true, isIntersecting: true })
    expect(button.disabled).toBe(true)
    await vi.waitFor(() => expect(button.disabled).toBe(false))
    trustedClick(button)
    await vi.waitFor(() => expect(onFillRequest).toHaveBeenCalledTimes(1))
    detach()
  })

  it('refuses release while a competing top layer element is open', async () => {
    const { roots, onFillRequest, detach } = openLogin()
    const button = buttonIn(roots, 'Fill with Sesame')
    visibilityObserver().report({ isVisible: true, isIntersecting: true })
    await vi.waitFor(() => expect(button.disabled).toBe(false))

    const popover = document.createElement('div')
    popover.setAttribute('popover', 'manual')
    document.body.append(popover)
    const originalMatches = Element.prototype.matches
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
      return selector === ':popover-open' ? this === popover : originalMatches.call(this, selector)
    })
    popover.dispatchEvent(new Event('toggle'))

    await vi.waitFor(() => expect(button.disabled).toBe(true))
    button.click()
    await settle(0)
    expect(onFillRequest).not.toHaveBeenCalled()

    popover.remove()
    document.body.dispatchEvent(new Event('toggle'))
    await vi.waitFor(() => expect(button.disabled).toBe(false))
    trustedClick(button)
    await vi.waitFor(() => expect(onFillRequest).toHaveBeenCalledTimes(1))
    detach()
  })

  it('fails closed when track visibility is unavailable', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const roots = captureShadow()
    document.body.innerHTML = '<input type="text" autocomplete="username" /><input type="password" />'
    giveInputsLayout()
    const onFillRequest = vi.fn()
    const detach = attachInlineButton({ ...baseOptions(), onFillRequest })
    focusFirstInput()
    const button = buttonIn(roots, 'Fill with Sesame')
    expect(button.disabled).toBe(true)
    button.click()
    await settle(0)
    expect(onFillRequest).not.toHaveBeenCalled()
    expect(statusText(roots)).toContain('Use the Sesame popup to fill.')
    detach()
  })

  it('fails closed when the observer omits the visibility field', async () => {
    const { roots, onFillRequest, detach } = openLogin()
    const button = buttonIn(roots, 'Fill with Sesame')
    visibilityObserver().report({ isIntersecting: true })
    await vi.waitFor(() => expect(button.disabled).toBe(true))
    expect(statusText(roots)).toContain('Use the Sesame popup to fill.')
    button.click()
    await settle(0)
    expect(onFillRequest).not.toHaveBeenCalled()
    detach()
  })

  it('refuses release when the host turns transparent after confirmation', async () => {
    const { roots, onFillRequest, detach } = openLogin()
    const button = buttonIn(roots, 'Fill with Sesame')
    visibilityObserver().report({ isVisible: true, isIntersecting: true })
    await vi.waitFor(() => expect(button.disabled).toBe(false))

    overlayHost()!.style.setProperty('opacity', '0', 'important')
    trustedClick(button)
    await settle(0)

    expect(onFillRequest).not.toHaveBeenCalled()
    expect(statusText(roots)).toContain('cannot confirm this control is visible')
    expect(button.disabled).toBe(true)
    detach()
  })

  it('refuses release when pointer events turn off after confirmation', async () => {
    const { roots, onFillRequest, detach } = openLogin()
    const button = buttonIn(roots, 'Fill with Sesame')
    visibilityObserver().report({ isVisible: true, isIntersecting: true })
    await vi.waitFor(() => expect(button.disabled).toBe(false))

    overlayHost()!.style.pointerEvents = 'none'
    trustedClick(button)
    await settle(0)

    expect(onFillRequest).not.toHaveBeenCalled()
    expect(statusText(roots)).toContain('cannot confirm this control is visible')
    detach()
  })

  it('refuses an untrusted click while the gate is open', async () => {
    const { roots, onFillRequest, detach } = openLogin()
    const button = buttonIn(roots, 'Fill with Sesame')
    visibilityObserver().report({ isVisible: true, isIntersecting: true })
    await vi.waitFor(() => expect(button.disabled).toBe(false))

    button.click()
    await settle(0)

    expect(onFillRequest).not.toHaveBeenCalled()
    detach()
  })

  it('refuses release when the pointer hit test lands on another element', async () => {
    const { roots, onFillRequest, detach } = openLogin()
    const button = buttonIn(roots, 'Fill with Sesame')
    visibilityObserver().report({ isVisible: true, isIntersecting: true })
    await vi.waitFor(() => expect(button.disabled).toBe(false))

    const decoy = document.createElement('div')
    document.body.append(decoy)
    const hitTest = vi.spyOn(document, 'elementFromPoint').mockReturnValue(decoy)
    trustedClick(button)
    await settle(0)

    expect(onFillRequest).not.toHaveBeenCalled()
    hitTest.mockRestore()
    detach()
  })

  it('releases a trusted keyboard click at the host center', async () => {
    const { roots, onFillRequest, detach } = openLogin()
    const button = buttonIn(roots, 'Fill with Sesame')
    visibilityObserver().report({ isVisible: true, isIntersecting: true })
    await vi.waitFor(() => expect(button.disabled).toBe(false))

    const host = giveHostCenterLayout()
    const hitPoints: Array<{ x: number; y: number }> = []
    const hitTest = vi.spyOn(document, 'elementFromPoint').mockImplementation((x, y) => {
      hitPoints.push({ x, y })
      return host
    })
    trustedClick(button, { detail: 0, clientX: 0, clientY: 0 })

    await vi.waitFor(() => expect(onFillRequest).toHaveBeenCalledTimes(1))
    expect(hitPoints).toEqual([{ x: 160, y: 215 }])
    hitTest.mockRestore()
    detach()
  })

  it('refuses a trusted keyboard click when a decoy covers the host center', async () => {
    const { roots, onFillRequest, detach } = openLogin()
    const button = buttonIn(roots, 'Fill with Sesame')
    visibilityObserver().report({ isVisible: true, isIntersecting: true })
    await vi.waitFor(() => expect(button.disabled).toBe(false))

    const host = giveHostCenterLayout()
    const decoy = document.createElement('div')
    document.body.append(decoy)
    const hitTest = vi.spyOn(document, 'elementFromPoint').mockImplementation((x, y) =>
      x === 160 && y === 215 ? decoy : host,
    )
    trustedClick(button, { detail: 0, clientX: 0, clientY: 0 })
    await settle(0)

    expect(onFillRequest).not.toHaveBeenCalled()
    expect(statusText(roots)).toContain('cannot confirm this control is visible')
    hitTest.mockRestore()
    detach()
  })

  it('requires a fresh reading after a failed click check', async () => {
    const { roots, onFillRequest, detach } = openLogin()
    const button = buttonIn(roots, 'Fill with Sesame')
    visibilityObserver().report({ isVisible: true, isIntersecting: true })
    await vi.waitFor(() => expect(button.disabled).toBe(false))

    overlayHost()!.style.setProperty('opacity', '0', 'important')
    trustedClick(button)
    await settle(0)
    expect(button.disabled).toBe(true)

    overlayHost()!.style.removeProperty('opacity')
    await settle(150)
    expect(button.disabled).toBe(true)

    visibilityObserver().report({ isVisible: true, isIntersecting: true })
    await vi.waitFor(() => expect(button.disabled).toBe(false))
    trustedClick(button)
    await vi.waitFor(() => expect(onFillRequest).toHaveBeenCalledTimes(1))
    detach()
  })

  it('applies the same check to copy password', async () => {
    const roots = captureShadow()
    document.body.innerHTML =
      '<input type="password" name="new_password" /><input type="password" name="confirm_password" />'
    giveInputsLayout()
    const detach = attachInlineButton(baseOptions())
    focusFirstInput()
    const create = buttonIn(roots, 'Create password with Sesame')
    visibilityObserver().report({ isVisible: true, isIntersecting: true })
    await vi.waitFor(() => expect(create.disabled).toBe(false))
    trustedClick(create)
    const copy = buttonIn(roots, 'Copy password')
    await vi.waitFor(() => expect(copy.hidden).toBe(false))
    await vi.waitFor(() => expect(copy.disabled).toBe(false))

    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    overlayHost()!.style.setProperty('opacity', '0', 'important')
    trustedClick(copy)
    await settle(0)

    expect(writeText).not.toHaveBeenCalled()
    expect(statusText(roots)).toContain('cannot confirm this control is visible')
    detach()
  })

  it('re-arms only after a fresh reading once the overlay was hidden and shown', async () => {
    const roots = captureShadow()
    document.body.innerHTML =
      '<input type="text" autocomplete="username" /><input type="password" />'
    giveInputsLayout()
    const onFillRequest = vi.fn().mockResolvedValue({ state: 'filled', matchKind: 'exact' })
    const detach = attachInlineButton({ ...baseOptions(), onFillRequest })
    focusFirstInput()
    const button = buttonIn(roots, 'Fill with Sesame')
    visibilityObserver().report({ isVisible: true, isIntersecting: true })
    await vi.waitFor(() => expect(button.disabled).toBe(false))

    const dismiss = roots.flatMap((root) => [...root.querySelectorAll('button')])
      .find((candidate) => candidate.title === 'Dismiss') as HTMLButtonElement
    dismiss.click()
    await settle(0)
    document.querySelectorAll('input')[1].dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    await vi.waitFor(() => expect(overlayHost()?.style.display).toBe('block'))
    await settle(150)

    expect(button.disabled).toBe(true)
    trustedClick(button)
    await settle(0)
    expect(onFillRequest).not.toHaveBeenCalled()

    visibilityObserver().report({ isVisible: true, isIntersecting: true })
    await vi.waitFor(() => expect(button.disabled).toBe(false))
    trustedClick(button)
    await settle(0)
    await vi.waitFor(() => expect(onFillRequest).toHaveBeenCalledTimes(1))
    detach()
  })
})
