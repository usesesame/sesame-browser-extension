import type { IdentityFieldKey } from '../protocol/native'
import { isVisibleElement, isVisibleInput } from '../shared/dom'
import { cardFieldsForInput } from './card-fields'
import { declaresOneTimeCode, looksLikeOneTimeCode } from './code-hints'
import { tokens } from './field-writer'
import { collectFormControls, type FormControl } from './input-scan'

export type IdentityTargetPart = 'whole' | 'given' | 'family' | 'street'
export type IdentityFormControl = FormControl

export interface IdentityTarget {
  element: IdentityFormControl
  key: IdentityFieldKey
  part: IdentityTargetPart
}

export interface IdentitySurfaceScan {
  targets: IdentityTarget[]
  truncated: boolean
  root: Element | Document | ShadowRoot | null
  anchor: Element | null
}

interface TargetKind {
  key: IdentityFieldKey
  part: IdentityTargetPart
}

const AUTOCOMPLETE_TO_TARGET: Readonly<Record<string, TargetKind>> = Object.freeze({
  name: { key: 'fullName', part: 'whole' },
  'given-name': { key: 'fullName', part: 'given' },
  'family-name': { key: 'fullName', part: 'family' },
  email: { key: 'email', part: 'whole' },
  tel: { key: 'phone', part: 'whole' },
  'address-line1': { key: 'addressLine1', part: 'whole' },
  'address-line2': { key: 'addressLine2', part: 'whole' },
  'address-level2': { key: 'city', part: 'whole' },
  'address-level1': { key: 'region', part: 'whole' },
  'postal-code': { key: 'postalCode', part: 'whole' },
  country: { key: 'country', part: 'whole' },
  'country-name': { key: 'country', part: 'whole' },
})

const EMAIL = /\be ?mail\b/
const PHONE = /\b(?:phone|mobile|telephone|tel|cell)\b/
const TELEPHONE_PARTS = new Set([
  'tel-country-code', 'tel-area-code', 'tel-local', 'tel-local-prefix', 'tel-local-suffix', 'tel-extension',
])
const NOT_A_PHONE = /\b(?:country|dial|calling) ?code\b|\b(?:prefix|extension)\b|\bext\b/
const OTHER_RECIPIENT = /\b(?:recipient|friend|gift|referral|invite|invitee|colleague)\b|\bsomeone else'?s? (?:e ?mail|address)\b/
const POSTAL_CODE = /\b(?:zip|postal|post) ?code\b|\bzip\b|\bpostal\b/
const COUNTRY = /\bcountry\b/
const COUNTRY_CODE = /\bcountry ?code\b/
const REGION = /\b(?:state|province|region|county)\b/
const CITY = /\b(?:city|town|locality)\b/
const ADDRESS_LINE_2 = /\baddress ?(?:line ?)?2\b|\b(?:apt|apartment|suite|unit)\b/
const ADDRESS_LINE_1 = /\baddress ?(?:line ?)?1\b|\b(?:street|mailing|shipping|billing|home) ?address\b|\baddress\b/
const NOT_A_STREET_ADDRESS = /\b(?:wallet|contract|ip|mac|email|e mail|web|url|bitcoin|btc|eth|ethereum|crypto|token|public|server|network|domain|dns|socket|proxy|memory|remote|host|peer|node) ?(?:address|addr)\b/
const FULL_NAME = /\b(?:full|your|contact|customer|display|legal) ?name\b|\bname\b/
const GIVEN_NAME = /\b(?:first|given|fore) ?name\b|\bfname\b/
const FAMILY_NAME = /\b(?:last|family|sur) ?name\b|\blname\b/
const NOT_A_PERSON_NAME = /\b(?:user|login|account|nick|screen|company|business|organization|organisation|product|file|domain|host|brand|card|card ?holder|cardholder|cc|first|last|middle|given|family|sur|additional|event|team|group|project|task|device|server|page|site|section|category|field|label|list) ?name\b/
const NAME_ON_CARD = /\bname (?:on|of) (?:the )?card\b/
const IDENTITY_INPUT_TYPES = new Set(['text', 'email', 'tel', 'url', 'number'])
const MAX_FOCUS_DEPTH = 8

