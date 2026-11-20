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

const jobBlock = (body, job) => {
  const start = body.indexOf(`\n  ${job}:\n`)
  assert.ok(start >= 0, `the ${job} job is missing from the workflow`)
  const rest = body.slice(start + 1)
  const afterFirst = rest.indexOf('\n') + 1
  const next = rest.slice(afterFirst).match(/^ {2}[a-z0-9_-]+:$/m)
  return next ? rest.slice(0, afterFirst + next.index) : rest
}

test('the store packages are built apart from the test browser and attested after every check', () => {
  const workflow = read('.github', 'workflows', 'release.yml')
  assert.doesNotMatch(workflow, /^\s+cache:/m, 'a release restores no package cache that another run could have written')

  const packaging = jobBlock(workflow, 'package')
  assert.match(packaging, /run: npm run release:check$/m, 'the package job builds the store packages')
  assert.doesNotMatch(packaging, /playwright|test:browser|npm run ci\b/, 'the job that builds the store packages must not install or run the test browser')
  assert.doesNotMatch(packaging, /id-token|attestations:/, 'the package job must not be able to sign')

  const browser = jobBlock(workflow, 'browser')
  assert.match(browser, /run: npm run test:browser$/m, 'the browser suite still runs before a release')
  assert.doesNotMatch(browser, /environment:|id-token|upload-artifact/, 'the browser job holds no environment, no signing identity and uploads nothing')

  const attest = jobBlock(workflow, 'attest')
  assert.match(attest, /needs: \[package, browser\]/, 'packages are attested only after both jobs pass')
  assert.match(attest, /EXPECTED_RECORD_SHA256: \$\{\{ needs\.package\.outputs\.record-sha256 \}\}/, 'the attest job checks the record the package job wrote')
  assert.ok(attest.indexOf('Re-hash every package') < attest.indexOf('uses: actions/attest@'), 'the packages are re-hashed before they are attested')
  assert.match(attest, /subject-path: store-packages\/\*\.zip$/m, 'every store zip is attested')
  assert.doesNotMatch(attest, /npm (ci|install)|actions\/checkout@/, 'the attest job runs no repository or registry code')
})

test('only the publish job can write to the repository and it publishes checked files after attestation', () => {
  const workflow = read('.github', 'workflows', 'release.yml')
  for (const job of ['package', 'browser', 'attest']) {
    assert.doesNotMatch(jobBlock(workflow, job), /contents: write/, `the ${job} job must not write to the repository`)
  }
  const publish = jobBlock(workflow, 'publish')
  assert.match(publish, /needs: \[package, attest\]/, 'a release is published only after the packages are attested')
  assert.match(publish, /if: startsWith\(github\.ref, 'refs\/tags\/v'\)/, 'only a version tag publishes a release')
  assert.match(publish, /permissions:\s*\n\s+contents: write\s*\n/, 'the publish job asks for contents: write and nothing else')
  assert.doesNotMatch(publish, /id-token|attestations:|environment:/, 'the publish job cannot sign')
  assert.doesNotMatch(publish, /npm (ci|install)|actions\/checkout@/, 'the publish job runs no repository or registry code')
  assert.match(publish, /EXPECTED_RECORD_SHA256: \$\{\{ needs\.package\.outputs\.record-sha256 \}\}/, 'the publish job checks the record the package job wrote')
  const rehash = publish.indexOf('digest(`store-packages/${entry.filename}`) !== entry.sha256')
  const create = publish.indexOf('gh release create')
  assert.ok(rehash >= 0 && create > rehash, 'every package is re-hashed before the release is created')
  assert.match(publish, /gh release create "\$TAG" --repo "\$GITHUB_REPOSITORY" --verify-tag --draft --prerelease/, 'the release waits as a draft pre-release for a person to check and publish it')
})

