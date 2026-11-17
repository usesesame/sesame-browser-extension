// Gated by the prepare/fill/clear token binding; the form is never submitted.
import type { IdentityFieldKey, IdentityFields } from '../protocol/native'
import { setValue, type FillPhase } from './field-writer'
import type { IdentityTarget } from './identity-fields'
import {
  clearIdentityFillAnchor,
  controlHint,
  identityFieldKeysForTargets,
  identityTargetsInSurface,
  identityTargetsWithin,
  isSurfaceConnected,
  splitFullName,
  type IdentitySurfaceRoot,
} from './identity-fields'

export type IdentityFillOutcome =
  | { ok: true; filledFields: IdentityFieldKey[] }
  | { ok: false; code: string }

type PendingIdentityFill = {
  token: string
  origin: string
  fields: IdentityFieldKey[]
  root: IdentitySurfaceRoot
}
type IsolatedWorld = typeof globalThis & { __sesamePendingIdentityFillV1?: PendingIdentityFill }
type InputValueSetter = (this: HTMLInputElement, value: string) => void
type SelectValueSetter = (this: HTMLSelectElement, value: string) => void
type TextareaValueSetter = (this: HTMLTextAreaElement, value: string) => void
interface RegionDisplayNames { of(code: string): string | undefined }
interface RegionDisplayNamesConstructor {
  new (locales: string[], options: { type: string }): RegionDisplayNames
}

const PENDING_KEY = '__sesamePendingIdentityFillV1'
const TWO_LETTER_CODE = /^[a-z]{2}$/
const CONFIRMATION = /\b(?:confirm|repeat|verify|retype|re ?enter|again)/
let cachedRegionNames: RegionDisplayNames | null | undefined

export function fillIdentitySurface(
  expectedOrigin: string,
  documentToken: string,
  values: IdentityFields | null,
  phase: FillPhase = 'fill',
): IdentityFillOutcome {
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
    clearIdentityFillAnchor()
    return success([])
  }

  if (phase === 'prepare') {
    const scan = identityTargetsInSurface()
    clearIdentityFillAnchor()
    const fields = identityFieldKeysForTargets(scan.targets)
    if (fields.length === 0 || !scan.root) return failure('no-fields')
    Object.defineProperty(isolated, PENDING_KEY, {
      configurable: true,
      writable: true,
      value: { token: documentToken, origin: expectedOrigin, fields, root: scan.root },
    })
    return success(fields)
  }

  clearIdentityFillAnchor()
  const pending = isolated[PENDING_KEY]
  clearPending(isolated)
  if (!pending || pending.token !== documentToken || pending.origin !== expectedOrigin) {
    return failure('stale-document')
  }
  if (!values) return failure('fill-failed')
  if (!isSurfaceConnected(pending.root)) {
    for (const key of Object.keys(values) as IdentityFieldKey[]) values[key] = ''
    return failure('stale-document')
  }
  const fillScan = identityTargetsWithin(pending.root)

  const inputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set as
    | InputValueSetter
    | undefined
  if (typeof inputValueSetter !== 'function') return failure('field-write-failed')
  const selectValueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set as
    | SelectValueSetter
    | undefined
  const textareaValueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set as
    | TextareaValueSetter
    | undefined

  const filledFields: IdentityFieldKey[] = []
  try {
    for (const field of pending.fields) {
      if (!values[field]) continue
      const targets = fillScan.targets.filter((target) => target.key === field)
      if (field === 'email') {
        for (const target of emailTargets(targets)) {
          if (!writeTarget(target, values, inputValueSetter, selectValueSetter, textareaValueSetter)) continue
          addFilledFields(filledFields, target, values)
        }
        continue
      }
      for (const target of firstTargetPerPart(targets)) {
        if (writeTarget(target, values, inputValueSetter, selectValueSetter, textareaValueSetter)) {
          addFilledFields(filledFields, target, values)
        }
      }
    }
  } finally {
    for (const key of Object.keys(values) as IdentityFieldKey[]) values[key] = ''
    clearPending(isolated)
    clearIdentityFillAnchor()
  }
  return filledFields.length > 0 ? success(filledFields) : failure('field-write-failed')
}

function emailTargets(targets: IdentityTarget[]): IdentityTarget[] {
  const [first, ...rest] = targets
  if (!first) return []
  return [first, ...rest.filter(isEmailConfirmation)]
}

function isEmailConfirmation(target: IdentityTarget): boolean {
  return CONFIRMATION.test(controlHint(target.element))
}

function firstTargetPerPart(targets: IdentityTarget[]): IdentityTarget[] {
  const seen = new Set<string>()
  const selected: IdentityTarget[] = []
  for (const target of targets) {
    if (seen.has(target.part)) continue
    seen.add(target.part)
    selected.push(target)
  }
  return selected
}

