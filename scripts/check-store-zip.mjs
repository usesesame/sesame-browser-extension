import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readZip } from './deterministic-zip.mjs'
import { compareArchiveEntries } from './store-zip-compare.mjs'

const root = resolve(import.meta.dirname, '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function option(args, name, fallback) {
  const index = args.indexOf(name)
  return index === -1 ? fallback : args[index + 1]
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
  const args = process.argv.slice(2)
  const zipPath = option(args, '--zip')
  const browser = option(args, '--browser', 'chrome')
  const revision = option(args, '--revision', 'HEAD')
  const workRoot = option(args, '--work-dir')
  const keep = args.includes('--keep')

  if (!zipPath || !['chrome', 'edge', 'firefox'].includes(browser)) {
    console.error(
      'Usage: node scripts/check-store-zip.mjs --zip <store zip> [--browser chrome|edge|firefox] [--revision <git ref>] [--work-dir <dir>] [--keep]',
    )
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
