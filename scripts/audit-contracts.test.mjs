import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8')

test('the check job audits dependencies through the same command a contributor runs', () => {
  const workflow = read('.github', 'workflows', 'ci.yml')
  const install = workflow.indexOf('- run: npm ci')
  assert.ok(install >= 0, 'the check job no longer installs the locked dependencies')

  assert.match(workflow.slice(install), /^\s+run: npm run verify$/m, 'the check job no longer runs the command a contributor runs before review')
  assert.doesNotMatch(workflow, /^\s+run: node scripts\/audit-dependencies\.mjs$/m, 'the audit runs only through npm run verify')

  const scripts = JSON.parse(read('package.json')).scripts
  assert.equal(
    scripts.verify,
    'npm run ci && node scripts/audit-dependencies.mjs',
    'npm run verify no longer builds every shipped package and then audits what they bundled, so a local pass can differ from the pull request check',
  )

  const manifest = JSON.parse(read('package.json'))
  const builds = manifest.scripts['release:check']
  for (const browser of ['chrome', 'edge', 'firefox']) {
    assert.ok(builds.includes(`npm run build:${browser}`), `release:check no longer builds the ${browser} package`)
    for (const part of ['app', 'content', 'overlay']) {
      assert.ok(manifest.shippedBuilds.includes(`${part}-${browser}`), `the audit no longer requires a record of the ${part}-${browser} build`)
    }
  }
  assert.ok(manifest.scripts.ci.includes('npm run release:check'), 'the ci script no longer runs the shipped builds')
  for (const [config, part] of [['vite.config.ts', 'app'], ['vite.content.config.ts', 'content'], ['vite.overlay.config.ts', 'overlay']]) {
    assert.ok(read(config).includes(`shippedPackages(\`${part}-\${mode}\`)`), `${config} no longer records which packages its build bundles`)
  }
})

test('npm installs run no package scripts and fetch no git dependencies', () => {
  const policy = read('.npmrc').split(/\r?\n/)
  for (const line of ['ignore-scripts=true', 'allow-git=none']) {
    assert.ok(policy.includes(line), `.npmrc no longer pins ${line}`)
  }
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
