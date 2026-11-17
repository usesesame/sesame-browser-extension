import { vi } from 'vitest'

export function giveInputsLayout() {
  for (const input of document.querySelectorAll('input')) {
    input.setAttribute('style', 'opacity:1;display:block;visibility:visible')
    input.getBoundingClientRect = () => ({ width: 180, height: 32, top: 10, left: 10, bottom: 42, right: 190, x: 10, y: 10, toJSON: () => ({}) }) as DOMRect
  }
}

export function captureShadow(): ShadowRoot[] {
  const roots: ShadowRoot[] = []
  const original = Element.prototype.attachShadow
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
    const root = original.call(this, { ...init, mode: 'open' })
    roots.push(root)
    return root
  })
  return roots
}
