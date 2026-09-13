import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..', '..')
const tokens = readFileSync(resolve(root, 'design/tokens.css'), 'utf8')
const themes = [
  ['light', ':root'],
  ['system dark', ':root:not([data-theme="light"])'],
  ['explicit dark', ':root[data-theme="dark"]'],
] as const

function declarations(selector: string): Map<string, string> {
  const start = tokens.indexOf(`${selector} {`)
  expect(start).toBeGreaterThanOrEqual(0)
  const block = tokens.slice(tokens.indexOf('{', start) + 1, tokens.indexOf('}', start))
  return new Map([...block.matchAll(/--([a-z-]+):\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]))
}

function color(values: Map<string, string>, key: string, visited = new Set<string>()): string {
  expect(visited.has(key), `Circular color token ${key}`).toBe(false)
  visited.add(key)
  const value = values.get(key) ?? ''
  const alias = /^var\(--([a-z-]+)\)$/.exec(value)
  if (alias) return color(values, alias[1], visited)
  expect(value, `Missing or unsupported color token ${key}`).toMatch(/^#[a-f\d]{6}$/i)
  return value
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}

describe('keyboard focus contrast', () => {
  for (const [name, selector] of themes) {
    it(`has at least 3:1 contrast on extension backgrounds in ${name}`, () => {
      const values = new Map([...declarations(':root'), ...declarations(selector)])
      const focus = luminance(color(values, 'focus-ring'))
      for (const key of ['bg', 'surface', 'surface-inset', 'tint', 'tint-hover']) {
        const background = luminance(color(values, key))
        const ratio = (Math.max(focus, background) + 0.05) / (Math.min(focus, background) + 0.05)
        expect(ratio, `${name} focus on ${key}`).toBeGreaterThanOrEqual(3)
      }
    })
  }

  for (const page of ['popup', 'options', 'onboarding']) {
    it(`uses the contrast-tested focus token in ${page}`, () => {
      const filename = page === 'popup' ? 'app.css' : `${page}.css`
      const css = readFileSync(resolve(root, 'src', page, filename), 'utf8')
      expect(css).toMatch(/:focus-visible\s*\{\s*outline:\s*2px solid var\(--focus-ring\)/)
    })
  }
})
