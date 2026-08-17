const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGITS = '0123456789'
const SYMBOLS = '!@#$%^&*()-_=+[]{}<>?/|~'

export interface PasswordOptions {
  length?: number
  includeUpper?: boolean
  includeLower?: boolean
  includeDigits?: boolean
  includeSymbols?: boolean
}

export function generatePassword(options: PasswordOptions = {}): string {
  const length = clamp(options.length ?? 20, 8, 64)
  const includeUpper = options.includeUpper ?? true
  const includeLower = options.includeLower ?? true
  const includeDigits = options.includeDigits ?? true
  const includeSymbols = options.includeSymbols ?? true

  let pool = ''
  if (includeLower) pool += LOWER
  if (includeUpper) pool += UPPER
  if (includeDigits) pool += DIGITS
  if (includeSymbols) pool += SYMBOLS
  if (pool === '') pool = LOWER + UPPER + DIGITS

  const required: string[] = []
  if (includeLower) required.push(pick(LOWER))
  if (includeUpper) required.push(pick(UPPER))
  if (includeDigits) required.push(pick(DIGITS))
  if (includeSymbols) required.push(pick(SYMBOLS))

  let password = required.join('')
  while (password.length < length) {
    password += pick(pool)
  }

  return shuffle(password)
}

export function isSignupPage(): boolean {
  const inputs = Array.from(document.querySelectorAll('input'))
  const passwordFields = inputs.filter((el) => el.type === 'password')
  if (passwordFields.length === 0) return false

  const hasNewPassword = passwordFields.some((el) =>
    el.autocomplete?.includes('new-password')
  )
  const hasConfirmation = passwordFields.length >= 2
  const hasSignupText = /sign\s*up|register|create\s*account|choose\s*password/i.test(
    document.body.textContent ?? ''
  )

  return hasNewPassword || (hasConfirmation && hasSignupText)
}

function pick(pool: string): string {
  const bytes = new Uint32Array(1)
  crypto.getRandomValues(bytes)
  return pool[bytes[0] % pool.length]
}

function shuffle(value: string): string {
  const array = value.split('')
  for (let i = array.length - 1; i > 0; i--) {
    const bytes = new Uint32Array(1)
    crypto.getRandomValues(bytes)
    const j = bytes[0] % (i + 1)
    ;[array[i], array[j]] = [array[j], array[i]]
  }
  return array.join('')
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
