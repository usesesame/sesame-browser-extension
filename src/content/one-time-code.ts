// Binds prepare/fill to one document; never reads a value, logs, or submits.
import { normalizeFillOrigin } from '../protocol/native'
import { isVisibleInput } from '../shared/dom'
import { isRecord } from '../shared/values'
import { labelText } from './field-detector'
import { setValue } from './field-writer'
import { collectInputs } from './input-scan'

export type OneTimeCodeKind = 'single' | 'split'

export interface OneTimeCodeSurface {
  ok: true
  origin: string
}

export type OneTimeCodeInspection =
  | { ok: true; surface: OneTimeCodeSurface; kind: OneTimeCodeKind; fields: number }
  | { ok: false; code: string }

export type OneTimeCodeFillOutcome =
  | { ok: true; kind: OneTimeCodeKind; filledFields: number }
  | { ok: false; code: string }

type FillPhase = 'prepare' | 'fill' | 'clear'
type PendingOneTimeCode = { token: string; origin: string; kind: OneTimeCodeKind }
type IsolatedWorld = typeof globalThis & { __sesamePendingOneTimeCodeV1?: PendingOneTimeCode }
type OneTimeCodeTarget =
  | { ok: true; kind: 'single'; field: HTMLInputElement }
  | { ok: true; kind: 'split'; fields: HTMLInputElement[] }
  | { ok: false; code: 'no-fields' | 'multiple-matches' }

const PENDING_KEY = '__sesamePendingOneTimeCodeV1'
const MIN_SPLIT_FIELDS = 3
const MAX_SPLIT_FIELDS = 8
const CODE_PATTERN = /^[0-9]{1,9}$/
const ONE_TIME_HINT = /one[\s_-]?time|\botp\b|verification|verify|auth(?:entication)?[\s_-]?code|2fa|\bmfa\b|security[\s_-]?code/
const SAFE_FILL_CODES = new Set([
  'field-write-failed', 'fill-failed', 'multiple-matches', 'no-fields', 'origin-mismatch', 'stale-document',
])
const INSPECTION_KEYS = new Set(['ok', 'surface', 'kind', 'fields'])
const SURFACE_KEYS = new Set(['ok', 'origin'])
const OUTCOME_KEYS = new Set(['ok', 'kind', 'filledFields'])
const FAILURE_KEYS = new Set(['ok', 'code'])

export function inspectOneTimeCodeSurface(): OneTimeCodeInspection {
  const target = resolveOneTimeCodeTarget()
  if (!target.ok) return target
  return {
    ok: true,
    surface: { ok: true, origin: location.origin },
    kind: target.kind,
    fields: target.kind === 'split' ? target.fields.length : 1,
  }
}

export function oneTimeCodeKindForField(field: HTMLInputElement): OneTimeCodeKind | null {
  const target = resolveOneTimeCodeTarget()
  if (!target.ok) return null
  if (target.kind === 'single') return target.field === field ? 'single' : null
  return target.fields.includes(field) ? 'split' : null
}

export function fillOneTimeCodeSurface(
  expectedOrigin: string,
  documentToken: string,
  code: string | null,
  phase: FillPhase = 'fill',
): OneTimeCodeFillOutcome {
  if (typeof expectedOrigin !== 'string' || location.origin !== expectedOrigin) {
    return failure('origin-mismatch')
  }
  if (typeof documentToken !== 'string' || documentToken.length < 16 || documentToken.length > 128) {
    return failure('stale-document')
  }

  const isolated = globalThis as IsolatedWorld
  if (phase === 'clear') {
    const pending = isolated[PENDING_KEY]
    if (pending?.token === documentToken && pending.origin === expectedOrigin) clearPending(isolated)
    return success(pending?.kind ?? 'single', 0)
  }

  let preparedKind: OneTimeCodeKind | undefined
  if (phase === 'fill') {
    const pending = isolated[PENDING_KEY]
    clearPending(isolated)
    if (!pending || pending.token !== documentToken || pending.origin !== expectedOrigin) {
      return failure('stale-document')
    }
    preparedKind = pending.kind
  }

  const target = resolveOneTimeCodeTarget()
  if (!target.ok) return failure(target.code)
  if (preparedKind && preparedKind !== target.kind) return failure('stale-document')

  if (phase === 'prepare') {
    Object.defineProperty(isolated, PENDING_KEY, {
      configurable: true,
      writable: true,
      value: { token: documentToken, origin: expectedOrigin, kind: target.kind },
    })
    return success(target.kind, target.kind === 'split' ? target.fields.length : 1)
  }

  if (typeof code !== 'string' || !CODE_PATTERN.test(code)) {
    return failure('fill-failed')
  }

  const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (typeof nativeValueSetter !== 'function') return failure('field-write-failed')

  try {
    return writeOneTimeCode(target, code, nativeValueSetter)
  } finally {
    code = ''
  }
}

function writeOneTimeCode(
  target: Extract<OneTimeCodeTarget, { ok: true }>,
  code: string,
  nativeValueSetter: (this: HTMLInputElement, value: string) => void,
): OneTimeCodeFillOutcome {
  if (target.kind === 'single') {
    return setValue(target.field, code, nativeValueSetter)
      ? success('single', 1)
      : failure('field-write-failed')
  }
  if (code.length !== target.fields.length) return failure('field-write-failed')
  let filledFields = 0
  for (let index = 0; index < target.fields.length; index += 1) {
    if (!setValue(target.fields[index], code.charAt(index), nativeValueSetter)) {
      return failure('field-write-failed')
    }
    filledFields += 1
  }
  return success('split', filledFields)
}

