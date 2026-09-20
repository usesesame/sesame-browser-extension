import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const CONTRACT_DIRECTORIES = ['v1', 'v2']
const CONTRACT_FILES = ['contract.json', 'request.schema.json', 'response.schema.json', 'vectors.json']
const FETCH_TIMEOUT_MS = 30_000

const options = parseArguments(process.argv.slice(2))
const outputRoot = resolve(root, options.out ?? '.host-compat')
const failures = []

function parseArguments(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (!flag.startsWith('--')) throw new Error(`Unexpected argument: ${flag}`)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value.`)
    parsed[flag.slice(2)] = value
    index += 1
  }
  return parsed
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

const token = process.env.SESAME_CONTRACT_TOKEN ?? process.env.GITHUB_TOKEN

async function loadFixtures(reference, directory, source) {
  if (options.source && !options.source.startsWith('https://')) {
    return Object.fromEntries(
      CONTRACT_FILES.map((name) => [name, readFileSync(resolve(root, options.source, directory, name))]),
    )
  }
  const path = source.sourcePath
  const repository = source.publication?.repository
  if (!options.source && !repository) {
    throw new Error('SOURCE.json declares no publication.repository and no --source was given.')
  }

  const locate = (name) => {
    if (options.source) return `${options.source}/${reference}/${path}/${name}`
    return token
      ? `https://api.github.com/repos/${repository}/contents/${path}/${name}?ref=${reference}`
      : `https://raw.githubusercontent.com/${repository}/${reference}/${path}/${name}`
  }

  const entries = await Promise.all(CONTRACT_FILES.map(async (name) => {
    const url = locate(name)
    if (!url.startsWith('https://')) throw new Error(`Refusing a non-HTTPS contract source: ${url}`)
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
      headers: token
        ? { authorization: `Bearer ${token}`, accept: 'application/vnd.github.raw', 'user-agent': 'sesame-browser-extension' }
        : { 'user-agent': 'sesame-browser-extension' },
    })
    if (!response.ok) {
      throw new Error(
        `${url} returned ${response.status}. The desktop repository must publish this fixture, and a private one needs SESAME_CONTRACT_TOKEN.`,
      )
    }
    return [name, Buffer.from(await response.arrayBuffer())]
  }))
  return Object.fromEntries(entries)
}

function localProtocolVersion(constant) {
  const typescript = readFileSync(join(root, 'src', 'protocol', 'native.ts'), 'utf8')
  const match = new RegExp(`export const ${constant} = (\\d+)`).exec(typescript)
  if (!match) throw new Error(`src/protocol/native.ts does not declare ${constant}.`)
  return Number(match[1])
}

async function checkContract(directory) {
  const protocolVersion = localProtocolVersion(directory === 'v2' ? 'CARD_PROTOCOL_VERSION' : 'PROTOCOL_VERSION')
  const vendored = join(root, 'contracts', 'browser', directory)
  const source = JSON.parse(readFileSync(join(vendored, 'SOURCE.json'), 'utf8'))
  const publication = source.publication ?? {}
  const trackingRef = options.ref ?? publication.trackingRef ?? 'main'

  const pinned = await loadFixtures(source.implementationSourceCommit, directory, source)
  for (const name of CONTRACT_FILES) {
    const published = pinned[name]
    const local = readFileSync(join(vendored, name))
    if (sha256(published) !== source.files[name]) {
      failures.push(`${directory}: ${name} published bytes at ${source.implementationSourceCommit.slice(0, 7)} do not match the digest recorded in SOURCE.json.`)
    } else if (!published.equals(local)) {
      failures.push(`${directory}: ${name} vendored copy differs from the published bytes at the recorded commit.`)
    }
  }

  const tracking = await loadFixtures(trackingRef, directory, source)
  const upstream = JSON.parse(tracking['contract.json'].toString('utf8'))
  const compatibility = upstream.compatibility ?? {}
  const drifted = CONTRACT_FILES.filter((name) => !tracking[name].equals(readFileSync(join(vendored, name))))

  if (upstream.tag !== source.contractTag) {
    failures.push(`${directory}: the desktop now publishes contract tag ${upstream.tag}; this extension vendors ${source.contractTag}. Vendor the new tagged directory and set the compatibility range deliberately.`)
  }
  if (!(compatibility.minimumHostProtocolVersion <= protocolVersion && protocolVersion <= compatibility.currentHostProtocolVersion)) {
    failures.push(`${directory}: protocol version ${protocolVersion} is outside the supported host range ${compatibility.minimumHostProtocolVersion}..${compatibility.currentHostProtocolVersion}. Installed extensions would stop reaching the desktop.`)
  }
  if (!(compatibility.minimumExtensionProtocolVersion <= protocolVersion && protocolVersion <= compatibility.currentExtensionProtocolVersion)) {
    failures.push(`${directory}: the desktop only accepts extension protocol ${compatibility.minimumExtensionProtocolVersion}..${compatibility.currentExtensionProtocolVersion}; this extension speaks ${protocolVersion}.`)
  }
  if (drifted.length > 0) {
    failures.push(`${directory}: the tracking ref ${trackingRef} has moved ahead of the vendored snapshot: ${drifted.join(', ')}. Re-vendor from the desktop and update SOURCE.json.`)
  }

  const outputDirectory = join(outputRoot, directory)
  mkdirSync(outputDirectory, { recursive: true })
  for (const name of CONTRACT_FILES) writeFileSync(join(outputDirectory, name), tracking[name])
  writeFileSync(join(outputDirectory, 'DOWNLOAD.json'), `${JSON.stringify({
    checkedAt: new Date().toISOString(),
    contract: directory,
    source: options.source ?? publication.repository,
    transport: options.source ? 'explicit' : token ? 'contents-api' : 'raw',
    pinnedCommit: source.implementationSourceCommit,
    trackingRef,
    extensionProtocolVersion: protocolVersion,
    upstreamCompatibility: compatibility,
    digests: Object.fromEntries(CONTRACT_FILES.map((name) => [name, sha256(tracking[name])])),
  }, null, 2)}\n`)

  console.log(`${directory}: protocol ${protocolVersion} matches the published contract at ${source.implementationSourceCommit.slice(0, 7)} and the ${trackingRef} range ${compatibility.minimumHostProtocolVersion}..${compatibility.currentHostProtocolVersion}.`)
}

for (const directory of CONTRACT_DIRECTORIES) {
  await checkContract(directory)
}

if (failures.length > 0) {
  console.error('Host compatibility failed:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(`Downloaded fixtures are in ${options.out ?? '.host-compat'}/ for the vector replay.`)
