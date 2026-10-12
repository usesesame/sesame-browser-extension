import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readZip } from './deterministic-zip.mjs'
import { compareArchiveEntries } from './store-zip-compare.mjs'

const root = resolve(import.meta.dirname, '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const valueOptions = ['--zip', '--browser', '--revision', '--work-dir']
const flagOptions = ['--keep']

export function parseStoreZipOptions(args) {
  const parsed = { zipPath: undefined, browser: 'chrome', revision: 'HEAD', workRoot: undefined, keep: false }
  const declared = [...valueOptions, ...flagOptions]
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index]
    if (name === '--keep') {
      parsed.keep = true
      continue
    }
    if (!valueOptions.includes(name)) throw new Error(`unknown argument ${name}`)
    const value = args[index + 1]
    if (value === undefined || declared.includes(value)) throw new Error(`${name} needs a value`)
    index += 1
    if (name === '--zip') parsed.zipPath = value
    if (name === '--browser') parsed.browser = value
    if (name === '--revision') parsed.revision = value
    if (name === '--work-dir') parsed.workRoot = value
  }
  return parsed
}

function rebuildAndCompare({ zipPath, browser, worktree }) {
  const packages = join(worktree, 'rebuilt-packages')
  execFileSync(npm, ['ci'], { cwd: worktree, stdio: 'inherit' })
  for (const target of ['chrome', 'edge', 'firefox']) {
    execFileSync(npm, ['run', `build:${target}`], { cwd: worktree, stdio: 'inherit' })
  }
  execFileSync(npm, ['run', 'package:stores', '--', packages], { cwd: worktree, stdio: 'inherit' })

  const rebuiltName = readdirSync(packages).find((name) => name.endsWith(`-${browser}.zip`))
  if (!rebuiltName) throw new Error(`the rebuild produced no ${browser} package`)

  const downloaded = readZip(readFileSync(resolve(zipPath)))
  const rebuilt = readZip(readFileSync(join(packages, rebuiltName)))
  return { rebuilt, differences: compareArchiveEntries(downloaded, rebuilt) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const usage =
    'Usage: node scripts/check-store-zip.mjs --zip <store zip> [--browser chrome|edge|firefox] [--revision <git ref>] [--work-dir <dir>] [--keep]'
  let options
  try {
    options = parseStoreZipOptions(process.argv.slice(2))
  } catch (error) {
    console.error(`${error.message}\n${usage}`)
    process.exit(2)
  }
  const { zipPath, browser, revision, workRoot, keep } = options

  if (!zipPath || !['chrome', 'edge', 'firefox'].includes(browser)) {
    console.error(usage)
    process.exit(2)
  }

  const worktree = workRoot ?? mkdtempSync(join(tmpdir(), 'sesame-store-zip-'))
  let registered = false
  let failure = null
  try {
    execFileSync('git', ['worktree', 'add', '--detach', worktree, revision], { cwd: root, stdio: 'inherit' })
    registered = true
    const { rebuilt, differences } = rebuildAndCompare({ zipPath, browser, worktree })
    if (differences.length === 0) {
      console.log(`${resolve(zipPath)} matches the ${browser} package rebuilt from ${revision} (${rebuilt.length} files).`)
    } else {
      console.error(`${resolve(zipPath)} does not match the ${browser} package rebuilt from ${revision}:`)
      for (const difference of differences) console.error(`  ${difference.path}: ${difference.kind}`)
      failure = new Error(`${differences.length} file(s) differ`)
    }
  } finally {
    if (!keep && !workRoot) {
      if (registered) {
        spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd: root, stdio: 'inherit' })
      }
      rmSync(worktree, { recursive: true, force: true })
    }
  }
  if (failure) process.exit(1)
}
