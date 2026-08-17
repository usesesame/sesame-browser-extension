import {
  NATIVE_HOST,
  NATIVE_PROBE_TIMEOUT_MS,
  NATIVE_FILL_TIMEOUT_MS,
  PROTOCOL_VERSION,
  makeIdentityRequest,
  makeRequest,
  makeSaveRequest,
  safeNativeResponse,
  type FillFields,
  type IdentityFieldKey,
  type IdentityFields,
  type NativeRequest,
} from '../protocol/native'
import type { Browser, NativePort } from '../platform/chrome'

const TRANSIENT_PROBE_ERRORS = new Set([
  'host-disconnected',
  'host-exited',
  'host-communication-failed',
  'native-runtime-error',
  'timeout',
])

export interface NativeProbeResult {
  ok: true
  protocolVersion: number
  capabilities: { desktopAvailable: boolean; locked: boolean; fillAvailable: boolean }
  latencyMs: number
  attempts: number
}

export interface NativeProbeFailure {
  ok: false
  code: string
  latencyMs: number
  attempts: number
}

export async function probeNativeHost(
  browser: Browser,
  options: {
    timeoutMs?: number
    signal?: AbortSignal
    attempts?: number
    retryDelayMs?: number
    sleep?: (milliseconds: number) => Promise<void>
  } = {}
): Promise<NativeProbeResult | NativeProbeFailure> {
  const timeoutMs = options.timeoutMs ?? NATIVE_PROBE_TIMEOUT_MS
  const startedAt = performance.now()
  const totalAttempts = Math.max(1, options.attempts ?? 2)
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  let result: ConnectOnceResult | ConnectOnceFailure = { ok: false, code: 'native-runtime-error' }
  let attempts = 0

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    attempts = attempt
    // Fresh request id per attempt: a delayed earlier response is never accepted.
    result = await connectOnce(browser, makeRequest('capabilities'), { timeoutMs, signal: options.signal })
    if (result.ok
      || !TRANSIENT_PROBE_ERRORS.has(result.code)
      || attempt === totalAttempts
      || options.signal?.aborted) {
      break
    }
    await sleep(options.retryDelayMs ?? 250)
  }

  const latencyMs = Math.round(performance.now() - startedAt)
  if (!result.ok) {
    return { ok: false, code: result.code, latencyMs, attempts }
  }
  if (!result.response.capabilities) {
    return { ok: false, code: 'invalid-response', latencyMs, attempts }
  }
  return {
    ok: true,
    protocolVersion: result.response.protocolVersion ?? PROTOCOL_VERSION,
    capabilities: result.response.capabilities,
    latencyMs,
    attempts,
  }
}

export interface NativeFillResult {
  ok: true
  credential: { username: string; password: string }
}

export interface NativeFillFailure {
  ok: false
  code: string
}

export type NativeActivationResult =
  | { ok: true; opened: true }
  | { ok: false; code: string }

