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
