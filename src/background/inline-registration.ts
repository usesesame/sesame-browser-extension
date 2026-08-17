export const INLINE_CONTENT_SCRIPT_ID = 'sesame-inline-button'

import { GLOBAL_HTTPS_PATTERN } from '../permissions/inline-access'

interface PermissionApi {
  getAll(): Promise<{ origins?: string[] }>
}

interface RegisteredScript {
  id: string
  matches?: string[]
}

interface ScriptingApi {
  getRegisteredContentScripts(filter?: { ids?: string[] }): Promise<RegisteredScript[]>
  unregisterContentScripts(filter: { ids: string[] }): Promise<void>
  registerContentScripts(scripts: Array<{
    id: string
    matches: string[]
    js: string[]
    runAt: 'document_idle'
    allFrames: false
    persistAcrossSessions: true
  }>): Promise<void>
}

export function normalizeGrantedOrigins(origins?: string[]): string[] {
  const normalized = (origins ?? []).flatMap((pattern) => {
    if (typeof pattern !== 'string' || !pattern.endsWith('/*')) return []
    if (pattern === GLOBAL_HTTPS_PATTERN) return [GLOBAL_HTTPS_PATTERN]
    try {
      const url = new URL(pattern.slice(0, -1))
      const safeProtocol = url.protocol === 'https:'
        || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      if (!safeProtocol || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        return []
      }
      const exact = `${url.origin}/*`
      return exact === pattern ? [exact] : []
    } catch {
      return []
    }
  })
  const unique = [...new Set(normalized)].sort()
  return unique.includes(GLOBAL_HTTPS_PATTERN) ? [GLOBAL_HTTPS_PATTERN] : unique
}

export async function syncInlineContentScript(options: {
  permissions: PermissionApi
  scripting: ScriptingApi
}): Promise<{ enabled: boolean; origins: string[] }> {
  const granted = normalizeGrantedOrigins((await options.permissions.getAll()).origins)
  const registered = await options.scripting.getRegisteredContentScripts({ ids: [INLINE_CONTENT_SCRIPT_ID] })
  const current = registered[0]
  const currentMatches = normalizeGrantedOrigins(current?.matches)

  if (granted.length === 0) {
    if (current) {
      await options.scripting.unregisterContentScripts({ ids: [INLINE_CONTENT_SCRIPT_ID] })
    }
    return { enabled: false, origins: [] }
  }
  if (current && sameStrings(currentMatches, granted)) {
    return { enabled: true, origins: granted }
  }
  if (current) {
    await options.scripting.unregisterContentScripts({ ids: [INLINE_CONTENT_SCRIPT_ID] })
  }
  await options.scripting.registerContentScripts([{
    id: INLINE_CONTENT_SCRIPT_ID,
    matches: granted,
    js: ['content-overlay.js'],
    runAt: 'document_idle',
    allFrames: false,
    persistAcrossSessions: true,
  }])
  return { enabled: true, origins: granted }
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function createInlineRegistrationSync(
  sync: () => Promise<{ enabled: boolean; origins: string[] }>,
): () => Promise<boolean> {
  let inFlight: Promise<boolean> | undefined
  return function ensureRegistered(): Promise<boolean> {
    if (inFlight) return inFlight
    inFlight = (async () => {
      try {
        return (await sync()).enabled
      } catch {
        try {
          return (await sync()).enabled
        } catch {
          return false
        }
      }
    })()
    inFlight.finally(() => { inFlight = undefined })
    return inFlight
  }
}
