import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..', '..')
const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8')

describe('unpacked install guide', () => {
  const guide = read('LOAD-UNPACKED.md')
  const build = read('vite.config.ts')

  it('sends the reader to a built folder, not the source tree', () => {
    expect(guide).toMatch(/dist\/chrome/)
    expect(guide).toMatch(/dist\/edge/)
  })

  it('names the folders the build actually writes', () => {
    expect(build).toMatch(/outDir:\s*`dist\/\$\{mode\}`/)
    expect(build).toMatch(/fileName:\s*'manifest\.json'/)
  })
})
