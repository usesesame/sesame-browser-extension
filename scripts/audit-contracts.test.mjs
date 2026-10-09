import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8')

test('the check job audits dependencies after installing them', () => {
  const workflow = read('.github', 'workflows', 'ci.yml')
  const install = workflow.indexOf('- run: npm ci')
  assert.ok(install >= 0, 'the check job no longer installs the locked dependencies')

  const step = workflow.slice(install).match(/- name: Audit npm dependencies\n\s+run: (.+)\n/)
  assert.ok(step, 'the check job no longer audits npm dependencies after npm ci')
  assert.equal(
    step[1].trim(),
    'npm audit --audit-level=high',
    'the audit step no longer fails on high severity advisories',
  )
})

test('a new package release waits seven days before npm or Dependabot takes it', () => {
  assert.match(read('.npmrc'), /^min-release-age=7$/m, 'npm does not wait for a release to age')

  const entries = read('.github', 'dependabot.yml')
    .split(/^ {2}- package-ecosystem: /m)
    .slice(1)
  const cooldowns = Object.fromEntries(
    entries.map((entry) => {
      const waits = [...entry.matchAll(/^ {6}([a-z-]+):\s*(\d+)$/gm)]
      return [entry.split('\n')[0].trim(), Object.fromEntries(waits.map(([, key, days]) => [key, Number(days)]))]
    }),
  )
  assert.deepEqual(
    cooldowns,
    {
      npm: { 'default-days': 7, 'semver-major-days': 14 },
      'github-actions': { 'default-days': 7 },
    },
    'Dependabot should wait seven days for an update and fourteen for an npm major version',
  )
})