function resolveOneTimeCodeTarget(): OneTimeCodeTarget {
  const scan = collectInputs(document)
  if (scan.truncated) return { ok: false, code: 'no-fields' }
  const inputs = scan.inputs
    .filter((input) => isVisibleInput(input, { rejectAriaHiddenAncestor: true, minimumSize: 1 }))
  const groups = splitDigitGroups(inputs)
  const singles = inputs.filter((input) => !isSplitDigitField(input) && isOneTimeCodeField(input))
  if (singles.length === 1 && groups.length === 0) return { ok: true, kind: 'single', field: singles[0] }
  if (singles.length === 0 && groups.length === 1) return { ok: true, kind: 'split', fields: groups[0] }
  if (singles.length === 0 && groups.length === 0) return { ok: false, code: 'no-fields' }
  return { ok: false, code: 'multiple-matches' }
}

function splitDigitGroups(inputs: HTMLInputElement[]): HTMLInputElement[][] {
  const groups = new Map<Element, HTMLInputElement[]>()
  for (const input of inputs) {
    if (!isSplitDigitField(input)) continue
    const owner = input.form ?? input.parentElement ?? input
    const group = groups.get(owner)
    if (group) group.push(input)
    else groups.set(owner, [input])
  }
  return Array.from(groups.values())
    .filter((group) => group.length >= MIN_SPLIT_FIELDS && group.length <= MAX_SPLIT_FIELDS)
}

function isSplitDigitField(input: HTMLInputElement): boolean {
  return input.maxLength === 1 && isNumericish(input)
}

function isOneTimeCodeField(input: HTMLInputElement): boolean {
  const autocomplete = input.autocomplete.toLowerCase().split(/\s+/)
  if (autocomplete.includes('one-time-code')) return true
  if (autocomplete.some((token) => token.startsWith('cc-'))) return false
  if (!isNumericish(input)) return false
  return ONE_TIME_HINT.test(oneTimeCodeHints(input))
}

function isNumericish(input: HTMLInputElement): boolean {
  const type = input.type.toLowerCase()
  if (type === 'text' || type === 'tel' || type === 'number') return true
  return input.inputMode === 'numeric' || input.inputMode === 'decimal'
}

function oneTimeCodeHints(input: HTMLInputElement): string {
  return [
    input.name,
    input.id,
    input.placeholder,
    input.getAttribute('aria-label') ?? '',
    input.getAttribute('title') ?? '',
    labelText(input),
  ].join(' ').toLowerCase()
}

export function normalizeOneTimeCodeInspection(value: unknown): OneTimeCodeInspection {
  if (isRecord(value)
    && value.ok === true
    && hasExactKeys(value, INSPECTION_KEYS)
    && isRecord(value.surface)
    && value.surface.ok === true
    && hasExactKeys(value.surface, SURFACE_KEYS)
    && typeof value.surface.origin === 'string'
    && normalizeFillOrigin(value.surface.origin) === value.surface.origin
    && isOneTimeCodeKind(value.kind)
    && isFieldCount(value.kind, value.fields)) {
    return {
      ok: true,
      surface: { ok: true, origin: value.surface.origin },
      kind: value.kind,
      fields: value.fields as number,
    }
  }
  if (isRecord(value)
    && value.ok === false
    && hasExactKeys(value, FAILURE_KEYS)
    && (value.code === 'no-fields' || value.code === 'multiple-matches')) {
    return { ok: false, code: value.code }
  }
  return { ok: false, code: 'invalid-inspection' }
}

export function normalizeOneTimeCodeFillOutcome(value: unknown): OneTimeCodeFillOutcome {
  if (isRecord(value)
    && value.ok === true
    && hasExactKeys(value, OUTCOME_KEYS)
    && isOneTimeCodeKind(value.kind)
    && isFieldCount(value.kind, value.filledFields)) {
    return { ok: true, kind: value.kind, filledFields: value.filledFields as number }
  }
  if (isRecord(value)
    && value.ok === false
    && hasExactKeys(value, FAILURE_KEYS)
    && typeof value.code === 'string'
    && SAFE_FILL_CODES.has(value.code)) {
    return { ok: false, code: value.code }
  }
  return { ok: false, code: 'invalid-outcome' }
}

function isOneTimeCodeKind(value: unknown): value is OneTimeCodeKind {
  return value === 'single' || value === 'split'
}

function isFieldCount(kind: OneTimeCodeKind, value: unknown): boolean {
  if (typeof value !== 'number' || !Number.isInteger(value)) return false
  return kind === 'single'
    ? value === 1
    : value >= MIN_SPLIT_FIELDS && value <= MAX_SPLIT_FIELDS
}

function hasExactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  const keys = Object.keys(value)
  return keys.length === allowed.size && keys.every((key) => allowed.has(key))
}

function clearPending(isolated: IsolatedWorld): void {
  try {
    delete isolated[PENDING_KEY]
  } catch {
    isolated[PENDING_KEY] = undefined
  }
}

function success(kind: OneTimeCodeKind, filledFields: number): OneTimeCodeFillOutcome {
  return { ok: true, kind, filledFields }
}

function failure(code: string): OneTimeCodeFillOutcome {
  return { ok: false, code }
}