export function identityFieldForInput(input: HTMLInputElement): IdentityFieldKey | undefined {
  return identityTargetForInput(input)?.key
}

export function declaresIdentityField(input: HTMLInputElement): boolean {
  const type = input.type.toLowerCase()
  return type === 'email' || type === 'tel' || identityTargetKindForAutocomplete(input.autocomplete) !== undefined
}

export function identityTargetForInput(input: HTMLInputElement): IdentityTarget | undefined {
  if (!IDENTITY_INPUT_TYPES.has(input.type.toLowerCase())) return undefined
  const hint = controlHint(input)
  const explicit = identityTargetKindForAutocomplete(input.autocomplete)
  if ((explicit?.key === 'email' || input.type.toLowerCase() === 'email' || EMAIL.test(hint))
    && OTHER_RECIPIENT.test(hint)) {
    return undefined
  }
  if (explicit) return { element: input, ...explicit }
  if (tokens(input.autocomplete).some((token) => TELEPHONE_PARTS.has(token))) return undefined
  if (declaresOneTimeCode(input.autocomplete) || tokens(input.autocomplete).includes('additional-name')) {
    return undefined
  }
  if (looksLikeOneTimeCode(hint)) return undefined
  const type = input.type.toLowerCase()
  if (type === 'email') return { element: input, key: 'email', part: 'whole' }
  const kind = identityTargetKindForInputHint(hint)
  if (kind) return { element: input, ...kind }
  return type === 'tel' && !NOT_A_PHONE.test(hint) && cardFieldsForInput(input).length === 0
    ? { element: input, key: 'phone', part: 'whole' }
    : undefined
}

const ANCHOR_KEY = '__sesameIdentityFillAnchorV1'
const FORMLESS_CONTAINER_SELECTOR =
  'fieldset, section, article, aside, dialog, [role="dialog"], [role="form"], main, header, footer, nav'

type AnchorWorld = typeof globalThis & { [ANCHOR_KEY]?: Element }

export function recordIdentityFillAnchor(anchor: Element | null): void {
  const value = anchor?.isConnected ? anchor : undefined
  try {
    Object.defineProperty(globalThis, ANCHOR_KEY, { configurable: true, writable: true, value })
  } catch {
    ;(globalThis as AnchorWorld)[ANCHOR_KEY] = value
  }
}

export function clearIdentityFillAnchor(): void {
  try {
    delete (globalThis as AnchorWorld)[ANCHOR_KEY]
  } catch {
    ;(globalThis as AnchorWorld)[ANCHOR_KEY] = undefined
  }
}

export function identityTargetsInSurface(anchor?: Element | null): IdentitySurfaceScan {
  const scan = collectFormControls(document)
  if (scan.truncated) return { targets: [], truncated: true, root: null, anchor: null }
  const targets: IdentityTarget[] = []
  for (const control of scan.controls) {
    const target = identityTargetForVisibleControl(control)
    if (target) targets.push(target)
  }
  const resolvedAnchor = anchor === undefined ? recordedAnchor() ?? focusedControl() : anchor
  const selection = targetsInSurface(targets, resolvedAnchor)
  return {
    targets: selection.targets,
    truncated: false,
    root: selection.root,
    anchor: resolvedAnchor,
  }
}

export type IdentitySurfaceRoot = Element | Document | ShadowRoot

export function identityTargetsWithin(root: IdentitySurfaceRoot): { targets: IdentityTarget[]; truncated: boolean } {
  const scan = collectFormControls(document)
  if (scan.truncated) return { targets: [], truncated: true }
  const targets: IdentityTarget[] = []
  for (const control of scan.controls) {
    const target = identityTargetForVisibleControl(control)
    if (target && insideSurface(target, root)) targets.push(target)
  }
  return { targets, truncated: false }
}

