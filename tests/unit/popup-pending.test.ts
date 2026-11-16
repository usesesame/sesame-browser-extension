import { describe, expect, it } from 'vitest'
import { createRevisionGate } from '../../src/popup/pending-revision'
import { generatedMessage } from '../../src/popup/generated-messages'

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('popup pending state', () => {
  it('drops a pending query that started before a newer update', async () => {
    const gate = createRevisionGate()
    const reply = deferred<string | null>()

    const older = gate.read(() => reply.promise)
    gate.advance()
    reply.resolve(null)

    await expect(older).resolves.toEqual({ current: false })
  })

  it('drops a pending query that a later query replaced', async () => {
    const gate = createRevisionGate()
    const first = deferred<string | null>()
    const second = deferred<string | null>()

    const older = gate.read(() => first.promise)
    const newer = gate.read(() => second.promise)
    second.resolve('new')
    first.resolve(null)

    await expect(newer).resolves.toEqual({ current: true, value: 'new' })
    await expect(older).resolves.toEqual({ current: false })
  })

  it('applies a pending query when nothing changed meanwhile', async () => {
    const gate = createRevisionGate()
    await expect(gate.read(async () => 'change')).resolves.toEqual({ current: true, value: 'change' })
  })

  it('does not promise that a cancelled request changed nothing', () => {
    const message = generatedMessage({ ok: false, code: 'cancelled' })
    expect(message).toBe('The request was cancelled, so check Sesame in case the password was already saved.')
    expect(message).not.toMatch(/Nothing was changed/)
  })
})
