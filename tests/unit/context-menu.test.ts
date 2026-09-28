import { describe, expect, it, vi } from 'vitest'
import {
  createContextMenuFillHandler,
  ensureFillContextMenu,
  FILL_CONTEXT_MENU_ID,
  FILL_CONTEXT_MENU_TITLE,
  type ContextMenuFillDeps,
} from '../../src/background/context-menu'
import { publicFillResult } from '../../src/background/fill-result'
import type { FillContext } from '../../src/background/fill-state'

function completedFill(): FillContext {
  return { phase: { name: 'complete', usernameFilled: true, passwordFilled: true, matchKind: 'exact' } }
}

function deps(overrides: Partial<ContextMenuFillDeps> = {}): ContextMenuFillDeps {
  return {
    queryActiveTab: vi.fn().mockResolvedValue({ id: 7 }),
    fillActivePage: vi.fn().mockResolvedValue(completedFill()),
    toPublicResult: publicFillResult,
    showStatus: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
}

describe('the fill context menu click', () => {
  it('ignores a click that belongs to a different menu item', async () => {
    const handlerDeps = deps()
    const handleClick = createContextMenuFillHandler(handlerDeps)

    await expect(handleClick({ menuItemId: 'other-item' }, { id: 7 })).resolves.toBe('ignored')
    expect(handlerDeps.fillActivePage).not.toHaveBeenCalled()
    expect(handlerDeps.showStatus).not.toHaveBeenCalled()
  })

  it('refuses a click when the menu tab is no longer the active tab', async () => {
    const handlerDeps = deps({ queryActiveTab: vi.fn().mockResolvedValue({ id: 9 }) })
    const handleClick = createContextMenuFillHandler(handlerDeps)

    await expect(handleClick({ menuItemId: FILL_CONTEXT_MENU_ID }, { id: 7 })).resolves.toBe('not-active')
    expect(handlerDeps.fillActivePage).not.toHaveBeenCalled()
    expect(handlerDeps.showStatus).not.toHaveBeenCalled()
  })

  it('refuses a click without a tab', async () => {
    const handlerDeps = deps()
    const handleClick = createContextMenuFillHandler(handlerDeps)

    await expect(handleClick({ menuItemId: FILL_CONTEXT_MENU_ID }, undefined)).resolves.toBe('not-active')
    expect(handlerDeps.fillActivePage).not.toHaveBeenCalled()
  })

  it('refuses when the active tab cannot be resolved', async () => {
    const handlerDeps = deps({ queryActiveTab: vi.fn().mockRejectedValue(new Error('tabs unavailable')) })
    const handleClick = createContextMenuFillHandler(handlerDeps)

    await expect(handleClick({ menuItemId: FILL_CONTEXT_MENU_ID }, { id: 7 })).resolves.toBe('not-active')
    expect(handlerDeps.fillActivePage).not.toHaveBeenCalled()
  })

  it('runs the existing fill pipeline for the active tab and shows the public result', async () => {
    const handlerDeps = deps()
    const handleClick = createContextMenuFillHandler(handlerDeps)

    await expect(handleClick({ menuItemId: FILL_CONTEXT_MENU_ID }, { id: 7 })).resolves.toBe('filled')
    expect(handlerDeps.fillActivePage).toHaveBeenCalledTimes(1)
    expect(handlerDeps.showStatus).toHaveBeenCalledWith(7, {
      state: 'filled',
      usernameFilled: true,
      passwordFilled: true,
      matchKind: 'exact',
    })
  })

  it('reports an unavailable fill without throwing', async () => {
    const handlerDeps = deps({ fillActivePage: vi.fn().mockRejectedValue(new Error('worker stopped')) })
    const handleClick = createContextMenuFillHandler(handlerDeps)

    await expect(handleClick({ menuItemId: FILL_CONTEXT_MENU_ID }, { id: 7 })).resolves.toBe('unavailable')
    expect(handlerDeps.showStatus).toHaveBeenCalledWith(7, { state: 'unavailable', code: 'fill-failed' })
  })

  it('stays quiet when the tab has no overlay to show the status', async () => {
    const handlerDeps = deps({ showStatus: vi.fn().mockResolvedValue(false) })
    const handleClick = createContextMenuFillHandler(handlerDeps)

    await expect(handleClick({ menuItemId: FILL_CONTEXT_MENU_ID }, { id: 7 })).resolves.toBe('filled')
  })

  it('does not fail when showing the status is blocked', async () => {
    const handlerDeps = deps({ showStatus: vi.fn().mockRejectedValue(new Error('frame gone')) })
    const handleClick = createContextMenuFillHandler(handlerDeps)

    await expect(handleClick({ menuItemId: FILL_CONTEXT_MENU_ID }, { id: 7 })).resolves.toBe('filled')
  })
})

describe('the fill context menu entry', () => {
  it('replaces its own menu item so install and startup do not duplicate it', async () => {
    const menus = {
      removeAll: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockReturnValue('1'),
    }

    await ensureFillContextMenu(menus)

    expect(menus.removeAll).toHaveBeenCalledTimes(1)
    expect(menus.create).toHaveBeenCalledTimes(1)
    expect(menus.create).toHaveBeenCalledWith({
      id: FILL_CONTEXT_MENU_ID,
      title: FILL_CONTEXT_MENU_TITLE,
      contexts: ['page', 'editable'],
    }, expect.any(Function))
    expect(menus.removeAll.mock.invocationCallOrder[0])
      .toBeLessThan(menus.create.mock.invocationCallOrder[0])
  })
})
