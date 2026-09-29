import { vi } from 'vitest'

export interface StubVisibilityEntry {
  isVisible?: boolean
  isIntersecting: boolean
}

export class StubVisibilityObserver {
  static instances: StubVisibilityObserver[] = []

  readonly options: IntersectionObserverInit | undefined
  readonly observed: Element[] = []
  private readonly callback: IntersectionObserverCallback

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback
    this.options = options
    StubVisibilityObserver.instances.push(this)
  }

  observe(target: Element) {
    this.observed.push(target)
  }

  unobserve() {}

  disconnect() {}

  takeRecords(): IntersectionObserverEntry[] {
    return []
  }

  report(entry: StubVisibilityEntry) {
    this.callback(
      [entry as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
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
