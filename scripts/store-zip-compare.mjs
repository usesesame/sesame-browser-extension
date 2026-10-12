export function compareArchiveEntries(downloaded, rebuilt) {
  const differences = []
  const downloadedByPath = new Map(downloaded.map((entry) => [entry.path, entry.data]))
  const rebuiltByPath = new Map(rebuilt.map((entry) => [entry.path, entry.data]))
  for (const [path, data] of rebuiltByPath) {
    if (!downloadedByPath.has(path)) differences.push({ path, kind: 'missing from the store package' })
    else if (!downloadedByPath.get(path).equals(data)) differences.push({ path, kind: 'differs' })
  }
  for (const path of downloadedByPath.keys()) {
    if (!rebuiltByPath.has(path)) differences.push({ path, kind: 'not in the source build' })
  }
  return differences.sort((left, right) => (left.path < right.path ? -1 : 1))
}
