import { isRecord } from './values'
import { MAX_LOOKALIKE_HOST } from '../protocol/native'

export const LOOKALIKE_RESULT_CODE = 'lookalike-domain'

export function lookalikeWarning(host: unknown): string {
  const displayHost = displayHostName(host)
  return displayHost
    ? `This page looks like ${displayHost}, a site you saved, but the address is different. Sesame did not fill anything. Check the address bar before you sign in.`
    : 'This page looks like a site you saved, but the address is different. Sesame did not fill anything. Check the address bar before you sign in.'
}

export function lookalikeWarningForResult(result: unknown): string | null {
  if (!isRecord(result) || result.code !== LOOKALIKE_RESULT_CODE) return null
  return lookalikeWarning(result.lookalike)
}

function displayHostName(host: unknown): string {
  if (typeof host !== 'string') return ''
  const printable = Array.from(host)
    .filter((character) => !isFormatCharacter(character))
    .join('')
    .trim()
  return Array.from(printable).slice(0, MAX_LOOKALIKE_HOST).join('')
}

function isFormatCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0
  return codePoint <= 0x1f
    || (codePoint >= 0x7f && codePoint <= 0x9f)
    || (codePoint >= 0x200b && codePoint <= 0x200f)
    || (codePoint >= 0x202a && codePoint <= 0x202e)
    || (codePoint >= 0x2066 && codePoint <= 0x2069)
    || codePoint === 0xfeff
}
