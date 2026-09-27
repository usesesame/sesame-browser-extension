export function fillMatchExplanation(value: unknown): string | null {
  if (value === 'exact') return 'Filled. The saved login matches this site exactly.'
  if (value === 'wwwAlias') {
    return 'Filled. The saved login matches this site through its single www address.'
  }
  return null
}
