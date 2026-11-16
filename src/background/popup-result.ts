import type { PublicFillResult } from './fill-result'

export interface PopupResultPort {
  postMessage(message: unknown): void
  onDisconnect: { addListener(callback: () => void): void }
}

export interface PopupResultDeps {
  queryActiveTab(): Promise<{ id?: number; url?: string } | undefined>
  tabOrigin(tabId: number): Promise<string | null>
  pageOrigin(url: string | undefined): string | null
  showStatus(tabId: number, result: PublicFillResult): Promise<unknown>
}

export type PopupResultDelivery = 'popup' | 'page' | 'dropped'

export function createPopupResultRelay(port: PopupResultPort, deps: PopupResultDeps) {
  let popupOpen = true
  port.onDisconnect.addListener(() => { popupOpen = false })
  const fillPage = deps.queryActiveTab()
    .then((tab) => {
      const tabId = tab?.id
      const origin = deps.pageOrigin(tab?.url)
      return typeof tabId === 'number' && Number.isInteger(tabId) && origin ? { tabId, origin } : undefined
    })
    .catch(() => undefined)

  return async function deliver(popupMessage: unknown, pageResult?: PublicFillResult): Promise<PopupResultDelivery> {
    if (popupOpen) {
      try {
        port.postMessage(popupMessage)
        return 'popup'
      } catch {
        popupOpen = false
      }
    }
    if (!pageResult) return 'dropped'
    const page = await fillPage
    if (!page) return 'dropped'
    try {
      if (await deps.tabOrigin(page.tabId) !== page.origin) return 'dropped'
      await deps.showStatus(page.tabId, pageResult)
      return 'page'
    } catch {
      return 'dropped'
    }
  }
}