function addFilledFields(
  filledFields: IdentityFieldKey[],
  target: IdentityTarget,
  values: IdentityFields,
): void {
  const keys: IdentityFieldKey[] = target.part === 'street' && values.addressLine2
    ? ['addressLine1', 'addressLine2']
    : [target.key]
  for (const key of keys) {
    if (!filledFields.includes(key)) filledFields.push(key)
  }
}

function writeTarget(
  target: IdentityTarget,
  values: IdentityFields,
  inputValueSetter: InputValueSetter,
  selectValueSetter: SelectValueSetter | undefined,
  textareaValueSetter: TextareaValueSetter | undefined,
): boolean {
  const value = targetValue(target, values)
  if (!value) return false
  if (target.element instanceof HTMLSelectElement) {
    return typeof selectValueSetter === 'function'
      ? writeOption(target.element, value, target.key, selectValueSetter)
      : false
  }
  if (target.element instanceof HTMLTextAreaElement) {
    return typeof textareaValueSetter === 'function'
      ? writeControl(target.element, value, textareaValueSetter)
      : false
  }
  return setValue(target.element, value, inputValueSetter)
}

function targetValue(target: IdentityTarget, values: IdentityFields): string {
  if (target.part === 'street') {
    const line1 = values.addressLine1 ?? ''
    if (!line1) return ''
    const line2 = values.addressLine2 ?? ''
    return line2 ? `${line1}\n${line2}` : line1
  }
  if (target.key === 'fullName') {
    const fullName = values.fullName ?? ''
    if (!fullName) return ''
    if (target.part === 'whole') return fullName
    const { given, family } = splitFullName(fullName)
    return target.part === 'given' ? given : family
  }
  return values[target.key] ?? ''
}

function writeOption(
  select: HTMLSelectElement,
  value: string,
  key: IdentityFieldKey,
  setter: SelectValueSetter,
): boolean {
  const option = matchingOption(select, value, key)
  return option ? writeControl(select, option.value, setter) : false
}

function matchingOption(select: HTMLSelectElement, value: string, key: IdentityFieldKey): HTMLOptionElement | undefined {
  const wanted = value.trim().toLowerCase()
  if (!wanted) return undefined
  const options = Array.from(select.options).filter((option) => option.value.trim().length > 0)
  const exact = options.find((option) => matchesOption(option, wanted))
  if (exact || key !== 'country') return exact
  const names = regionDisplayNames()
  if (!names) return undefined
  return options.find((option) => matchesCountryCode(option, wanted, names))
}

function matchesOption(option: HTMLOptionElement, wanted: string): boolean {
  return option.value.trim().toLowerCase() === wanted || option.text.trim().toLowerCase() === wanted
}

function matchesCountryCode(option: HTMLOptionElement, wanted: string, names: RegionDisplayNames): boolean {
  const candidates = [option.value, option.text].map((text) => text.trim().toLowerCase()).filter(Boolean)
  const wantedName = TWO_LETTER_CODE.test(wanted) ? regionName(names, wanted) : undefined
  for (const candidate of candidates) {
    const optionName = TWO_LETTER_CODE.test(candidate) ? regionName(names, candidate) : undefined
    if (optionName && optionName.toLowerCase() === wanted) return true
    if (wantedName && wantedName.toLowerCase() === candidate) return true
  }
  return false
}

function regionName(names: RegionDisplayNames, code: string): string | undefined {
  try {
    return names.of(code.toUpperCase())
  } catch {
    return undefined
  }
}

function regionDisplayNames(): RegionDisplayNames | null {
  if (cachedRegionNames !== undefined) return cachedRegionNames
  try {
    const constructor = (Intl as unknown as { DisplayNames?: RegionDisplayNamesConstructor }).DisplayNames
    cachedRegionNames = constructor ? new constructor(['en'], { type: 'region' }) : null
  } catch {
    cachedRegionNames = null
  }
  return cachedRegionNames
}

function writeControl<T extends HTMLSelectElement | HTMLTextAreaElement>(
  control: T,
  value: string,
  setter: (this: T, value: string) => void,
): boolean {
  try {
    try {
      control.focus({ preventScroll: true })
    } catch {
      control.focus()
    }
    setter.call(control, value)
    const inputEvent = typeof InputEvent === 'function'
      ? new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText' })
      : new Event('input', { bubbles: true, composed: true })
    control.dispatchEvent(inputEvent)
    control.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
    return true
  } catch {
    return false
  }
}

function clearPending(isolated: IsolatedWorld): void {
  try {
    delete isolated[PENDING_KEY]
  } catch {
    isolated[PENDING_KEY] = undefined
  }
}

function success(filledFields: IdentityFieldKey[]): IdentityFillOutcome {
  return { ok: true, filledFields }
}

function failure(code: string): IdentityFillOutcome {
  return { ok: false, code }
}
