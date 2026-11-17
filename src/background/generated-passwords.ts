import { requestPending } from './native-connection'
import type { ChangePasswordResult, Coordinator, CreatePasswordResult, ExpectedPage } from './coordinator'
import type { PendingKind, PendingStore } from './pending-passwords'
import type { Browser } from '../platform/chrome'
import { isPasswordStyle, normalizeFillOrigin, type PasswordStyle, type PendingState } from '../protocol/native'
import { isRecord } from '../shared/values'

export function safePasswordStyle(message: unknown): PasswordStyle | null {
  if (!isRecord(message)) return null
  const { style, size } = message
  if (!isPasswordStyle(style, size)) return null
  return style === 'passphrase'
    ? { style: 'passphrase', size: size as number }
    : { style: 'characters', size: size as number }
}

export interface CreatePasswordSender {
  url?: string
  frameId?: number
  tab?: { id?: number; active?: boolean }
}

export function createPasswordSenderPage(sender: CreatePasswordSender): ExpectedPage | null {
  const tabId = sender.tab?.id
  if (sender.frameId !== 0 || sender.tab?.active !== true || typeof tabId !== 'number' || !Number.isInteger(tabId)) return null
  let origin: string | null = null
  try {
    origin = typeof sender.url === 'string' ? normalizeFillOrigin(new URL(sender.url).origin) : null
  } catch {
    origin = null
  }
  return origin ? { tabId, origin } : null
}

export type AcceptResult = { state: PendingState } | { code: string }

interface GeneratedPasswordDeps {
  coordinator: Pick<Coordinator, 'changePasswordActivePage' | 'createPasswordActivePage'>
  store: PendingStore
  browser: Browser
  tabOrigin(tabId: number): Promise<string | null>
  captureUsername(tabId: number, origin: string): Promise<string>
  now?: () => number
}

export function createGeneratedPasswords(deps: GeneratedPasswordDeps) {
  const now = deps.now ?? Date.now

  async function remember(tabId: number, origin: string, handle: string, kind: PendingKind) {
    await deps.store.remember(tabId, { handle, origin, kind, createdAt: now() })
  }

  return {
    async change(style: PasswordStyle): Promise<ChangePasswordResult> {
      const result = await deps.coordinator.changePasswordActivePage(style)
      if (result.ok) await remember(result.tabId, result.origin, result.handle, 'change')
      return result
    },

    async create(style: PasswordStyle, expectedPage?: ExpectedPage): Promise<CreatePasswordResult> {
      const result = await deps.coordinator.createPasswordActivePage(style, undefined, expectedPage)
      if (result.ok) await remember(result.tabId, result.origin, result.handle, 'new')
      return result
    },

    async pending(tabId: number): Promise<PendingKind | null> {
      const entry = await deps.store.lookup(tabId, await deps.tabOrigin(tabId))
      return entry?.kind ?? null
    },

    async accept(tabId: number): Promise<AcceptResult> {
      const origin = await deps.tabOrigin(tabId)
      const entry = await deps.store.lookup(tabId, origin)
      if (!entry) return { code: 'pending-not-found' }
      const username = entry.kind === 'new' ? await deps.captureUsername(tabId, entry.origin).catch(() => '') : undefined
      const result = await requestPending(deps.browser, entry.origin, entry.handle, 'accepted', { username })
      if (!result.ok) return { code: result.code }
      if (result.state !== 'unconfirmed') await deps.store.forgetHandle(tabId, entry.handle)
      return { state: result.state }
    },
  }
}

export function captureSignupUsernameInPage(expectedOrigin: string): unknown {
  if (location.origin !== expectedOrigin) return ''
  const capture = (globalThis as typeof globalThis & { sesameCaptureSignupUsername?: () => unknown }).sesameCaptureSignupUsername
  return typeof capture === 'function' ? capture() : ''
}
