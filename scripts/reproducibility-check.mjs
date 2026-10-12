import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const outputs = [mkdtempSync(join(tmpdir(), 'sesame-package-a-')), mkdtempSync(join(tmpdir(), 'sesame-package-b-'))]

try {
  for (const output of outputs) {
    execFileSync(npm, ['run', 'package:stores', '--', output], { cwd: root, stdio: 'inherit' })
  }

  const firstNames = new Set(readdirSync(outputs[0]))
  const secondNames = new Set(readdirSync(outputs[1]))
  const names = [...new Set([...firstNames, ...secondNames])].sort()
  const differences = []
  for (const name of names) {
    if (!firstNames.has(name) || !secondNames.has(name)) {
      differences.push(`${name} is missing from one run`)
      continue
    }
    if (digest(join(outputs[0], name)) !== digest(join(outputs[1], name))) differences.push(name)
  }

  if (differences.length > 0) {
    console.error(`Two packagings of the same checkout differ: ${differences.join(', ')}`)
    process.exitCode = 1
  } else {
    console.log(`Two packagings of ${names.length} files match by digest.`)
  }
} finally {
  for (const output of outputs) rmSync(output, { recursive: true, force: true })
}