test('store releases require the desktop main contract before packaging', () => {
  const workflow = read('.github', 'workflows', 'release.yml')
  const compatibility = workflow.indexOf('run: npm run compat:host')
  const release = workflow.indexOf('run: npm run release:check')
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

test('the documents state the first desktop release that trusts the store copy', () => {
  for (const document of ['README.md', 'SECURITY.md', 'DESIGN.md']) {
    assert.match(read(document), /desktop (app of version |)0\.4\.1 or later/, `${document} does not say the extension needs desktop 0.4.1 or later`)
    assert.doesNotMatch(read(document), /desktop (app of version |)0\.3\.0 or later/, `${document} still names 0.3.0, which does not trust the Chrome Web Store copy`)
  }
})

const jobNames = (body) => {
  const jobs = body.slice(body.indexOf('\njobs:'))
  return [...jobs.matchAll(/^ {2}([a-z0-9_-]+):$/gm)].map(([, name]) => name)
}

test('every job stops after a bounded time', () => {
  for (const workflow of workflows) {
    const body = read(workflow)
    const names = jobNames(body)
    assert.ok(names.length > 0, `${workflow} defines no jobs`)
    for (const name of names) {
      const limit = jobBlock(body, name).match(/^ {4}timeout-minutes: (\d+)$/m)
      assert.ok(limit, `${workflow} job ${name} has no timeout-minutes, so a hung run holds a runner for six hours`)
      assert.ok(Number(limit[1]) >= 1 && Number(limit[1]) <= 60, `${workflow} job ${name} has a timeout of ${limit[1]} minutes outside 1 to 60`)
    }
  }
})

test('the CI workflow checks out without credentials and runs the command a contributor runs', () => {
  const workflow = read('.github', 'workflows', 'ci.yml')
  const check = jobBlock(workflow, 'check')
  assert.doesNotMatch(check, /^ {4}name:/m, 'the release gate looks the job up by the name check')
  assert.match(check, /actions\/checkout@[0-9a-f]{40} # [^\n]+\n\s+with:\n\s+persist-credentials: false\n/, 'no later step needs the checkout token, so the checkout must not keep it')
  assert.match(check, /run: npm run verify$/m, 'the check job runs npm run verify')
  assert.doesNotMatch(check, /GITHUB_TOKEN|github\.token|secrets\./, 'the check job holds no token for a persisted credential to matter')

  const scripts = JSON.parse(read('package.json')).scripts
  assert.ok(scripts.ci.indexOf('npm run test:packaged') > scripts.ci.indexOf('npm run release:check'), 'the packaged extension is tested after the store packages are built')
  assert.ok(scripts.ci.indexOf('npm run test:packaged') < scripts.ci.indexOf('npm run test:browser'), 'npm run ci runs the packaged extension test')
  assert.match(read('CONTRIBUTING.md'), /Run `npm run verify` before you ask for review/, 'CONTRIBUTING.md does not tell contributors to run npm run verify')
})

test('a release tag needs a commit on main whose CI check passed, and only the package job can ask', () => {
  const workflow = read('.github', 'workflows', 'release.yml')
  const packaging = jobBlock(workflow, 'package')
  const stepStart = packaging.indexOf('- name: Require a tagged commit on main that passed the CI check')
  assert.ok(stepStart >= 0, 'the package job no longer requires tested code before it builds')
  const nextStep = packaging.indexOf('\n      - ', stepStart + 1)
  const step = packaging.slice(stepStart, nextStep)

  assert.match(step, /if: startsWith\(github\.ref, 'refs\/tags\/'\)/, 'the step guards a tag release')
  assert.match(step, /GH_TOKEN: \$\{\{ github\.token \}\}/, 'the step uses the job token')
  assert.match(step, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/, 'the step requires the tagged commit to be on main')
  assert.match(step, /workflows\/ci\.yml\/runs\?head_sha=\$GITHUB_SHA&event=push&branch=main/, 'the step looks up the CI run for the tagged commit on main')
  assert.match(step, /select\(\.name == "check"\)/, 'the step reads the check job of the CI workflow')
  assert.match(step, /grep -qx success/, 'only a successful check job passes')
  assert.match(step, /Wait for it to pass on main, then rerun this workflow\./, 'a missing or running check tells the maintainer to wait and rerun')
  assert.ok(step.trimEnd().endsWith('exit 1'), 'a check that is missing, running or failed fails the release')
  assert.ok(stepStart < packaging.indexOf('run: npm run compat:host'), 'tested code is required before the desktop contracts are downloaded')
  assert.ok(stepStart < packaging.indexOf('run: npm run release:check'), 'tested code is required before the packages are built')

  assert.match(packaging, /permissions:\s*\n\s+contents: read\s*\n\s+actions: read\s*\n\s+outputs:/, 'the package job reads workflow runs and nothing more')
  assert.match(packaging, /actions\/checkout@[0-9a-f]{40} # [^\n]+\n\s+with:\n\s+persist-credentials: false\n\s+fetch-depth: 0\n/, 'the package job fetches main without keeping the token')
  for (const job of ['browser', 'attest', 'publish']) {
    assert.doesNotMatch(jobBlock(workflow, job), /actions: (read|write)/, `the ${job} job must not read workflow runs`)
  }

  const ci = read('.github', 'workflows', 'ci.yml')
  assert.match(ci, /^name: Browser extension CI$/m)
  assert.match(ci, /^ {2}check:$/m, 'the release step looks up a job named check in ci.yml')
})

test('the release runs each suite once and tests the package it attests', () => {
  const workflow = read('.github', 'workflows', 'release.yml')
  const packaging = jobBlock(workflow, 'package')
  assert.equal([...workflow.matchAll(/npm run test:compat/g)].length, 0, 'npm run compat:host already runs the compatibility suite in the package job')
  assert.match(packaging, /run: npm run compat:host$/m)

  const browser = jobBlock(workflow, 'browser')
  assert.match(browser, /needs: \[package\]/, 'the browser job waits for the packages it tests')
  assert.match(browser, /actions\/download-artifact@[0-9a-f]{40} # [^\n]+\n\s+with:\n\s+name: \$\{\{ needs\.package\.outputs\.artifact-name \}\}\n\s+path: store-packages\n/, 'the browser job tests the artifact the package job uploaded')
  const packaged = browser.indexOf('run: npm run test:packaged')
  assert.ok(packaged > browser.indexOf('actions/download-artifact@'), 'the package is downloaded before it is tested')
  assert.ok(packaged >= 0 && packaged < browser.indexOf('run: npm run test:browser'), 'the packaged extension is loaded in the browser job')
})
