import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Browser } from '../../src/platform/chrome'
import { createPendingStore, pendingKey, PENDING_TTL_MS, safePendingEntry, type SessionArea } from '../../src/background/pending-passwords'

const native = vi.hoisted(() => ({ requestPending: vi.fn() }))
vi.mock('../../src/background/native-connection', () => ({ requestPending: native.requestPending }))

import { createGeneratedPasswords, safePasswordStyle } from '../../src/background/generated-passwords'

const HANDLE = 'fictional-handle-for-examples-only-AAAAAAAA'
const ORIGIN = 'https://example.com'
const CURRENT = 'fictional-current-pass-1'
const NEW = 'fictional-new-pass-1'

function sessionArea(): SessionArea & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  return {
    data,
    async get(key) { return data.has(key) ? { [key]: structuredClone(data.get(key)) } : {} },
    async set(items) { for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value)) },
    async remove(key) { data.delete(key) },
  }
}

describe('pending handle store', () => {
  it('keeps a handle across a worker restart through session storage', async () => {
    const area = sessionArea()
    await createPendingStore(area, () => 1_000).remember(7, { handle: HANDLE, origin: ORIGIN, kind: 'change', createdAt: 1_000 })

    const restarted = createPendingStore(area, () => 2_000)

    await expect(restarted.lookup(7, ORIGIN)).resolves.toEqual({ handle: HANDLE, origin: ORIGIN, kind: 'change', createdAt: 1_000 })
  })

  it('stores only the handle, the origin, the kind and the time', async () => {
    const area = sessionArea()
    await createPendingStore(area).remember(7, { handle: HANDLE, origin: ORIGIN, kind: 'new', createdAt: 5, password: NEW } as never)
    expect(area.data.size).toBe(0)

    await createPendingStore(area).remember(7, { handle: HANDLE, origin: ORIGIN, kind: 'new', createdAt: 5 })
    const stored = area.data.get(pendingKey(7)) as Record<string, unknown>
    expect(Object.keys(stored).sort()).toEqual(['createdAt', 'handle', 'kind', 'origin'])
    expect(JSON.stringify([...area.data])).not.toContain(NEW)
  })

  it('gives nothing for another tab or another origin', async () => {
    const store = createPendingStore(sessionArea(), () => 10)
    await store.remember(7, { handle: HANDLE, origin: ORIGIN, kind: 'change', createdAt: 10 })
    await expect(store.lookup(8, ORIGIN)).resolves.toBeUndefined()
    await expect(store.lookup(7, 'https://other.example.com')).resolves.toBeUndefined()
    await expect(store.lookup(7, null)).resolves.toBeUndefined()
  })

  it('drops an expired handle and a closed tab', async () => {
    let now = 0
    const area = sessionArea()
    const store = createPendingStore(area, () => now)
    await store.remember(7, { handle: HANDLE, origin: ORIGIN, kind: 'change', createdAt: 0 })
    now = PENDING_TTL_MS
    await expect(store.lookup(7, ORIGIN)).resolves.toBeUndefined()
    expect(area.data.size).toBe(0)

    now = 0
    await store.remember(7, { handle: HANDLE, origin: ORIGIN, kind: 'change', createdAt: 0 })
    await store.forget(7)
    await expect(createPendingStore(area, () => 0).lookup(7, ORIGIN)).resolves.toBeUndefined()
  })

  it('ignores a damaged or planted session entry', async () => {
    const area = sessionArea()
    for (const planted of [
      { handle: 'short', origin: ORIGIN, kind: 'change', createdAt: 1 },
      { handle: HANDLE, origin: 'http://example.com', kind: 'change', createdAt: 1 },
      { handle: HANDLE, origin: ORIGIN, kind: 'other', createdAt: 1 },
      { handle: HANDLE, origin: ORIGIN, kind: 'change', createdAt: 1, password: CURRENT },
      'not an entry',
    ]) {
      area.data.set(pendingKey(7), planted)
      await expect(createPendingStore(area, () => 2).lookup(7, ORIGIN)).resolves.toBeUndefined()
      expect(safePendingEntry(planted)).toBeNull()
    }
  })
})

