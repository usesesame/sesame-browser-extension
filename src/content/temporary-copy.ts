export interface ClipboardAccess {
  writeText(value: string): Promise<void>
  readText?(): Promise<string>
}

export interface TemporaryCopyHandle {
  clear(): Promise<void>
  cancel(): void
}

export async function copyTemporarily(
  value: string,
  options: {
    clipboard?: ClipboardAccess
    lifetimeMs?: number
    schedule?: typeof setTimeout
    cancelSchedule?: typeof clearTimeout
    onExpired?: () => void
  } = {},
): Promise<TemporaryCopyHandle> {
  if (!value) throw new TypeError('temporary copy requires a value')
  const clipboard = options.clipboard ?? navigator.clipboard
  const schedule = options.schedule ?? setTimeout
  const cancelSchedule = options.cancelSchedule ?? clearTimeout
  await clipboard.writeText(value)

  let secret: string | undefined = value
  let timer: ReturnType<typeof setTimeout> | undefined
  const clear = async () => {
    if (!secret) return
    const expected = secret
    secret = undefined
    if (timer !== undefined) cancelSchedule(timer)
    timer = undefined
    try {
      // Never erase clipboard content the user copied after the password.
      if (clipboard.readText && await clipboard.readText() === expected) {
        await clipboard.writeText('')
      }
    } catch {
      /* ignored */
    } finally {
      options.onExpired?.()
    }
  }
  timer = schedule(() => { void clear() }, options.lifetimeMs ?? 30_000)
  return {
    clear,
    cancel() {
      if (timer !== undefined) cancelSchedule(timer)
      timer = undefined
      secret = undefined
      options.onExpired?.()
    },
  }
}
