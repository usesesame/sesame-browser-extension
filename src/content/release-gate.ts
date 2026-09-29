declare global {
  interface IntersectionObserverInit {
    trackVisibility?: boolean
    delay?: number
  }
  interface IntersectionObserverEntry {
    readonly isVisible?: boolean
  }
}

const OBSERVER_DELAY_MS = 100
const VISIBLE_HOLD_MS = 100

export const RELEASE_BLOCKED_MESSAGE =
  'Sesame cannot confirm this control is visible. Close anything covering the page and try again.'

export const RELEASE_UNSUPPORTED_MESSAGE =
  'This browser cannot verify the control is visible. Use the Sesame popup to fill.'

export interface ReleaseGate {
  readonly supported: boolean
  observe(target: Element): void
  rearm(): void
  isOpen(): boolean
  allowsClick(event: MouseEvent): boolean
  invalidate(): void
  destroy(): void
}

function styleUnsafeForRelease(style: CSSStyleDeclaration): boolean {
  if (style.display === 'none') return true
  if (style.visibility !== '' && style.visibility !== 'visible') return true
  if (style.opacity !== '') {
    const opacity = Number.parseFloat(style.opacity)
    if (Number.isNaN(opacity) || opacity <= 0) return true
  }
  if (style.filter !== '' && style.filter !== 'none') return true
  if (style.transform !== '' && style.transform !== 'none') return true
  return style.pointerEvents === 'none'
}

function chainUnsafeForRelease(element: Element): boolean {
  let node: Element | null = element
  while (node) {
    if (styleUnsafeForRelease(getComputedStyle(node))) return true
    node = node.parentElement
  }
  return false
}

export function topLayerElementOpen(documentRef: Document = document): boolean {
  if (documentRef.fullscreenElement) return true
  for (const candidate of documentRef.querySelectorAll('[popover], dialog[open]')) {
    if (selectorState(candidate, ':popover-open') !== 'no') return true
    if (candidate.tagName !== 'DIALOG') continue
    if (selectorState(candidate, ':modal') !== 'no') return true
  }
  return false
}

export function createReleaseGate(onChange: () => void): ReleaseGate {
  let observer: IntersectionObserver | null = null
  let observed: Element | null = null
  let supported = false
  let lastVisible = false
  let confirmed = false
  let holdTimer: ReturnType<typeof setTimeout> | undefined

  function clearHold() {
    if (holdTimer === undefined) return
    clearTimeout(holdTimer)
    holdTimer = undefined
  }

  function disarm() {
    clearHold()
    if (!confirmed) return
    confirmed = false
    onChange()
  }

  function hold() {
    clearHold()
    holdTimer = setTimeout(() => {
      holdTimer = undefined
      if (!lastVisible) return
      if (document.visibilityState !== 'visible') return
      if (topLayerElementOpen()) return
      confirmed = true
      onChange()
    }, VISIBLE_HOLD_MS)
  }

  function onEntries(entries: IntersectionObserverEntry[]) {
    const entry = entries[entries.length - 1]
    if (!entry) return
    if (entry.isVisible === undefined) {
      if (!supported) return
      supported = false
      disarm()
      onChange()
      return
    }
    lastVisible = entry.isVisible === true && entry.isIntersecting === true
    if (!lastVisible) {
      disarm()
      onChange()
      return
    }
    if (!confirmed) hold()
  }

  function onLayerChange() {
    disarm()
    if (lastVisible) hold()
  }

  function openNow(): boolean {
    return (
      supported &&
      confirmed &&
      document.visibilityState === 'visible' &&
      !topLayerElementOpen()
    )
  }

  return {
    get supported() {
      return supported
    },
    observe(element: Element) {
      if (observed) return
      observed = element
      try {
        observer = new IntersectionObserver(onEntries, {
          trackVisibility: true,
          delay: OBSERVER_DELAY_MS,
          threshold: 0,
        })
      } catch {
        observer = null
        onChange()
        return
      }
      supported = true
      observer.observe(element)
      document.addEventListener('toggle', onLayerChange, true)
      document.addEventListener('fullscreenchange', onLayerChange, true)
      document.addEventListener('visibilitychange', onLayerChange, true)
      onChange()
    },
    rearm() {
      disarm()
      if (observed && chainUnsafeForRelease(observed)) {
        lastVisible = false
        return
      }
      if (supported && lastVisible) hold()
    },
    isOpen() {
      return openNow()
    },
    allowsClick(event: MouseEvent) {
      if (!openNow()) return false
      if (event.type !== 'click' || event.isTrusted !== true) return false
      if (!observed || chainUnsafeForRelease(observed)) return false
      let hit: Element | null = null
      try {
        hit = document.elementFromPoint(event.clientX, event.clientY)
      } catch {
        return false
      }
      return hit !== null && (hit === observed || observed.contains(hit))
    },
    invalidate() {
      lastVisible = false
      disarm()
    },
    destroy() {
      clearHold()
      observer?.disconnect()
      observer = null
      observed = null
      supported = false
      confirmed = false
      lastVisible = false
      document.removeEventListener('toggle', onLayerChange, true)
      document.removeEventListener('fullscreenchange', onLayerChange, true)
      document.removeEventListener('visibilitychange', onLayerChange, true)
    },
  }
}

function selectorState(element: Element, selector: string): 'yes' | 'no' | 'unknown' {
  try {
    return element.matches(selector) ? 'yes' : 'no'
  } catch {
    return 'unknown'
  }
}
