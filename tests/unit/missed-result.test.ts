import { describe, expect, it, vi } from 'vitest'
import { MISSED_RESULT_BADGE, MISSED_RESULT_TITLE, createMissedResultNotice, type ToolbarAction } from '../../src/background/missed-result'
import type { PublicFillResult } from '../../src/background/fill-result'

const lookalike: PublicFillResult = { state: 'unavailable', code: 'lookalike-domain', lookalike: 'examp1e.test' }

function fakeAction(): ToolbarAction & { setBadgeText: ReturnType<typeof vi.fn>; setTitle: ReturnType<typeof vi.fn> } {
  return {
    setBadgeText: vi.fn().mockResolvedValue(undefined),
    setTitle: vi.fn().mockResolvedValue(undefined),
  }
}

describe('a fill result the page could not show', () => {
  it('marks the toolbar button of that tab and hands the result to the next popup once', async () => {
    const action = fakeAction()
    const notice = createMissedResultNotice(action, 'Sesame')

    await expect(notice.hold(7, lookalike)).resolves.toBe(true)
    expect(action.setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: MISSED_RESULT_BADGE })
    expect(action.setTitle).toHaveBeenCalledWith({ tabId: 7, title: MISSED_RESULT_TITLE })

    await expect(notice.take(7)).resolves.toEqual(lookalike)
    expect(action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 7, text: '' })
    expect(action.setTitle).toHaveBeenLastCalledWith({ tabId: 7, title: 'Sesame' })
    await expect(notice.take(7)).resolves.toBeUndefined()
  })

  it('keeps only the public result fields', async () => {
    const notice = createMissedResultNotice(fakeAction(), 'Sesame')
    const extra = { ...lookalike, password: 'fictional-value', username: 'person@example.test' } as PublicFillResult

    await notice.hold(7, extra)

    expect(await notice.take(7)).toEqual({ state: 'unavailable', code: 'lookalike-domain', lookalike: 'examp1e.test' })
  })

  it('does not mark the toolbar for a successful fill', async () => {
    const action = fakeAction()
    const notice = createMissedResultNotice(action, 'Sesame')

    await expect(notice.hold(7, { state: 'filled', usernameFilled: true, passwordFilled: true, matchKind: 'exact' })).resolves.toBe(false)
    expect(action.setBadgeText).not.toHaveBeenCalled()
    await expect(notice.take(7)).resolves.toBeUndefined()
  })

  it('keeps results apart per tab and drops a result when its tab navigates or closes', async () => {
    const notice = createMissedResultNotice(fakeAction(), 'Sesame')
    await notice.hold(7, lookalike)
    await notice.hold(9, { state: 'unavailable', code: 'approval-declined' })

    notice.forget(7)

    await expect(notice.take(7)).resolves.toBeUndefined()
    await expect(notice.take(9)).resolves.toEqual({ state: 'unavailable', code: 'approval-declined' })
  })

  it('clears a badge left from before a worker restart when the popup opens', async () => {
    const action = fakeAction()
    const notice = createMissedResultNotice(action, 'Sesame')

    await expect(notice.take(7)).resolves.toBeUndefined()
    expect(action.setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: '' })
  })

  it('reports that nothing was shown when the toolbar cannot be marked', async () => {
    const action = fakeAction()
    action.setBadgeText.mockRejectedValue(new Error('No tab with id: 7'))
    const notice = createMissedResultNotice(action, 'Sesame')

    await expect(notice.hold(7, lookalike)).resolves.toBe(false)
    await expect(notice.take(7)).resolves.toEqual(lookalike)
  })
})
