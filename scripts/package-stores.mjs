import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, posix, relative, resolve } from 'node:path'
import { createZip, readZip } from './deterministic-zip.mjs'
import { verifyStoreManifest } from './store-manifest.mjs'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, process.argv[2] ?? 'store-packages')
const browsers = ['chrome', 'edge']

const read = (...parts) => readFileSync(join(root, ...parts))
const readJson = (...parts) => JSON.parse(read(...parts).toString('utf8'))
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

function collect(directory) {
  const entries = []
  for (const item of readdirSync(directory, { recursive: true, withFileTypes: true })) {
    if (!item.isFile()) continue
    const absolute = join(item.parentPath, item.name)
    entries.push({
      path: relative(directory, absolute).split(/[\\/]/).join(posix.sep),
      data: readFileSync(absolute),
    })
  }
  return entries.sort((left, right) => (left.path < right.path ? -1 : 1))
}

function componentsFromLockfile() {
  const lock = readJson('package-lock.json')
  return Object.entries(lock.packages ?? {})
    .filter(([name]) => name.startsWith('node_modules/'))
    .map(([name, entry]) => {
      const bare = name.slice('node_modules/'.length)
      return { type: 'library', name: bare, version: entry.version, purl: `pkg:npm/${bare}@${entry.version}` }
    })
    .sort((left, right) => (left.purl < right.purl ? -1 : 1))
}

const manifestPackage = readJson('package.json')
const identity = readJson('contracts', 'native-host.json')
const contract = readJson('contracts', 'browser', 'v1', 'contract.json')
const version = manifestPackage.version

rmSync(output, { recursive: true, force: true })
mkdirSync(output, { recursive: true })

const packages = []
for (const browser of browsers) {
  const directory = join(root, 'dist', browser)
  const entries = collect(directory)
  if (entries.length === 0) {
    throw new Error(`dist/${browser} is empty. Run npm run build:${browser} first.`)
  }
  const sourceMap = entries.find(({ path }) => path.endsWith('.map'))
  if (sourceMap) throw new Error(`${browser} package: ${sourceMap.path} must not be shipped.`)

  const manifestEntry = entries.find(({ path }) => path === 'manifest.json')
  if (!manifestEntry) throw new Error(`${browser} package: manifest.json is missing.`)
  const extensionId = verifyStoreManifest(
    browser,
    JSON.parse(manifestEntry.data.toString('utf8')),
    version,
    identity,
  )

  const archive = createZip(entries)
  const restored = readZip(archive)
  if (restored.length !== entries.length) throw new Error(`${browser} package: archive lost an entry.`)
  for (const [index, entry] of entries.entries()) {
    if (restored[index].path !== entry.path || !restored[index].data.equals(entry.data)) {
      throw new Error(`${browser} package: ${entry.path} does not round-trip.`)
    }
  }

  const filename = `sesame-extension-${version}-${browser}.zip`
  writeFileSync(join(output, filename), archive)
  packages.push({
    browser,
    filename,
    extensionId,
    files: entries.length,
    bytes: archive.length,
    sha256: sha256(archive),
  })
}

const components = componentsFromLockfile()
const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${sha256(read('package-lock.json')).slice(0, 32)}`,
  version: 1,
  metadata: { component: { type: 'application', name: manifestPackage.name, version } },
  components,
}
const sbomFilename = `sesame-extension-${version}.cdx.json`
writeFileSync(join(output, sbomFilename), `${JSON.stringify(sbom, null, 2)}\n`)

const record = {
  schemaVersion: 1,
  product: 'sesame-browser-extension',
  version,
  protocolVersion: contract.protocolVersion,
  hostCompatibility: contract.compatibility,
  nativeHostName: identity.host_name,
  packages,
  sbom: { filename: sbomFilename, components: components.length, lockfileSha256: sha256(read('package-lock.json')) },
  reproducible: 'Entry order, timestamps, and file modes are fixed. The same commit and Node version rebuild the same digests.',
}
writeFileSync(join(output, 'store-release.json'), `${JSON.stringify(record, null, 2)}\n`)

for (const entry of packages) {
  console.log(`${entry.filename}  ${entry.files} files  ${entry.bytes} bytes  sha256:${entry.sha256}`)
}
console.log(`Wrote ${packages.length} store packages and ${components.length} locked components to ${relative(root, output)}/`)
