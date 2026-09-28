import { describe, expect, it } from 'vitest'
import { publicFillResult } from '../../src/background/fill-result'

describe('public fill result', () => {
  it('keeps the stored host on a lookalike warning', () => {
    expect(publicFillResult({ phase: { name: 'failed', code: 'lookalike-domain', lookalike: 'apple.example' } }))
      .toEqual({ state: 'unavailable', code: 'lookalike-domain', lookalike: 'apple.example' })
  })

  it('keeps an ordinary failure free of a lookalike host', () => {
    expect(publicFillResult({ phase: { name: 'failed', code: 'no-match' } }))
      .toEqual({ state: 'unavailable', code: 'no-match' })
  })
})