export async function openDesktop(
  browser: Browser,
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<NativeActivationResult> {
  const result = await connectOnce(
    browser,
    makeRequest('activate'),
    { timeoutMs: options.timeoutMs ?? NATIVE_PROBE_TIMEOUT_MS, signal: options.signal }
  )
  if (!result.ok) return result
  return result.response.opened === true
    ? { ok: true, opened: true }
    : { ok: false, code: 'invalid-response' }
}

export async function requestFill(
  browser: Browser,
  origin: string,
  options: { timeoutMs?: number; signal?: AbortSignal; fields?: FillFields } = {}
): Promise<NativeFillResult | NativeFillFailure> {
  const result = await connectOnce(
    browser,
    makeRequest('fill', origin, options.fields ?? 'both'),
    { timeoutMs: options.timeoutMs ?? NATIVE_FILL_TIMEOUT_MS, signal: options.signal }
  )
  if (!result.ok) {
    return { ok: false, code: result.code }
  }
  if (!result.response.credential) {
    return { ok: false, code: 'invalid-response' }
  }
  return { ok: true, credential: result.response.credential }
}

export interface NativeIdentityResult {
  ok: true
  identity: IdentityFields
}

export interface NativeIdentityFailure {
  ok: false
  code: string
}

export async function requestIdentityFill(
  browser: Browser,
  origin: string,
  fields: readonly IdentityFieldKey[],
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<NativeIdentityResult | NativeIdentityFailure> {
  const result = await connectOnce(
    browser,
    makeIdentityRequest(origin, fields),
    { timeoutMs: options.timeoutMs ?? NATIVE_FILL_TIMEOUT_MS, signal: options.signal }
  )
  if (!result.ok) {
    return { ok: false, code: result.code }
  }
  if (!result.response.identity) {
    return { ok: false, code: 'invalid-response' }
  }
  return { ok: true, identity: result.response.identity }
}

export interface NativeSaveResult {
  ok: true
}

export interface NativeSaveFailure {
  ok: false
  code: string
}

export async function requestSave(
  browser: Browser,
  origin: string,
  payload: { password: string; kind: 'new' | 'update'; title?: string; username?: string },
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<NativeSaveResult | NativeSaveFailure> {
  const result = await connectOnce(
    browser,
    makeSaveRequest(origin, payload.password, payload.kind, { title: payload.title, username: payload.username }),
    { timeoutMs: options.timeoutMs ?? NATIVE_FILL_TIMEOUT_MS, signal: options.signal }
  )
  if (!result.ok) {
    return { ok: false, code: result.code }
  }
  return result.response.saved === true ? { ok: true } : { ok: false, code: 'invalid-response' }
}

interface ConnectOnceResult {
  ok: true
  response: {
    protocolVersion?: number
    capabilities?: { desktopAvailable: boolean; locked: boolean; fillAvailable: boolean }
    opened?: true
    credential?: { username: string; password: string }
    identity?: IdentityFields
    saved?: true
  }
}

interface ConnectOnceFailure {
  ok: false
  code: string
}

export function connectOnce(
  browser: Browser,
  request: NativeRequest,
  options: { timeoutMs: number; signal?: AbortSignal }
): Promise<ConnectOnceResult | ConnectOnceFailure> {
  return new Promise((resolve) => {
    let timeout: ReturnType<typeof setTimeout> | undefined
    let finished = false
    let port: NativePort | undefined

    function finish(code: string, response?: ConnectOnceResult['response']) {
      if (finished) return
      finished = true
      if (timeout !== undefined) clearTimeout(timeout)
      try {
        options.signal?.removeEventListener('abort', onAbort)
      } catch { /* noop */ }
      try {
        port?.disconnect()
      } catch { /* noop */ }
      if (response) {
        resolve({ ok: true, response })
      } else {
        resolve({ ok: false, code })
      }
    }

    function onAbort() {
      finish('cancelled')
    }

    if (options.signal?.aborted) {
      finish('cancelled')
      return
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    try {
      port = browser.runtime.connectNative(NATIVE_HOST)
    } catch (error) {
      // Keep only the classified code; the raw message can carry local host details.
      return finish(classifyRuntimeError(browser.runtime.lastError ?? error))
    }

    if (browser.runtime.lastError) {
      return finish(classifyRuntimeError(browser.runtime.lastError))
    }

    if (!port?.onMessage || !port.onDisconnect || typeof port.postMessage !== 'function') {
      return finish('native-runtime-error')
    }

    port.onDisconnect.addListener(() => {
      if (!finished) {
        finish(browser.runtime.lastError ? classifyRuntimeError(browser.runtime.lastError) : 'host-disconnected')
      }
    })

    port.onMessage.addListener((raw) => {
      const response = safeNativeResponse(raw, request)
      if (!response.ok) {
        return finish(response.code)
      }
      if (response.ok && 'credential' in response) {
        return finish('ok', { credential: response.credential })
      }
      if (response.ok && 'capabilities' in response) {
        return finish('ok', {
          protocolVersion: response.protocolVersion,
          capabilities: response.capabilities,
        })
      }
      if (response.ok && 'opened' in response) {
        return finish('ok', { opened: true })
      }
      if (response.ok && 'identity' in response) {
        return finish('ok', { identity: response.identity })
      }
      if (response.ok && 'saved' in response) {
        return finish('ok', { saved: true })
      }
      finish('invalid-response')
    })

    timeout = setTimeout(() => finish('timeout'), options.timeoutMs)

    try {
      port.postMessage(request)
    } catch {
      finish('host-communication-failed')
    }
  })
}

function classifyRuntimeError(error: unknown): string {
  const message = typeof error === 'object' && error !== null && 'message' in error
    && typeof (error as { message?: unknown }).message === 'string'
    ? (error as { message: string }).message
    : ''
  const text = message.toLowerCase()
  if (text.includes('not found') || text.includes('does not exist')) return 'host-not-found'
  if (text.includes('forbidden') || text.includes('invalid name')) return 'host-forbidden'
  if (text.includes('exited') || text.includes('terminated')) return 'host-exited'
  if (text.includes('disconnect')) return 'host-disconnected'
  if (text.includes('communication') || text.includes('broken pipe')) return 'host-communication-failed'
  return 'native-runtime-error'
}
