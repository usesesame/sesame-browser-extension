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
const VISIBILITY_ATTRIBUTES = ['class', 'style', 'hidden', 'open', 'popover']
const FRESH_READING_TIMEOUT_MS = 1000

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
  confirmFresh(): Promise<boolean>
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

function mutationInsideHost(record: MutationRecord, host: Element): boolean {
  if (record.target === host || host.contains(record.target)) return true
  const root = record.target.getRootNode()
  return root instanceof ShadowRoot && root.host === host
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
  let mutationObserver: MutationObserver | null = null
  let observed: Element | null = null
  let supported = false
  let lastVisible = false
  let confirmed = false
  let readingPending = false
  let holdTimer: ReturnType<typeof setTimeout> | undefined
  let freshWaiters: Array<(visible: boolean) => void> = []

  function settleFresh(visible: boolean) {
    const waiters = freshWaiters
    freshWaiters = []
    for (const settle of waiters) settle(visible)
  }

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
    readingPending = false
    const entry = entries[entries.length - 1]
    if (!entry) return
    if (entry.isVisible === undefined) {
      settleFresh(false)
      if (!supported) return
      supported = false
      disarm()
      onChange()
      return
    }
    lastVisible = entry.isVisible === true && entry.isIntersecting === true
    if (!lastVisible) {
      settleFresh(false)
      disarm()
      onChange()
      return
    }
    settleFresh(openNow())
    if (!confirmed) hold()
  }

  function requestReading() {
    if (!observer || !observed || readingPending) return
    readingPending = true
    observer.unobserve(observed)
    observer.observe(observed)
  }

  function flushPendingEntries() {
    if (!observer || typeof observer.takeRecords !== 'function') return
    let entries: IntersectionObserverEntry[]
    try {
      entries = observer.takeRecords()
    } catch {
      return
    }
    if (entries.length > 0) onEntries(entries)
  }

  function invalidate() {
    lastVisible = false
    disarm()
    requestReading()
  }

  function onMutations(records: MutationRecord[]) {
    const host = observed
    if (!host) return
    if (records.some((record) => !mutationInsideHost(record, host))) invalidate()
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
      mutationObserver = new MutationObserver(onMutations)
      mutationObserver.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: VISIBILITY_ATTRIBUTES,
      })
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
      flushPendingEntries()
      if (!openNow()) return false
      if (event.type !== 'click' || event.isTrusted !== true) return false
      if (!observed || chainUnsafeForRelease(observed)) return false
      const bounds = event.detail === 0 ? observed.getBoundingClientRect() : null
      const pointX = bounds ? bounds.left + bounds.width / 2 : event.clientX
      const pointY = bounds ? bounds.top + bounds.height / 2 : event.clientY
      let hit: Element | null = null
      try {
        hit = document.elementFromPoint(pointX, pointY)
      } catch {
        return false
      }
      return hit !== null && (hit === observed || observed.contains(hit))
    },
    confirmFresh() {
      if (!observer || !observed || !openNow()) return Promise.resolve(false)
      const target = observed
      const reading = observer
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          freshWaiters = freshWaiters.filter((waiter) => waiter !== settle)
          resolve(false)
        }, FRESH_READING_TIMEOUT_MS)
        const settle = (visible: boolean) => {
          clearTimeout(timer)
          resolve(visible && observed === target && !chainUnsafeForRelease(target))
        }
        freshWaiters.push(settle)
        readingPending = true
        reading.unobserve(target)
        reading.observe(target)
      })
    },
    invalidate,
    destroy() {
      settleFresh(false)
      clearHold()
      observer?.disconnect()
      observer = null
      mutationObserver?.disconnect()
      mutationObserver = null
      observed = null
      supported = false
      confirmed = false
      lastVisible = false
      readingPending = false
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
