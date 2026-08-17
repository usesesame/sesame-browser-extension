import { normalizeFillOrigin } from '../protocol/native'

export interface PageTab {
  id?: number
  windowId?: number
  url?: string
}

export type TabFillContext =
  | { ok: true; tabId: number; windowId?: number; origin: string }
  | { ok: false; code: 'no-active-tab' | 'page-restricted' }

export function tabFillContext(tab?: PageTab): TabFillContext {
  if (!Number.isInteger(tab?.id) || typeof tab?.url !== 'string') {
    return { ok: false, code: 'no-active-tab' }
  }
  try {
    const url = new URL(tab.url)
    const origin = normalizeFillOrigin(url.origin)
    if (!origin || url.hostname.endsWith('.') || url.username || url.password) {
      return { ok: false, code: 'page-restricted' }
    }
    return {
      ok: true,
      tabId: tab.id!,
      windowId: Number.isInteger(tab.windowId) ? tab.windowId : undefined,
      origin,
    }
  } catch {
    return { ok: false, code: 'page-restricted' }
  }
}

export function isSameActivePage(expected: Extract<TabFillContext, { ok: true }>, tab?: PageTab): boolean {
  const current = tabFillContext(tab)
  return current.ok
    && current.tabId === expected.tabId
    && current.windowId === expected.windowId
    && current.origin === expected.origin
}
