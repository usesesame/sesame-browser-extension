export function oneTimeCodeSecondsMessage(remainingSeconds: number): string {
  return remainingSeconds > 0
    ? `Code filled. About ${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'} remain.`
    : ''
}
