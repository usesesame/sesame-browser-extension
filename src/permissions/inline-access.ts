export const GLOBAL_HTTPS_PATTERN = 'https://*/*'
export const INLINE_SETTINGS_KEY = 'inlineSettingsV1'

export interface InlineSettings {
  version: 2
  pausedOrigins: string[]
  onboardingDismissed: boolean
  cardSuggestionsEnabled: boolean
}

type StorageArea = Pick<chrome.storage.StorageArea, 'get' | 'set'>

const DEFAULT_SETTINGS: InlineSettings = {
  version: 2,
  pausedOrigins: [],
  onboardingDismissed: false,
  cardSuggestionsEnabled: true,
}

export function inlinePermissionMode(origins: string[] | undefined): 'disabled' | 'global' | 'legacy-sites' {
  const granted = origins ?? []
  if (granted.includes(GLOBAL_HTTPS_PATTERN)) return 'global'
  return granted.some(isSupportedPermissionPattern) ? 'legacy-sites' : 'disabled'
}

export function normalizePausedOrigins(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const origins = value.flatMap((candidate) => {
    if (typeof candidate !== 'string') return []
    try {
      const url = new URL(candidate)
      if (url.origin !== candidate || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return []
      return isSupportedWebUrl(url) ? [url.origin] : []
    } catch {
      return []
    }
  })
  return [...new Set(origins)].sort()
}

export function originPattern(origin: string): string | null {
  const [normalized] = normalizePausedOrigins([origin])
  return normalized ? `${normalized}/*` : null
}

export async function loadInlineSettings(storage: StorageArea = chrome.storage.local): Promise<InlineSettings> {
  const stored = await storage.get(INLINE_SETTINGS_KEY)
  const value = stored[INLINE_SETTINGS_KEY]
  if (!isRecord(value)) return { ...DEFAULT_SETTINGS }
  return {
    version: 2,
    pausedOrigins: normalizePausedOrigins(value.pausedOrigins),
    onboardingDismissed: value.onboardingDismissed === true,
    cardSuggestionsEnabled: value.cardSuggestionsEnabled !== false,
  }
}

export async function setCardSuggestionsEnabled(enabled: boolean, storage: StorageArea = chrome.storage.local): Promise<InlineSettings> {
  const next = { ...(await loadInlineSettings(storage)), cardSuggestionsEnabled: enabled }
  await storage.set({ [INLINE_SETTINGS_KEY]: next })
  return next
}

export async function setSitePaused(
  origin: string,
  paused: boolean,
  storage: StorageArea = chrome.storage.local,
): Promise<InlineSettings> {
  const normalized = normalizePausedOrigins([origin])[0]
  if (!normalized) throw new TypeError('site pause requires an exact HTTPS or loopback origin')
  const settings = await loadInlineSettings(storage)
  const pausedOrigins = paused
    ? normalizePausedOrigins([...settings.pausedOrigins, normalized])
    : settings.pausedOrigins.filter((candidate) => candidate !== normalized)
  const next = { ...settings, pausedOrigins }
  await storage.set({ [INLINE_SETTINGS_KEY]: next })
  return next
}

export async function clearPausedSites(storage: StorageArea = chrome.storage.local): Promise<InlineSettings> {
  const settings = await loadInlineSettings(storage)
  const next = { ...settings, pausedOrigins: [] }
  await storage.set({ [INLINE_SETTINGS_KEY]: next })
  return next
}

export async function dismissOnboarding(storage: StorageArea = chrome.storage.local): Promise<void> {
  const settings = await loadInlineSettings(storage)
  await storage.set({ [INLINE_SETTINGS_KEY]: { ...settings, onboardingDismissed: true } })
}

export async function grantedInlineOrigins(): Promise<string[]> {
  const permissions = await chrome.permissions.getAll()
  return (permissions.origins ?? []).filter(isSupportedPermissionPattern)
}

export async function removeAllInlinePermissions(): Promise<boolean> {
  const origins = await grantedInlineOrigins()
  return origins.length === 0 || chrome.permissions.remove({ origins })
}

function isSupportedPermissionPattern(pattern: string): boolean {
  if (pattern === GLOBAL_HTTPS_PATTERN) return true
  if (!pattern.endsWith('/*')) return false
  try {
    const url = new URL(pattern.slice(0, -1))
    return `${url.origin}/*` === pattern && isSupportedWebUrl(url)
  } catch {
    return false
  }
}

function isSupportedWebUrl(url: URL): boolean {
  return url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url.hostname))
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
