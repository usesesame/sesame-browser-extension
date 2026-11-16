import type { PublicFillResult } from './fill-result'

export const MISSED_RESULT_BADGE = '!'
export const MISSED_RESULT_TITLE = 'Sesame did not fill this page. Open Sesame to see why.'

export interface ToolbarAction {
  setBadgeText(details: { tabId: number; text: string }): Promise<void>
  setTitle(details: { tabId: number; title: string }): Promise<void>
}

export type MissedFillResult = Extract<PublicFillResult, { state: 'unavailable' }>

export interface MissedResultNotice {
  hold(tabId: number, result: PublicFillResult): Promise<boolean>
  take(tabId: number): Promise<MissedFillResult | undefined>
  forget(tabId: number): void
}

export function createMissedResultNotice(action: ToolbarAction, defaultTitle: string): MissedResultNotice {
  const results = new Map<number, MissedFillResult>()

  async function setNotice(tabId: number, text: string, title: string): Promise<boolean> {
    try {
      await action.setBadgeText({ tabId, text })
      await action.setTitle({ tabId, title })
      return true
    } catch {
      return false
    }
  }

  return {
    async hold(tabId, result) {
      if (!Number.isInteger(tabId) || result.state !== 'unavailable') return false
      results.set(tabId, result.lookalike === undefined
        ? { state: 'unavailable', code: result.code }
        : { state: 'unavailable', code: result.code, lookalike: result.lookalike })
      return setNotice(tabId, MISSED_RESULT_BADGE, MISSED_RESULT_TITLE)
    },
    async take(tabId) {
      if (!Number.isInteger(tabId)) return undefined
      const result = results.get(tabId)
      results.delete(tabId)
      await setNotice(tabId, '', defaultTitle)
      return result
    },
    forget(tabId) {
      results.delete(tabId)
    },
  }
}
