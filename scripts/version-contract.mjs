import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const mode = process.argv[2]
if (mode !== 'check' && mode !== 'sync') {
  console.error('Usage: node scripts/version-contract.mjs check|sync')
  process.exit(2)
}

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const paths = {
  package: join(root, 'package.json'),
  chrome: join(root, 'manifests', 'chrome.json'),
  edge: join(root, 'manifests', 'edge.json'),
}
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`, { cause: error })
  }
}

function requireVersion(value, label) {
  if (typeof value !== 'string' || !semverPattern.test(value)) {
    throw new Error(`${label} must contain a SemVer version.`)
  }
  return value
}

async function main() {
  const [packageJson, chrome, edge] = await Promise.all([
    readJson(paths.package, 'package.json'),
    readJson(paths.chrome, 'manifests/chrome.json'),
    readJson(paths.edge, 'manifests/edge.json'),
  ])
  const version = requireVersion(packageJson.version, 'package.json')
  const manifests = [
    { label: 'manifests/chrome.json', path: paths.chrome, value: chrome },
    { label: 'manifests/edge.json', path: paths.edge, value: edge },
  ]
  const stale = manifests.filter(({ label, value }) => requireVersion(value.version, label) !== version)

  if (mode === 'check' && stale.length > 0) {
    throw new Error(`Extension version ${version} is not synchronized in: ${stale.map(({ label }) => label).join(', ')}. Run npm run version:sync.`)
  }
  if (mode === 'sync') {
    await Promise.all(stale.map(async ({ path, value }) => {
      value.version = version
      await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    }))
  }

  console.log(
    mode === 'sync' && stale.length > 0
      ? `Synchronized extension version ${version} in ${stale.length} manifest(s).`
      : `Extension package and manifests use ${version}.`,
  )
}

main().catch((error) => {
  console.error(`Extension version contract failed: ${error.message}`)
  process.exitCode = 1
})