export function isSurfaceConnected(root: IdentitySurfaceRoot): boolean {
  if (root instanceof ShadowRoot) return root.host.isConnected
  if (root instanceof Document) return root === document
  return root.isConnected
}

function insideSurface(target: IdentityTarget, root: IdentitySurfaceRoot): boolean {
  const element = target.element
  if (root instanceof HTMLFormElement) return element.form === root
  if (element.form !== null) return false
  if (root instanceof Document) return element.getRootNode() === root && closestContainer(element) === null
  if (root instanceof ShadowRoot) return element.getRootNode() === root
  return root.contains(element)
}

export function identityFieldKeysForTargets(targets: IdentityTarget[]): IdentityFieldKey[] {
  const fields = new Set<IdentityFieldKey>()
  for (const target of targets) {
    fields.add(target.key)
    if (target.part === 'street') fields.add('addressLine2')
  }
  return Array.from(fields)
}

export function splitFullName(value: string): { given: string; family: string } {
  const words = value.trim().split(/\s+/).filter(Boolean)
  return { given: words[0] ?? '', family: words.slice(1).join(' ') }
}

function identityTargetKindForAutocomplete(value: string): TargetKind | undefined {
  for (const token of tokens(value)) {
    const kind = AUTOCOMPLETE_TO_TARGET[token]
    if (kind) return kind
  }
  return undefined
}

function identityTargetKindForInputHint(hint: string): TargetKind | undefined {
  if (EMAIL.test(hint)) return { key: 'email', part: 'whole' }
  if (PHONE.test(hint) && !NOT_A_PHONE.test(hint)) return { key: 'phone', part: 'whole' }
  if (POSTAL_CODE.test(hint)) return { key: 'postalCode', part: 'whole' }
  if (COUNTRY.test(hint) && !COUNTRY_CODE.test(hint)) return { key: 'country', part: 'whole' }
  if (REGION.test(hint)) return { key: 'region', part: 'whole' }
  if (CITY.test(hint)) return { key: 'city', part: 'whole' }
  if (ADDRESS_LINE_2.test(hint)) return { key: 'addressLine2', part: 'whole' }
  if (ADDRESS_LINE_1.test(hint) && !NOT_A_STREET_ADDRESS.test(hint)) {
    return { key: 'addressLine1', part: 'whole' }
  }
  if (GIVEN_NAME.test(hint)) return { key: 'fullName', part: 'given' }
  if (FAMILY_NAME.test(hint)) return { key: 'fullName', part: 'family' }
  if (NOT_A_PERSON_NAME.test(hint) || NAME_ON_CARD.test(hint)) return undefined
  return FULL_NAME.test(hint) ? { key: 'fullName', part: 'whole' } : undefined
}

function identityTargetForSelect(select: HTMLSelectElement): IdentityTarget | undefined {
  const explicit = identityTargetKindForAutocomplete(select.autocomplete)
  if (explicit) {
    return explicit.key === 'country' || explicit.key === 'region'
      ? { element: select, key: explicit.key, part: 'whole' }
      : undefined
  }
  const hint = controlHint(select)
  if (COUNTRY.test(hint) && !COUNTRY_CODE.test(hint)) return { element: select, key: 'country', part: 'whole' }
  if (REGION.test(hint)) return { element: select, key: 'region', part: 'whole' }
  return undefined
}

function identityTargetForTextarea(textarea: HTMLTextAreaElement): IdentityTarget | undefined {
  if (tokens(textarea.autocomplete).includes('street-address')) {
    return { element: textarea, key: 'addressLine1', part: 'street' }
  }
  const explicit = identityTargetKindForAutocomplete(textarea.autocomplete)
  if (explicit) {
    return explicit.key === 'addressLine1' || explicit.key === 'addressLine2'
      ? { element: textarea, key: explicit.key, part: 'whole' }
      : undefined
  }
  const hint = controlHint(textarea)
  if (ADDRESS_LINE_2.test(hint)) return undefined
  return ADDRESS_LINE_1.test(hint) && !NOT_A_STREET_ADDRESS.test(hint)
    ? { element: textarea, key: 'addressLine1', part: 'street' }
    : undefined
}

