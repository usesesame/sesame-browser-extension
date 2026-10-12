import { describe, expect, it, vi } from 'vitest'
import { copyTemporarily, type ClipboardAccess } from '../../src/content/temporary-copy'

function fakeClipboard(initial = '', options: { readable?: boolean; failRead?: boolean } = {}) {
  const state = { text: initial }
  const clipboard: ClipboardAccess = {
    writeText: vi.fn(async (value: string) => { state.text = value }),
  }
  if (options.readable !== false) {
    clipboard.readText = vi.fn(async () => {
      if (options.failRead) throw new DOMException('Read permission denied.', 'NotAllowedError')
      return state.text
    })
  }
  return { state, clipboard }
}

describe('temporary copy', () => {
  it('clears the clipboard while it still holds the copied password', async () => {
    const { state, clipboard } = fakeClipboard()
    const onExpired = vi.fn()
    const onClearFailed = vi.fn()
    const handle = await copyTemporarily('fictional-copy-1', { clipboard, onExpired, onClearFailed })
    expect(state.text).toBe('fictional-copy-1')

    await handle.clear()

    expect(state.text).toBe('')
    expect(onExpired).toHaveBeenCalledTimes(1)
    expect(onClearFailed).not.toHaveBeenCalled()
  })

  it('leaves content the user copied afterwards', async () => {
    const { state, clipboard } = fakeClipboard()
    const onExpired = vi.fn()
    const handle = await copyTemporarily('fictional-copy-1', { clipboard, onExpired })
    state.text = 'fictional note'

    await handle.clear()

    expect(state.text).toBe('fictional note')
    expect(onExpired).toHaveBeenCalledTimes(1)
  })

  it('reports a failure instead of an expiry when the clipboard cannot be read', async () => {
    const { state, clipboard } = fakeClipboard('', { failRead: true })
    const onExpired = vi.fn()
    const onClearFailed = vi.fn()
    const handle = await copyTemporarily('fictional-copy-1', { clipboard, onExpired, onClearFailed })

    await handle.clear()

    expect(state.text).toBe('fictional-copy-1')
    expect(onExpired).not.toHaveBeenCalled()
    expect(onClearFailed).toHaveBeenCalledTimes(1)
  })

  it('reports a failure when the clipboard offers no read access', async () => {
    const { clipboard } = fakeClipboard('', { readable: false })
    const onExpired = vi.fn()
    const onClearFailed = vi.fn()
    const handle = await copyTemporarily('fictional-copy-1', { clipboard, onExpired, onClearFailed })

    await handle.clear()

    expect(onExpired).not.toHaveBeenCalled()
    expect(onClearFailed).toHaveBeenCalledTimes(1)
  })

  it('reports a failure when clearing the clipboard is refused', async () => {
    const { clipboard } = fakeClipboard()
    const onExpired = vi.fn()
    const onClearFailed = vi.fn()
    const handle = await copyTemporarily('fictional-copy-1', { clipboard, onExpired, onClearFailed })
    clipboard.writeText = vi.fn(async () => { throw new DOMException('Write blocked.', 'NotAllowedError') })

    await handle.clear()

    expect(onExpired).not.toHaveBeenCalled()
    expect(onClearFailed).toHaveBeenCalledTimes(1)
  })

  it('clears when the lifetime ends', async () => {
    vi.useFakeTimers()
    try {
      const { state, clipboard } = fakeClipboard()
      await copyTemporarily('fictional-copy-1', { clipboard, lifetimeMs: 1_000 })
      await vi.advanceTimersByTimeAsync(1_001)
      expect(state.text).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops the schedule on cancel without touching the clipboard', async () => {
    vi.useFakeTimers()
    try {
      const { state, clipboard } = fakeClipboard()
      const handle = await copyTemporarily('fictional-copy-1', { clipboard, lifetimeMs: 1_000 })
      handle.cancel()
      await vi.advanceTimersByTimeAsync(2_000)
      expect(state.text).toBe('fictional-copy-1')
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears only once', async () => {
    const { clipboard } = fakeClipboard()
    const onExpired = vi.fn()
    const handle = await copyTemporarily('fictional-copy-1', { clipboard, onExpired })

    await handle.clear()
    await handle.clear()

    expect(onExpired).toHaveBeenCalledTimes(1)
  })
})
