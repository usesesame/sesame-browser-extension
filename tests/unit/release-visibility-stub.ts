import { vi } from 'vitest'

export interface StubVisibilityEntry {
  isVisible?: boolean
  isIntersecting: boolean
}

export class StubVisibilityObserver {
  static instances: StubVisibilityObserver[] = []

  readonly options: IntersectionObserverInit | undefined
  readonly observed: Element[] = []
  readonly unobserved: Element[] = []
  reading: StubVisibilityEntry = { isVisible: true, isIntersecting: true }
  private readonly callback: IntersectionObserverCallback
  private readonly active = new Set<Element>()
  private readonly queued: IntersectionObserverEntry[] = []

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback
    this.options = options
    StubVisibilityObserver.instances.push(this)
  }

  observe(target: Element) {
    const forced = !this.active.has(target) && this.observed.includes(target)
    this.active.add(target)
    this.observed.push(target)
    if (!forced) return
    queueMicrotask(() => this.report(this.reading))
  }

  unobserve(target: Element) {
    this.unobserved.push(target)
    this.active.delete(target)
  }

  disconnect() {
    this.active.clear()
  }

  takeRecords(): IntersectionObserverEntry[] {
    return this.queued.splice(0)
  }

  queue(entry: StubVisibilityEntry) {
    this.queued.push(entry as unknown as IntersectionObserverEntry)
  }

  report(entry: StubVisibilityEntry) {
    this.callback([entry as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

export function stubVisibilityObserver(): void {
  StubVisibilityObserver.instances = []
  vi.stubGlobal('IntersectionObserver', StubVisibilityObserver)
  const documentPrototype = Object.getPrototypeOf(document) as {
    elementFromPoint: (x: number, y: number) => Element | null
  }
  documentPrototype.elementFromPoint = function elementFromPoint() {
    const observer = StubVisibilityObserver.instances[StubVisibilityObserver.instances.length - 1]
    return observer?.observed[observer.observed.length - 1] ?? null
  }
}

export function trustedClick(element: Element, init: MouseEventInit = {}): void {
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    composed: true,
    detail: 1,
    clientX: 40,
    clientY: 30,
    ...init,
  })
  Object.defineProperty(event, 'isTrusted', { value: true })
  element.dispatchEvent(event)
}

export function visibilityObserver(): StubVisibilityObserver {
  const observer = StubVisibilityObserver.instances[StubVisibilityObserver.instances.length - 1]
  if (!observer) throw new Error('no visibility observer was created')
  return observer
}
