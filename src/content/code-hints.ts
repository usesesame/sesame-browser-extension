const STRONG_CODE_WORDS = /\bone time\b|\botp\b|\b2fa\b|\bmfa\b|\btwo factor\b|\bauthenticator\b|\bpasscode\b|\b(?:sms|text|verification|verify|confirmation|authentication|auth) (?:code|pin)\b/
const CODE_WORD = /(?<![a-z])(?:code|pin)(?![a-z])/
const DELIVERY_WORDS = /\b(?:sms|text message|texted|emailed|sent|we sent|from your (?:phone|email|app))\b/

export function declaresOneTimeCode(autocomplete: string): boolean {
  return autocomplete.toLowerCase().split(/\s+/).includes('one-time-code')
}

export function looksLikeOneTimeCode(hint: string): boolean {
  const words = hint.toLowerCase().replace(/[\s_-]+/g, ' ')
  return STRONG_CODE_WORDS.test(words) || (CODE_WORD.test(words) && DELIVERY_WORDS.test(words))
}
