export type RevisionRead<T> = { current: true; value: T } | { current: false }

export function createRevisionGate() {
  let revision = 0
  return {
    advance() {
      revision += 1
    },
    async read<T>(query: () => Promise<T>): Promise<RevisionRead<T>> {
      revision += 1
      const started = revision
      const value = await query()
      return revision === started ? { current: true, value } : { current: false }
    },
  }
}
