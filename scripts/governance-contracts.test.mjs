import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8')

const workflows = readdirSync(join(root, '.github', 'workflows'))
  .filter((name) => name.endsWith('.yml'))
  .map((name) => join('.github', 'workflows', name))
  .sort()

test('every workflow declares permissions and pins every third-party action', () => {
  assert.ok(workflows.length >= 3, `expected this repository's workflows, found ${workflows.length}`)

  const missingPermissions = []
  const unpinned = []
  for (const workflow of workflows) {
    const body = read(workflow)
    if (!/^permissions:\s*$/m.test(body)) missingPermissions.push(workflow)
    for (const [, action] of body.matchAll(/uses:\s*([^\s#]+)/g)) {
      if (action.startsWith('./')) continue
      if (!/@[0-9a-f]{40}$/.test(action)) unpinned.push(`${workflow}: ${action}`)
    }
  }
  assert.deepEqual(missingPermissions, [], `these workflows inherit their permissions:\n  ${missingPermissions.join('\n  ')}`)
  assert.deepEqual(unpinned, [], `a moved tag would change what these runs execute:\n  ${unpinned.join('\n  ')}`)
})

test('a workflow that writes says so at the job that writes', () => {
  for (const workflow of workflows) {
    const body = read(workflow)
    const header = body.slice(0, body.indexOf('\njobs:'))
    assert.match(
      header,
      /^permissions:\s*\n\s+contents: read\s*$/m,
      `${workflow} should default to contents: read at the top and widen per job`,
    )
  }
  const release = read('.github', 'workflows', 'release.yml')
  assert.match(release, /environment: store-release/, 'the package job should run behind its protected environment')

  for (const workflow of workflows) {
    assert.doesNotMatch(
      read(workflow),
      /permissions:\s*(read-all|write-all)/,
      `${workflow} must name scopes explicitly rather than grant every scope`,
    )
  }
})

test('every job a workflow depends on exists in that workflow', () => {
  for (const workflow of workflows) {
    const body = read(workflow)
    const names = new Set([...body.matchAll(/^ {2}([a-z0-9_-]+):$/gm)].map(([, name]) => name))
    for (const [, list] of body.matchAll(/^\s+needs:\s*(.+)$/gm)) {
      for (const name of list.replaceAll('[', ' ').replaceAll(']', ' ').split(',')) {
        const job = name.trim()
        if (!job) continue
        assert.ok(names.has(job), `${workflow} requires job ${job}, which the workflow does not define`)
      }
    }
  }
})

test('review routing names paths that exist in this repository', () => {
  const owners = read('.github', 'CODEOWNERS')
  assert.match(owners, /^\*\s+@/m, 'the repository has no default owner')
  for (const control of ['/.github/', '/package.json', '/package-lock.json']) {
    assert.ok(owners.includes(control), `the repository does not route ${control}`)
  }
  for (const [, routed] of owners.matchAll(/^(\/[^\s#]+)/gm)) {
    assert.ok(
      existsSync(join(root, routed.slice(1))),
      `CODEOWNERS routes ${routed}, which does not exist in this repository`,
    )
  }
})

test('every dependency ecosystem this repository uses is updated', () => {
  const body = read('.github', 'dependabot.yml')
  for (const ecosystem of ['npm', 'github-actions']) {
    assert.match(body, new RegExp(`package-ecosystem: ${ecosystem}\\b`), `dependabot does not update ${ecosystem}`)
  }
})

test('the security policy tells a reporter where to send a vulnerability', () => {
  assert.ok(statSync(join(root, 'SECURITY.md')).isFile())
  const body = read('SECURITY.md')
  assert.match(body, /Do not open a public issue/i, 'the policy does not say to report privately')
  assert.match(body, /Report a vulnerability/, 'the policy does not name the private reporting route')
  assert.match(body, /## Scope/, 'the policy has no scope, so a reporter cannot tell what counts')
  assert.match(body, /extension/i, 'the policy is not scoped to this product')
})

test('store releases require the desktop main contract before packaging', () => {
  const workflow = read('.github', 'workflows', 'release.yml')
  const compatibility = workflow.indexOf('run: npm run compat:host')
  const release = workflow.indexOf('run: npm run ci')
  assert.ok(compatibility >= 0 && release > compatibility)
  assert.doesNotMatch(workflow, /--candidate/)
  const checker = read('scripts', 'host-compatibility.mjs')
  assert.match(checker, /options\.candidate && publication\.requiresDesktopMerge === true/)
  assert.match(checker, /publication\.trackingRef \?\? 'main'/)
})

const contractDirectories = readdirSync(join(root, 'contracts', 'browser'))
  .filter((name) => /^v\d+$/.test(name))
  .sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)))
const highestContract = contractDirectories.at(-1)

test('no vendored contract still waits on a desktop merge', () => {
  const waiting = contractDirectories.filter((directory) => {
    const source = JSON.parse(read('contracts', 'browser', directory, 'SOURCE.json'))
    return source.publication?.requiresDesktopMerge !== undefined
  })
  assert.deepEqual(waiting, [], `these contracts still carry requiresDesktopMerge:\n  ${waiting.join('\n  ')}`)
})

test('every document that lists the browser contracts reaches the highest vendored version', () => {
  const highest = Number(highestContract.slice(1))
  for (const document of ['DESIGN.md', 'CONTRIBUTING.md', 'SECURITY.md']) {
    const named = [...read(document).matchAll(/contracts\/browser\/v(\d+)\//g)].map(([, version]) => Number(version))
    assert.ok(named.length > 0, `${document} does not name a vendored contract directory`)
    assert.equal(Math.max(...named), highest, `${document} names contracts up to v${Math.max(...named)} but contracts/browser holds v${highest}`)
  }
  const readme = read('README.md')
  for (let version = 1; version <= highest; version += 1) {
    assert.match(readme, new RegExp(`[Vv]ersion ${version}\\b`), `README.md does not describe contract version ${version}`)
  }
})

test('the documents agree with the README on the supported platforms', () => {
  const readme = read('README.md')
  const platforms = ['Windows', 'Linux']
  for (const platform of platforms) {
    assert.match(readme, new RegExp(platform), `README.md does not name ${platform}`)
    assert.match(read('DESIGN.md'), new RegExp(platform), `DESIGN.md does not name ${platform}`)
  }
  assert.doesNotMatch(read('DESIGN.md'), /Windows integration|Chrome and Edge on Windows\.\s/, 'DESIGN.md describes a Windows only product')
})

test('the documents describe the Firefox package that the manifests build', () => {
  assert.ok(existsSync(join(root, 'manifests', 'firefox.json')))
  for (const document of ['README.md', 'SECURITY.md', 'DESIGN.md']) {
    const body = read(document)
    assert.match(body, /Firefox/, `${document} does not mention Firefox`)
    assert.doesNotMatch(body, /Firefox is not supported/, `${document} says Firefox is not supported while a package builds`)
    assert.doesNotMatch(body, /separate manifest/, `${document} says Firefox needs a separate manifest, which manifests/firefox.json already is`)
  }
  assert.match(read('SECURITY.md'), /experimental Firefox package/)
})

test('the documents state the desktop version the capability probe needs', () => {
  for (const document of ['README.md', 'SECURITY.md', 'DESIGN.md']) {
    assert.match(read(document), /desktop (app of version |)0\.3\.0 or later/, `${document} does not say the extension needs desktop 0.3.0 or later`)
  }
})