function identityTargetForVisibleControl(control: IdentityFormControl): IdentityTarget | undefined {
  if (control instanceof HTMLInputElement) {
    return isVisibleInput(control, { excludePassword: true }) ? identityTargetForInput(control) : undefined
  }
  if (control instanceof HTMLSelectElement) {
    return control.disabled || control.hidden || !isVisibleElement(control)
      ? undefined
      : identityTargetForSelect(control)
  }
  return control.disabled || control.hidden || control.readOnly || !isVisibleElement(control)
    ? undefined
    : identityTargetForTextarea(control)
}

interface SurfaceSelection {
  targets: IdentityTarget[]
  root: Element | Document | ShadowRoot | null
}

function targetsInSurface(targets: IdentityTarget[], anchor: Element | null): SurfaceSelection {
  return anchor ? anchorSurface(targets, anchor) : fallbackSurface(targets)
}

function anchorSurface(targets: IdentityTarget[], anchor: Element): SurfaceSelection {
  const form = formFor(anchor)
  if (form) {
    return { targets: targets.filter((target) => target.element.form === form), root: form }
  }
  for (let ancestor = anchor.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const inside = targets.filter(
      (target) => target.element.form === null && ancestor.contains(target.element),
    )
    if (inside.length >= 2) return { targets: inside, root: ancestor }
  }
  const rootNode = anchor.getRootNode()
  if (rootNode instanceof ShadowRoot) {
    const inside = targets.filter(
      (target) => target.element.form === null && target.element.getRootNode() === rootNode,
    )
    if (inside.length >= 2) return { targets: inside, root: rootNode }
  }
  const alone = targets.find((target) => target.element === anchor)
  return alone ? { targets: [alone], root: anchor } : { targets: [], root: null }
}

function fallbackSurface(targets: IdentityTarget[]): SurfaceSelection {
  const groups: SurfaceSelection[] = []
  const indexes = new Map<Node, number>()
  for (const target of targets) {
    const owner = target.element.form
      ?? closestContainer(target.element)
      ?? target.element.getRootNode()
    const index = indexes.get(owner)
    if (index !== undefined) {
      groups[index].targets.push(target)
    } else {
      indexes.set(owner, groups.length)
      groups.push({ targets: [target], root: owner as Element | Document | ShadowRoot })
    }
  }
  let selected: SurfaceSelection = { targets: [], root: null }
  for (const group of groups) {
    if (group.targets.length > selected.targets.length) selected = group
  }
  return selected
}

function formFor(element: Element): HTMLFormElement | null {
  const form = (element as { form?: unknown }).form
  return form instanceof HTMLFormElement ? form : element.closest('form')
}

function closestContainer(element: Element): Element | null {
  return element.closest(FORMLESS_CONTAINER_SELECTOR)
}

function recordedAnchor(): Element | null {
  const anchor = (globalThis as AnchorWorld)[ANCHOR_KEY]
  return anchor?.isConnected ? anchor : null
}

function focusedElement(): Element | null {
  let active: Element | null = document.activeElement
  for (let depth = 0; active && depth < MAX_FOCUS_DEPTH; depth += 1) {
    const inner = active.shadowRoot?.activeElement
    if (!inner) break
    active = inner
  }
  return active
}

function focusedControl(): Element | null {
  const active = focusedElement()
  return active instanceof HTMLInputElement
    || active instanceof HTMLSelectElement
    || active instanceof HTMLTextAreaElement
    ? active
    : null
}

export function controlHint(control: IdentityFormControl): string {
  return normalizedHint([
    control.name,
    control.id,
    control.getAttribute('placeholder') ?? '',
    control.getAttribute('aria-label') ?? '',
    control.getAttribute('title') ?? '',
    ...Array.from(control.labels ?? []).map((label) => label.textContent ?? ''),
  ].join(' '))
}

function normalizedHint(value: string): string {
  return value.replace(/[\s_-]+/g, ' ').toLowerCase()
}
