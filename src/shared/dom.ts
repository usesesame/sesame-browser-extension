export interface VisibleInputOptions {
  excludePassword?: boolean
  rejectAriaHiddenAncestor?: boolean
  minimumSize?: number
}

export function isVisibleInput(input: HTMLInputElement, options: VisibleInputOptions = {}): boolean {
  if (input.disabled || input.readOnly || input.type === 'hidden') return false
  if (options.excludePassword && input.type === 'password') return false
  if (options.rejectAriaHiddenAncestor && input.closest('[aria-hidden="true"]')) return false
  return isVisibleElement(input, options.minimumSize)
}

export function isVisibleElement(element: HTMLElement, minimumSize = 0): boolean {
  const style = getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false
  const opacity = Number.parseFloat(style.opacity)
  if (Number.isFinite(opacity) && opacity === 0) return false
  const bounds = element.getBoundingClientRect()
  return bounds.width > minimumSize && bounds.height > minimumSize
}