describe('generated password flow', () => {
  const browser = {} as Browser
  let area: ReturnType<typeof sessionArea>

  function flow(coordinator: Record<string, unknown>, origin: string | null = ORIGIN, username = '') {
    const store = createPendingStore(area, () => 100)
    return {
      store,
      generated: createGeneratedPasswords({
        coordinator: coordinator as never,
        store,
        browser,
        tabOrigin: async () => origin,
        captureUsername: async () => username,
        now: () => 100,
      }),
    }
  }

  beforeEach(() => {
    area = sessionArea()
    native.requestPending.mockReset()
    native.requestPending.mockResolvedValue({ ok: true, state: 'confirmed' })
  })

  it('keeps only the handle after a change and never the passwords', async () => {
    const changePasswordActivePage = vi.fn().mockResolvedValue({ ok: true, tabId: 7, origin: ORIGIN, handle: HANDLE, currentFilled: 1, newFilled: 2 })
    const { generated } = flow({ changePasswordActivePage })

    await generated.change({ style: 'characters', size: 20 })

    expect(JSON.stringify([...area.data])).not.toMatch(/fictional-(current|new)-pass/)
    await expect(generated.pending(7)).resolves.toBe('change')
  })

  it('confirms through the desktop after a worker restart and forgets the handle', async () => {
    await createPendingStore(area, () => 100).remember(7, { handle: HANDLE, origin: ORIGIN, kind: 'change', createdAt: 100 })
    const { generated } = flow({})

    await expect(generated.accept(7)).resolves.toEqual({ state: 'confirmed' })
    expect(native.requestPending).toHaveBeenCalledWith(browser, ORIGIN, HANDLE, 'accepted', { username: undefined })
    await expect(generated.pending(7)).resolves.toBeNull()
  })

  it('sends the page username only for a new login', async () => {
    await createPendingStore(area, () => 100).remember(7, { handle: HANDLE, origin: ORIGIN, kind: 'new', createdAt: 100 })
    const { generated } = flow({}, ORIGIN, 'casey@example.com')
    await generated.accept(7)
    expect(native.requestPending).toHaveBeenCalledWith(browser, ORIGIN, HANDLE, 'accepted', { username: 'casey@example.com' })
  })

  it('sends nothing for a tab on another origin', async () => {
    await createPendingStore(area, () => 100).remember(7, { handle: HANDLE, origin: ORIGIN, kind: 'change', createdAt: 100 })
    const { generated } = flow({}, 'https://other.example.com')
    await expect(generated.accept(7)).resolves.toEqual({ code: 'pending-not-found' })
    expect(native.requestPending).not.toHaveBeenCalled()
  })

  it('keeps the handle when the desktop is locked so the person can retry', async () => {
    native.requestPending.mockResolvedValue({ ok: false, code: 'vault-locked' })
    await createPendingStore(area, () => 100).remember(7, { handle: HANDLE, origin: ORIGIN, kind: 'change', createdAt: 100 })
    const { generated } = flow({})
    await expect(generated.accept(7)).resolves.toEqual({ code: 'vault-locked' })
    await expect(generated.pending(7)).resolves.toBe('change')
  })

  it('forgets a handle the desktop no longer knows', async () => {
    native.requestPending.mockResolvedValue({ ok: true, state: 'unknown' })
    await createPendingStore(area, () => 100).remember(7, { handle: HANDLE, origin: ORIGIN, kind: 'change', createdAt: 100 })
    const { generated } = flow({})
    await expect(generated.accept(7)).resolves.toEqual({ state: 'unknown' })
    await expect(generated.pending(7)).resolves.toBeNull()
  })

  it('accepts only supported password styles', () => {
    expect(safePasswordStyle({ style: 'characters', size: 20 })).toEqual({ style: 'characters', size: 20 })
    expect(safePasswordStyle({ style: 'passphrase', size: 6 })).toEqual({ style: 'passphrase', size: 6 })
    expect(safePasswordStyle({ style: 'characters', size: 15 })).toBeNull()
    expect(safePasswordStyle({ style: 'passphrase', size: 11 })).toBeNull()
    expect(safePasswordStyle({ style: 'pin', size: 20 })).toBeNull()
    expect(safePasswordStyle({ newPassword: NEW })).toBeNull()
  })
})

describe('extension storage rules', () => {
  const root = resolve(import.meta.dirname, '..', '..', 'src')
  const sources = (directory: string): string[] => readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? sources(path) : /\.(ts|svelte)$/.test(name) ? [path] : []
  })

  it('never widens session storage to content scripts', () => {
    for (const path of sources(root)) expect(readFileSync(path, 'utf8'), path).not.toMatch(/setAccessLevel/)
  })

  it('writes session storage only from the pending handle store', () => {
    const writers = sources(root).filter((path) => /storage\.session/.test(readFileSync(path, 'utf8')))
    expect(writers.map((path) => path.slice(root.length + 1))).toEqual(['background/main.ts'])
    expect(readFileSync(join(root, 'background', 'main.ts'), 'utf8')).toMatch(/createPendingStore\(chrome\.storage\.session\)/)
  })

  it('has no password generator left in the extension', () => {
    for (const path of sources(root)) {
      const text = readFileSync(path, 'utf8')
      expect(text, path).not.toMatch(/makeRegistrationPassword|EFF_WORDLIST|generatePassword\(/)
    }
  })
})
