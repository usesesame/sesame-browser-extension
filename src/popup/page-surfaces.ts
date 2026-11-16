import type { PasswordSurfaceKind } from '../content/registration'
import type { OneTimeCodeKind } from '../content/one-time-code'
import { isRecord } from '../shared/values'

export type PageKind =
  | 'checking'
  | 'restricted'
  | 'unchecked'
  | 'none'
  | 'username'
  | 'login'
  | 'registration'
  | 'password-change'
  | 'ambiguous'

export interface PageSurfaceView {
  kind: PageKind
  code: string
  hasUsernameField: boolean
  hasPasswordField: boolean
  identityFields: string[]
  cardFields: string[]
  cardFeedback: string
  codeKind: OneTimeCodeKind | null
}

function emptyView(kind: PageKind, code: string): PageSurfaceView {
  return {
    kind,
    code,
    hasUsernameField: false,
    hasPasswordField: false,
    identityFields: [],
    cardFields: [],
    cardFeedback: '',
    codeKind: null,
  }
}

export function pageSurfaceView(surfaces: unknown): PageSurfaceView {
  if (!isRecord(surfaces) || (surfaces.state !== 'restricted' && surfaces.state !== 'checked')) {
    return emptyView('unchecked', 'page-check-failed')
  }
  if (surfaces.state === 'restricted') {
    return emptyView('restricted', typeof surfaces.code === 'string' ? surfaces.code : 'page-restricted')
  }
  return {
    ...loginView(surfaces.login, surfaces.purpose),
    identityFields: readyFields(surfaces.identity),
    cardFields: readyFields(surfaces.card),
    cardFeedback: cardFeedback(surfaces.card),
    codeKind: oneTimeCodeKind(surfaces.oneTimeCode),
  }
}

function loginView(login: unknown, rawPurpose: unknown): Pick<PageSurfaceView, 'kind' | 'code' | 'hasUsernameField' | 'hasPasswordField'> {
  const record = isRecord(login) ? login : {}
  if (record.state !== 'ready') {
    const code = typeof record.code === 'string' ? record.code : 'page-check-failed'
    const kind: PageKind = code === 'no-fields' ? 'none'
      : code === 'page-check-failed' ? 'unchecked'
        : code === 'multiple-matches' ? 'ambiguous' : 'restricted'
    return { kind, code, hasUsernameField: false, hasPasswordField: false }
  }
  const purpose = rawPurpose === null || rawPurpose === undefined ? 'none' : passwordSurfaceKind(rawPurpose)
  const hasUsernameField = record.hasUsernameField === true
  const hasPasswordField = record.hasPasswordField === true
  const kind: PageKind = purpose === 'registration' ? 'registration'
    : purpose === 'password-change' ? 'password-change'
      : purpose === 'ambiguous' ? 'ambiguous'
        : hasPasswordField ? 'login'
          : hasUsernameField ? 'username' : 'none'
  const code = kind === 'registration' ? 'registration-form-found'
    : kind === 'password-change' ? 'password-change-form'
      : kind === 'ambiguous' ? 'multiple-matches'
        : kind === 'login' && hasUsernameField ? 'sign-in-form-found'
          : kind === 'login' ? 'password-field-found'
            : kind === 'username' ? 'username-field-found' : 'no-sign-in-fields'
  return { kind, code, hasUsernameField, hasPasswordField }
}

function readyFields(check: unknown): string[] {
  if (!isRecord(check) || check.state !== 'ready' || !Array.isArray(check.fields)) return []
  return check.fields.filter((field): field is string => typeof field === 'string')
}

function cardFeedback(card: unknown): string {
  if (!isRecord(card)) return ''
  if (card.state === 'ready' && card.embedded === true) return 'Card fields are in Stripe payment frames. Approval stays bound to this page.'
  if (card.code === 'insecure-page') return 'Cards are never filled on HTTP pages.'
  if (card.code === 'untrusted-frame') return 'Cards are filled only on this page or in Stripe payment frames.'
  return ''
}

function oneTimeCodeKind(check: unknown): OneTimeCodeKind | null {
  if (!isRecord(check) || check.state !== 'ready') return null
  return check.kind === 'single' || check.kind === 'split' ? check.kind : null
}

function passwordSurfaceKind(value: unknown): PasswordSurfaceKind {
  return value === 'login' || value === 'registration' || value === 'password-change' || value === 'ambiguous' || value === 'none'
    ? value
    : 'ambiguous'
}
