import { EFF_WORDLIST } from '../../src/content/eff-wordlist'

const words = new Set(EFF_WORDLIST)

export function passphraseWordCounts(passphrase: string): number[] {
  const pieces = passphrase.split('-')
  const counts: Set<number>[] = [new Set([0])]
  for (let end = 1; end <= pieces.length; end += 1) {
    counts[end] = new Set()
    for (const size of [1, 2]) {
      if (end - size < 0 || !words.has(pieces.slice(end - size, end).join('-'))) continue
      for (const count of counts[end - size]) counts[end].add(count + 1)
    }
  }
  return [...counts[pieces.length]].sort((left, right) => left - right)
}
