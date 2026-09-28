import type { FillContext } from './fill-state'
import type { PublicFillResult } from './fill-result'

export const FILL_CONTEXT_MENU_ID = 'sesame-fill-login'
export const FILL_CONTEXT_MENU_TITLE = 'Fill with Sesame'

export type FillContextMenuContexts = ['page', 'editable']

export interface ContextMenuApi {
  removeAll(): Promise<void>
  create(
    properties: { id: string; title: string; contexts: FillContextMenuContexts },
    callback: () => void,
  ): unknown
}

export interface ContextMenuFillDeps {
  queryActiveTab(): Promise<{ id?: number } | undefined>
  fillActivePage(): Promise<FillContext>
  toPublicResult(context: FillContext): PublicFillResult
  showStatus(tabId: number, result: PublicFillResult): Promise<unknown>
}

export type ContextMenuFillOutcome = 'ignored' | 'not-active' | 'filled' | 'unavailable'

export async function ensureFillContextMenu(menus: ContextMenuApi): Promise<void> {
  await menus.removeAll()
  menus.create({
    id: FILL_CONTEXT_MENU_ID,
    title: FILL_CONTEXT_MENU_TITLE,
    contexts: ['page', 'editable'],
  }, () => { /* noop */ })
}

export function createContextMenuFillHandler(deps: ContextMenuFillDeps) {
  return async function handleFillContextMenuClick(
    info: { menuItemId?: string | number },
    tab?: { id?: number },
  ): Promise<ContextMenuFillOutcome> {
    if (info.menuItemId !== FILL_CONTEXT_MENU_ID) return 'ignored'
    const clickedTabId = tab?.id
    if (typeof clickedTabId !== 'number' || !Number.isInteger(clickedTabId)) return 'not-active'
    let active: { id?: number } | undefined
    try {
      active = await deps.queryActiveTab()
    } catch {
      return 'not-active'
    }
    if (active?.id !== clickedTabId) return 'not-active'

    let result: PublicFillResult
    try {
      result = deps.toPublicResult(await deps.fillActivePage())
    } catch {
      result = { state: 'unavailable', code: 'fill-failed' }
    }
    try {
      await deps.showStatus(clickedTabId, result)
    } catch { /* noop */ }
    return result.state === 'filled' ? 'filled' : 'unavailable'
  }
}
