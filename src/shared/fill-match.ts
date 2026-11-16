export function fillMatchExplanation(value: unknown): string | null {
  if (value === 'exact') return 'Filled. The saved login matches this site exactly.'
  if (value === 'wwwAlias') {
    return 'Filled. The saved login matches this site through its single www address.'
  }
  if (value === 'site') {
    return 'Filled. The saved login is for another address on this site and is set to work across the whole site.'
  }
  return null
}
