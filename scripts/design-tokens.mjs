import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(root, 'design', 'tokens.css')
const target = join(root, 'src', 'content', 'overlay-tokens.ts')
const OVERLAY_TOKENS = [
  'font-ui',
  'font-display',
  'surface',
  'text-heading',
  'text-muted',
  'text-faint',
  'border',
  'border-strong',
  'accent',
  'accent-hover',
  'on-accent',
  'gold',
  'gold-mark-text',
  'radius-sm',
  'radius-md',
  'shadow-pop',
]

function declarations(block) {
  const found = new Map()
  for (const match of block.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    found.set(match[1], match[2].trim())
  }
  return found
}

function block(css, pattern) {
  const start = css.search(pattern)
  if (start < 0) throw new Error(`design/tokens.css has no block matching ${pattern}`)
  const open = css.indexOf('{', start)
  let depth = 0
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    else if (css[index] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, index)
    }
  }
  throw new Error(`unterminated block matching ${pattern}`)
}

function collect() {
  const css = readFileSync(source, 'utf8')
  const light = declarations(block(css, /^:root \{/m))
  const dark = declarations(block(css, /^:root\[data-theme="dark"\] \{/m))
  const missing = OVERLAY_TOKENS.filter((name) => !light.has(name))
  if (missing.length > 0) {
    throw new Error(`design/tokens.css is missing overlay tokens: ${missing.join(', ')}`)
  }
  const pick = (map, fallback) => OVERLAY_TOKENS
    .map((name) => `  --${name}: ${map.get(name) ?? fallback.get(name)};`)
    .join('\n')
  return { light: pick(light, light), dark: pick(dark, light) }
}

function render({ light, dark }) {
  const indentedDark = dark.split('\n').map((line) => `  ${line}`).join('\n')
  return `// GENERATED FILE. Do not edit.
//
// Written from design/tokens.css. Run \`npm run design:tokens:sync\`;
// \`npm run design:tokens:check\` fails when stale. The overlay's shadow
// host sets \`all:initial\`, so it needs this bounded copy.

export const OVERLAY_TOKEN_CSS = \`:host {
${light}
}

@media (prefers-color-scheme: dark) {
  :host {
${indentedDark}
  }
}\`
`
}

const mode = process.argv[2]
const expected = render(collect())
if (mode === 'sync') {
  writeFileSync(target, expected)
  console.log('design tokens: wrote src/content/overlay-tokens.ts')
} else if (mode === 'check') {
  let actual
  try {
    actual = readFileSync(target, 'utf8')
  } catch {
    console.error('design tokens: overlay-tokens.ts is missing. Run npm run design:tokens:sync.')
    process.exit(1)
  }
  if (actual !== expected) {
    console.error('design tokens: overlay-tokens.ts does not match design/tokens.css. Run npm run design:tokens:sync.')
    process.exit(1)
  }
  console.log('design tokens: overlay-tokens.ts matches the extension snapshot')
} else {
  console.error('Usage: node scripts/design-tokens.mjs sync|check')
  process.exit(2)
}
