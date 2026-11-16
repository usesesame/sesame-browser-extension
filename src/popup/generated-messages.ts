export type PendingKindView = 'change' | 'new' | null

export const GENERATED_MESSAGES = {
  waiting: {
    change: 'Sesame saved the new password. Submit the form, then tell Sesame if the site accepted it.',
    new: 'Sesame saved a new login. Submit the form, then tell Sesame if the site accepted it.',
  },
} as const

const FAILURES: Readonly<Record<string, string>> = {
  'approval-declined': 'Nothing was changed. The request was declined in Sesame.',
  'approval-timeout': 'The approval expired. Try again.',
  'approval-unavailable': 'Sesame could not show the approval. Bring the desktop app forward and retry.',
  'cancelled': 'The request was cancelled. Nothing was changed.',
  'desktop-unavailable': 'Open Sesame, then try again.',
  'fill-in-progress': 'Sesame is already busy. Try again in a moment.',
  'host-disconnected': 'The desktop connection closed. Keep Sesame open and retry.',
  'host-not-found': 'Open Sesame, then try again.',
  'multiple-matches': 'More than one form was found. Sesame did not guess.',
  'no-fields': 'No password fields were found on this page.',
  'no-match': 'No saved login matches this site.',
  'not-password-change-form': 'This is not a password-change form. Nothing was filled.',
  'not-registration-form': 'This is not a sign-up form. Nothing was filled.',
  'page-changed': 'The page changed before Sesame could fill it. Check Sesame.',
  'password-change-form': 'This is a password-change form. Choose Change password instead.',
  'pending-version-unsupported': 'Update the Sesame desktop app to do this from the browser.',
  'protocol-mismatch': 'Update Sesame and the extension, then try again.',
  'stale-document': 'The page reloaded. Check Sesame.',
  'stale-request': 'That request expired. Try again.',
  'timeout': 'Sesame did not answer in time. Try again.',
  'vault-locked': 'Unlock Sesame, then try again.',
}

function code(value: unknown): string {
  return typeof value === 'object' && value !== null && typeof (value as { code?: unknown }).code === 'string'
    ? (value as { code: string }).code
    : ''
}

function state(value: unknown): string {
  return typeof value === 'object' && value !== null && typeof (value as { state?: unknown }).state === 'string'
    ? (value as { state: string }).state
    : ''
}

export function generatedMessage(result: unknown): string {
  if (state(result) === 'changed') return GENERATED_MESSAGES.waiting.change
  if (state(result) === 'created') return GENERATED_MESSAGES.waiting.new
  return FAILURES[code(result)] ?? 'Sesame could not finish this. Check Sesame.'
}

export function acceptMessage(result: unknown, kind: PendingKindView): string {
  const current = state(result)
  if (current === 'confirmed') return kind === 'new' ? 'Sesame kept the new login.' : 'Sesame kept the new password.'
  if (current === 'returned') return 'You already went back in Sesame.'
  if (current === 'unknown' || code(result) === 'pending-not-found') return 'This change is no longer waiting here. Check Sesame.'
  if (current === 'unconfirmed') return 'Sesame has not confirmed it yet. Check Sesame.'
  return FAILURES[code(result)] ?? 'Sesame could not record that. Check Sesame.'
}
