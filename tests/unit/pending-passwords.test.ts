import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Browser } from '../../src/platform/chrome'
import { createPendingStore, pendingKey, PENDING_TTL_MS, safePendingEntry, type SessionArea } from '../../src/background/pending-passwords'

const native = vi.hoisted(() => ({ requestPending: vi.fn() }))
vi.mock('../../src/background/native-connection', () => ({ requestPending: native.requestPending }))

import { captureSignupUsernameInPage, createGeneratedPasswords, createPasswordSenderPage, safePasswordStyle } from '../../src/background/generated-passwords'

const HANDLE = 'fictional-handle-for-examples-only-AAAAAAAA'
const NEWER_HANDLE = 'fictional-handle-for-examples-only-BBBBBBBB'
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

function slowSessionArea() {
  const area = sessionArea()
  const reads: Array<() => void> = []
  return {
    area: {
      ...area,
      async get(key: string) {
        const snapshot = await area.get(key)
        await new Promise<void>((release) => reads.push(release))
        return snapshot
      },
    } satisfies SessionArea,
    data: area.data,
    reads,
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

  it('keeps a newer handle stored while an older read was in flight', async () => {
    const slow = slowSessionArea()
    await createPendingStore(slow.area, () => 10).remember(7, { handle: HANDLE, origin: ORIGIN, kind: 'change', createdAt: 10 })
    const store = createPendingStore(slow.area, () => 10)

    const stale = store.lookup(7, ORIGIN)
    await vi.waitFor(() => expect(slow.reads).toHaveLength(1))
    await store.remember(7, { handle: NEWER_HANDLE, origin: ORIGIN, kind: 'new', createdAt: 10 })
    slow.reads[0]()

    await expect(stale).resolves.toMatchObject({ handle: NEWER_HANDLE, kind: 'new' })
    await expect(store.lookup(7, ORIGIN)).resolves.toMatchObject({ handle: NEWER_HANDLE, kind: 'new' })
  })

  it('does not bring back a handle forgotten while a read was in flight', async () => {
    const slow = slowSessionArea()
    await createPendingStore(slow.area, () => 10).remember(7, { handle: HANDLE, origin: ORIGIN, kind: 'change', createdAt: 10 })
    const store = createPendingStore(slow.area, () => 10)

    const stale = store.lookup(7, ORIGIN)
    await vi.waitFor(() => expect(slow.reads).toHaveLength(1))
    await store.forget(7)
    slow.reads[0]()

    await expect(stale).resolves.toBeUndefined()
    const after = store.lookup(7, ORIGIN)
    await vi.waitFor(() => expect(slow.reads).toHaveLength(2))
    slow.reads[1]()
    await expect(after).resolves.toBeUndefined()
    expect(slow.data.size).toBe(0)
  })

  it('forgets a handle only while it is still the one stored for the tab', async () => {
    const area = sessionArea()
    const store = createPendingStore(area, () => 10)
    await store.remember(7, { handle: NEWER_HANDLE, origin: ORIGIN, kind: 'new', createdAt: 10 })

    await store.forgetHandle(7, HANDLE)
    await expect(store.lookup(7, ORIGIN)).resolves.toMatchObject({ handle: NEWER_HANDLE })
    expect(area.data.has(pendingKey(7))).toBe(true)

    await store.forgetHandle(7, NEWER_HANDLE)
    await expect(store.lookup(7, ORIGIN)).resolves.toBeUndefined()
    expect(area.data.size).toBe(0)
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
    const captureUsername = vi.fn<(tabId: number, origin: string) => Promise<string>>(async () => username)
    return {
      store,
      captureUsername,
      generated: createGeneratedPasswords({
        coordinator: coordinator as never,
        store,
        browser,
        tabOrigin: async () => origin,
        captureUsername,
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
    const { generated, captureUsername } = flow({}, ORIGIN, 'casey@example.com')
    await generated.accept(7)
    expect(captureUsername).toHaveBeenCalledWith(7, ORIGIN)
    expect(native.requestPending).toHaveBeenCalledWith(browser, ORIGIN, HANDLE, 'accepted', { username: 'casey@example.com' })
  })

  it('reads the sign-up username only from the origin that was checked', () => {
    vi.stubGlobal('sesameCaptureSignupUsername', () => 'casey@example.com')
    try {
      vi.stubGlobal('location', { origin: ORIGIN })
      expect(captureSignupUsernameInPage(ORIGIN)).toBe('casey@example.com')
      vi.stubGlobal('location', { origin: 'https://other.example.com' })
      expect(captureSignupUsernameInPage(ORIGIN)).toBe('')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps a newer handle stored for the tab while an older one is confirmed', async () => {
    await createPendingStore(area, () => 100).remember(7, { handle: HANDLE, origin: ORIGIN, kind: 'change', createdAt: 100 })
    const createPasswordActivePage = vi.fn().mockResolvedValue({ ok: true, tabId: 7, origin: ORIGIN, handle: NEWER_HANDLE, fieldsFilled: 2 })
    const { generated } = flow({ createPasswordActivePage })
    let answer: (value: unknown) => void = () => {}
    native.requestPending.mockImplementation(() => new Promise((resolve) => { answer = resolve }))

    const accepting = generated.accept(7)
    await vi.waitFor(() => expect(native.requestPending).toHaveBeenCalledTimes(1))
    await generated.create({ style: 'passphrase', size: 6 })
    answer({ ok: true, state: 'confirmed' })

    await expect(accepting).resolves.toEqual({ state: 'confirmed' })
    await expect(generated.pending(7)).resolves.toBe('new')
    expect(JSON.stringify(area.data.get(pendingKey(7)))).toContain(NEWER_HANDLE)
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

  it('passes the sending page to the coordinator for a sign-up', async () => {
    const createPasswordActivePage = vi.fn().mockResolvedValue({ ok: false, code: 'page-changed' })
    const { generated } = flow({ createPasswordActivePage })
    await expect(generated.create({ style: 'characters', size: 20 }, { tabId: 7, origin: ORIGIN })).resolves.toEqual({ ok: false, code: 'page-changed' })
    expect(createPasswordActivePage).toHaveBeenCalledWith({ style: 'characters', size: 20 }, undefined, { tabId: 7, origin: ORIGIN })
    expect(area.data.size).toBe(0)
  })

  it('takes a sign-up request only from the top frame of the active tab', () => {
    const top = { url: `${ORIGIN}/join`, frameId: 0, tab: { id: 7, active: true } }
    expect(createPasswordSenderPage(top)).toEqual({ tabId: 7, origin: ORIGIN })
    expect(createPasswordSenderPage({ ...top, frameId: 2 })).toBeNull()
    expect(createPasswordSenderPage({ ...top, tab: { id: 7, active: false } })).toBeNull()
    expect(createPasswordSenderPage({ ...top, tab: { active: true } })).toBeNull()
    expect(createPasswordSenderPage({ frameId: 0, tab: { id: 7, active: true } })).toBeNull()
    expect(createPasswordSenderPage({ ...top, url: 'http://example.com/join' })).toBeNull()
    expect(createPasswordSenderPage({ ...top, url: 'not a url' })).toBeNull()
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
