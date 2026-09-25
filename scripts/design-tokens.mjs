import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(root, 'design', 'tokens.css')
const target = join(root, 'src', 'content', 'overlay-tokens.ts')
const DESKTOP_TOKENS_COMMIT = 'dcfb9d8713f4dcf62b0a6c3b75d3cc4f9842e2fa'
const DESKTOP_TOKENS_SHA256 = '9e87d3014fb30c16de209f7d178333e9fde354261bc5ff5bcc2abd8764582306'
const OVERLAY_TOKENS = [
  'font-ui',
  'font-display',
  'type-2',
  'type-3',
  'weight-medium',
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
  'gold-soft-bg',
  'gold-mark-text',
  'focus-ring',
  'button-edge',
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

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    if (['node_modules', 'dist', 'test-results'].includes(name)) return []
    const full = join(directory, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(css|svelte)$/.test(name) ? [full] : []
  })
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
  const digest = createHash('sha256').update(readFileSync(source)).digest('hex')
  if (digest !== DESKTOP_TOKENS_SHA256) {
    console.error(
      `design tokens: design/tokens.css no longer matches the desktop copy.\n` +
      `  desktop commit ${DESKTOP_TOKENS_COMMIT}\n` +
      `  expected sha256 ${DESKTOP_TOKENS_SHA256}\n` +
      `  actual sha256   ${digest}\n` +
      `Copy design/tokens.css from the desktop repository again and update both constants in scripts/design-tokens.mjs.`,
    )
    process.exit(1)
  }

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

  for (const retired of ['--border-input-focus', '--focus-glow', '--field-border-focus']) {
    if (readFileSync(source, 'utf8').includes(`${retired}:`)) {
      console.error(`design tokens: ${retired} is declared again. Focus is --field-ring alone; hover is --field-border-hover.`)
      process.exit(1)
    }
  }

  const overlay = readFileSync(join(root, 'src', 'content', 'overlay.ts'), 'utf8')
  if (!/import \{ OVERLAY_TOKEN_CSS \} from '\.\/overlay-tokens'/.test(overlay) || !/\$\{OVERLAY_TOKEN_CSS\}/.test(overlay)) {
    console.error('design tokens: overlay.ts must import and interpolate OVERLAY_TOKEN_CSS from ./overlay-tokens.')
    process.exit(1)
  }
  const hardcoded = overlay.match(/#[0-9a-fA-F]{6}/g)
  if (hardcoded) {
    console.error(`design tokens: overlay.ts hardcodes ${hardcoded.join(', ')}. Add the token to design/tokens.css and run npm run design:tokens:sync.`)
    process.exit(1)
  }

  const files = sourceFiles(join(root, 'src'))
  const local = declarations(readFileSync(source, 'utf8'))
  for (const file of files) for (const name of declarations(readFileSync(file, 'utf8')).keys()) local.set(name, '')

  const undefinedTokens = []
  const whiteOnTheme = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/var\(\s*--([a-z0-9-]+)\s*\)/g)) {
      if (!local.has(match[1])) undefinedTokens.push(`${relative(root, file)} uses --${match[1]}`)
    }
    for (const line of text.split('\n')) {
      if (!/color:\s*(#fff\b|#ffffff\b|white\b)/i.test(line)) continue
      if (!/background(-color)?:\s*var\(--/.test(line)) continue
      whiteOnTheme.push(`${relative(root, file)}: ${line.trim().slice(0, 90)}`)
    }
  }
  if (undefinedTokens.length) {
    console.error(`design tokens: the extension references custom properties nothing defines, so those declarations silently do not apply:\n  ${undefinedTokens.join('\n  ')}`)
    process.exit(1)
  }
  if (whiteOnTheme.length) {
    console.error(`design tokens: hardcoded white over a themed background:\n  ${whiteOnTheme.join('\n  ')}`)
    process.exit(1)
  }

  console.log('design tokens: overlay-tokens.ts matches the extension snapshot and the overlay uses it')
} else {
  console.error('Usage: node scripts/design-tokens.mjs sync|check')
  process.exit(2)
}
