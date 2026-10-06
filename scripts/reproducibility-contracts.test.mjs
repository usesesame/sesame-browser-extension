import assert from 'node:assert/strict'
import test from 'node:test'
import { createZip, readZip } from './deterministic-zip.mjs'
import { compareArchiveEntries } from './store-zip-compare.mjs'

const entries = () => [
  { path: 'manifest.json', data: Buffer.from('{"manifest_version":3,"version":"0.1.0"}') },
  { path: 'popup.html', data: Buffer.from('<html><body>popup</body></html>') },
  { path: 'assets/popup.js', data: Buffer.from('console.log("popup")') },
]

const archive = (list) => readZip(createZip(list))

test('the zip writer produces the same bytes for the same files', () => {
  const first = createZip(entries())
  const second = createZip([...entries()].reverse())
  assert.ok(first.equals(second), 'two builds of the same files differ')
})

test('a store zip built from the same files reports no differences', () => {
  assert.deepEqual(compareArchiveEntries(archive(entries()), archive(entries())), [])
})

test('a changed file is reported', () => {
  const downloaded = entries()
  downloaded[1].data = Buffer.from('<html><body>older popup</body></html>')
  assert.deepEqual(compareArchiveEntries(archive(downloaded), archive(entries())), [
    { path: 'popup.html', kind: 'differs' },
  ])
})

test('an extra file in the store package is reported', () => {
  const downloaded = entries()
  downloaded.push({ path: 'store-only.js', data: Buffer.from('// store added this') })
  assert.deepEqual(compareArchiveEntries(archive(downloaded), archive(entries())), [
    { path: 'store-only.js', kind: 'not in the source build' },
  ])
})

test('a file missing from the store package is reported', () => {
  const downloaded = entries().filter((entry) => entry.path !== 'assets/popup.js')
  assert.deepEqual(compareArchiveEntries(archive(downloaded), archive(entries())), [
    { path: 'assets/popup.js', kind: 'missing from the store package' },
  ])
})
