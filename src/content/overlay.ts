// Closed shadow root; never reads field values or submits.
import { OVERLAY_TOKEN_CSS } from './overlay-tokens'
import {
  clearIdentityFillAnchor,
  declaresIdentityField,
  identityFieldForInput,
  identityFieldKeysForTargets,
  identityTargetsInSurface,
  recordIdentityFillAnchor,
} from './identity-fields'
import type { IdentitySurfaceScan } from './identity-fields'
import { cardFieldsForInput } from './card-fields'
import { oneTimeCodeKindForField } from './one-time-code'
import { isRecord } from '../shared/values'
import { isVisibleInput } from '../shared/dom'
import { fillMatchExplanation } from '../shared/fill-match'
import { lookalikeWarningForResult } from '../shared/lookalike-warning'
import { oneTimeCodeSecondsMessage } from '../shared/one-time-code-copy'
import {
  DEFAULT_MAX_SCAN_DEPTH,
  collectInputs,
  eventTargetInput,
} from './input-scan'
import {
  inspectPasswordSurface,
  classifyPasswordFields,
  visiblePasswordFields,
  type PasswordSurfaceKind,
} from './registration'
import {
  RELEASE_BLOCKED_MESSAGE,
  RELEASE_UNSUPPORTED_MESSAGE,
  createReleaseGate,
} from './release-gate'
import { DEFAULT_PASSWORD_STYLE, type CardFieldKey, type IdentityFieldKey, type PasswordStyle } from '../protocol/native'

// Static stylesheet set via textContent, never parsed as markup.
const OVERLAY_CSS = `
        :host{all:initial;opacity:1 !important}
        ${OVERLAY_TOKEN_CSS}
        .card{display:inline-flex;align-items:center;gap:8px;padding:6px 8px 6px 6px;
          font-family:var(--font-ui);background:var(--surface);color:var(--text-heading);
          border:1px solid var(--border);border-radius:var(--radius-md);box-shadow:var(--shadow-pop)}
        .mark{display:inline-grid;place-items:center;width:22px;height:22px;flex:0 0 22px;border-radius:var(--radius-sm);
          background:var(--gold);color:var(--gold-mark-text)}
        .mark svg{display:block;width:15px;height:15px}
        button{font-family:inherit}
        .fill{border:0;border-radius:var(--radius-sm);padding:6px 12px;cursor:pointer;
          background:var(--accent);color:var(--on-accent);box-shadow:var(--button-shadow);
          font-size:var(--type-2);font-weight:var(--weight-medium);white-space:nowrap;
          transition:background-color .16s ease,box-shadow .16s ease,transform .1s ease}
        .fill:hover{background:var(--accent-hover)}
        .fill:active:not(:disabled){transform:scale(.97);background:var(--accent-active);box-shadow:var(--button-shadow-pressed)}
        .fill:disabled{opacity:.5;cursor:default}
        .choice{border:0;border-radius:var(--radius-sm);padding:5px 10px;
          background:var(--button-secondary-bg);color:var(--text-heading);cursor:pointer;
          font-family:inherit;font-size:var(--type-2)}.choice[hidden]{display:none}
        .choice:disabled{opacity:.5;cursor:default}
        .choice:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
        .identity{border:0;border-radius:var(--radius-sm);padding:6px 10px;
          background:var(--button-secondary-bg);color:var(--text-heading);
          cursor:pointer;font-size:var(--type-2);font-weight:var(--weight-medium);white-space:nowrap}.identity[hidden]{display:none}
        .identity:disabled{opacity:.5;cursor:default}
        .code{border:0;border-radius:var(--radius-sm);padding:6px 10px;
          background:var(--button-secondary-bg);color:var(--text-heading);
          cursor:pointer;font-size:var(--type-2);font-weight:var(--weight-medium);white-space:nowrap}.code[hidden]{display:none}
        .code:disabled{opacity:.5;cursor:default}
        .identity:hover:not(:disabled),.choice:hover:not(:disabled),.code:hover:not(:disabled){background:var(--button-secondary-hover-bg)}
        .identity:active:not(:disabled),.choice:active:not(:disabled),.code:active:not(:disabled){transform:scale(.97)}
        .status{max-width:220px;color:var(--text-muted);font-size:var(--type-2);line-height:1.3}
        .card button:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
        .close{border:0;background:transparent;color:var(--text-faint);cursor:pointer;font-size:var(--type-3);line-height:1;display:inline-grid;place-items:center;width:24px;height:24px;padding:0}`

export interface OverlayOptions {
  onFillRequest(): Promise<unknown> | unknown
  onConnectionCheck(force?: boolean): Promise<unknown> | unknown
  onOpenDesktop(): Promise<unknown> | unknown
  onFillIdentityRequest(): Promise<unknown> | unknown
  onFillCardRequest(): Promise<unknown> | unknown
  onFillOneTimeCodeRequest(): Promise<unknown> | unknown
  onCreatePasswordRequest?(style: PasswordStyle): Promise<unknown> | unknown
}

const CAPABILITY_TTL_MS = 15_000
const MAX_OBSERVED_SHADOW_ROOTS = 64

export const REGISTRATION_CHOICES = [
  ['characters:20', '20 characters'],
  ['characters:16', '16 characters'],
  ['characters:24', '24 characters'],
  ['characters:32', '32 characters'],
  ['passphrase:5', '5-word passphrase'],
  ['passphrase:6', '6-word passphrase'],
  ['passphrase:7', '7-word passphrase'],
] as const

export function registrationChoiceStyle(value: string): PasswordStyle {
  const passphrase = /^passphrase:(\d+)$/.exec(value)
  if (passphrase) return { style: 'passphrase', size: Number(passphrase[1]) }
  const characters = /^characters:(\d+)$/.exec(value)
  return characters ? { style: 'characters', size: Number(characters[1]) } : DEFAULT_PASSWORD_STYLE
}

export type OverlayKind = 'login' | 'username' | 'registration' | 'identity' | 'card' | 'code'

export interface OverlayPlan {
  kind: OverlayKind
  cardFields: CardFieldKey[]
  identityFields: IdentityFieldKey[]
}

export interface SafeAnchor {
  field: HTMLInputElement
  plan: OverlayPlan
}

function overlayPlan(field: HTMLInputElement): OverlayPlan | null {
  const signInField = isLoginField(field)
  const identityField = identityFieldForInput(field) !== undefined
  const cardFields = cardAnchorFields(field, signInField)
  const codeKind = oneTimeCodeKindForField(field)
  if (!signInField && !identityField) {
    if (cardFields.length > 0) return { kind: 'card', cardFields, identityFields: [] }
    return codeKind ? { kind: 'code', cardFields, identityFields: [] } : null
  }

  const scan = identityField ? identityTargetsInSurface(field) : null
  const passwordSurface = passwordSurfaceForAnchor(field, scan)
  const signInKind =
    signInField && (passwordSurface === 'login' || passwordSurface === 'registration')
      ? passwordSurface
      : signInField && passwordSurface === 'none' && isSafeUsernameOnlyAnchor(field)
        ? 'username'
        : null

  if (signInKind === 'login') return { kind: 'login', cardFields, identityFields: [] }
  if (signInKind === 'registration') {
    const identityFields = identityFieldKeysForTargets((scan ?? identityTargetsInSurface(field)).targets)
    return { kind: 'registration', cardFields, identityFields }
  }
  if (signInKind === 'username') {
    const identityFields = scan ? identityFieldKeysForTargets(scan.targets) : []
    const identityMode = identityFields.length > 1 && formOf(field) !== null
    if (identityMode) return { kind: 'identity', cardFields, identityFields }
    return { kind: 'username', cardFields, identityFields }
  }

  const identityFields =
    passwordSurface === 'none' && cardFields.length === 0 && !codeKind && scan
      ? identityFieldKeysForTargets(scan.targets)
      : []
  const identityMode =
    identityFields.length > 1 ||
    (identityFields.length === 1 && declaresIdentityField(field))
  if (identityMode) return { kind: 'identity', cardFields, identityFields }
  if (cardFields.length > 0) return { kind: 'card', cardFields, identityFields }
  if (codeKind) return { kind: 'code', cardFields, identityFields }
  return null
}

function passwordSurfaceForAnchor(
  field: HTMLInputElement,
  scan: IdentitySurfaceScan | null,
): PasswordSurfaceKind {
  const form = formOf(field)
  if (form) {
    return classifyPasswordFields(visiblePasswordFields().filter((password) => password.form === form))
  }
  if (!scan) return inspectPasswordSurface()
  const root = scan.root
  if (root) {
    const inside = visiblePasswordFields().filter((password) => surfaceContains(root, password))
    if (inside.length > 0) return classifyPasswordFields(inside)
  }
  const owner = field.parentElement
  const nearby = owner
    ? visiblePasswordFields().filter((password) => owner.contains(password))
    : []
  return nearby.length > 0 ? classifyPasswordFields(nearby) : 'none'
}

function formOf(field: HTMLInputElement): HTMLFormElement | null {
  return field.form ?? field.closest('form')
}

function surfaceContains(root: Element | Document | ShadowRoot, element: Element): boolean {
  return root instanceof Element ? root.contains(element) : element.getRootNode() === root
}

let sharedHostId: string | undefined

type OverlayGlobal = typeof globalThis & {
  sesameOverlayPresentStatus?: (text: string) => void
}

export function overlayHost(): HTMLDivElement | null {
  return sharedHostId ? (document.getElementById(sharedHostId) as HTMLDivElement | null) : null
}

export function showFillStatus(result: unknown): boolean {
  const present = (globalThis as OverlayGlobal).sesameOverlayPresentStatus
  if (typeof present !== 'function') return false
  present(fillMessage(result))
  return overlayHost()?.style.display === 'block'
}

function ensureHostId(): string {
  sharedHostId ??= `sesame-overlay-${crypto.randomUUID()}`
  return sharedHostId
}

export function attachInlineButton(options: OverlayOptions): () => void {
  let stopped = false
  let host: HTMLDivElement | null = null
  let button: HTMLButtonElement | null = null
  let identityButton: HTMLButtonElement | null = null
  let status: HTMLSpanElement | null = null
  let anchorField: HTMLInputElement | null = null
  let dismissedField: HTMLInputElement | null = null
  let registrationMode = false
  let identityMode = false
  let shownKind: OverlayKind | null = null
  let identityFieldsAvailable: IdentityFieldKey[] = []
  let statusPresenter: ((text: string) => void) | undefined
  let choice: HTMLSelectElement | null = null
  let choiceValue: string = REGISTRATION_CHOICES[0][0]
  let cardButton: HTMLButtonElement | null = null
  let cardFieldsAvailable: CardFieldKey[] = []
  let cardMode = false
  let codeButton: HTMLButtonElement | null = null
  let codeMode = false
  let filling = false
  let capability: unknown
  let capabilityAt = 0
  let hideTimer: ReturnType<typeof setTimeout> | undefined
  let connectionRefreshTimer: ReturnType<typeof setTimeout> | undefined
  const releaseGate = createReleaseGate(renderState)
  let releasing = false

  function ensureOverlay() {
    if (host) return
    const hostId = ensureHostId()
    document.getElementById(hostId)?.remove()
    host = document.createElement('div')
    host.id = hostId
    host.style.cssText = 'all:initial;position:absolute;z-index:2147483647;display:none;'
    const shadow = host.attachShadow({ mode: 'closed' })
    // Built from DOM nodes, never parsed from a string.
    const style = document.createElement('style')
    style.textContent = OVERLAY_CSS
    shadow.append(style)

    const card = document.createElement('div')
    card.className = 'card'

    const mark = document.createElement('span')
    mark.className = 'mark'
    mark.setAttribute('aria-hidden', 'true')
    const svgNamespace = 'http://www.w3.org/2000/svg'
    const icon = document.createElementNS(svgNamespace, 'svg')
    icon.setAttribute('viewBox', '0 0 512 512')
    const seedHead = document.createElementNS(svgNamespace, 'circle')
    seedHead.setAttribute('cx', '256')
    seedHead.setAttribute('cy', '207')
    seedHead.setAttribute('r', '58')
    seedHead.setAttribute('fill', 'currentColor')
    const seedBody = document.createElementNS(svgNamespace, 'path')
    seedBody.setAttribute('d', 'M226 247h60l27 126a22 22 0 0 1-22 27h-70a22 22 0 0 1-22-27l27-126Z')
    seedBody.setAttribute('fill', 'currentColor')
    const sprout = document.createElementNS(svgNamespace, 'path')
    sprout.setAttribute('d', 'M118 138c-18 32-27 67-28 105')
    sprout.setAttribute('fill', 'none')
    sprout.setAttribute('stroke', 'var(--gold-soft-bg)')
    sprout.setAttribute('stroke-width', '26')
    sprout.setAttribute('stroke-linecap', 'round')
    sprout.setAttribute('opacity', '.9')
    icon.append(seedHead, seedBody, sprout)
    mark.append(icon)

    const fill = document.createElement('button')
    fill.className = 'fill'
    fill.type = 'button'
    fill.textContent = 'Fill with Sesame'

    const identityFill = document.createElement('button')
    identityFill.className = 'identity'
    identityFill.type = 'button'
    identityFill.hidden = true
    identityFill.textContent = 'Fill identity'

    const cardFill = document.createElement('button')
    cardFill.className = 'fill'
    cardFill.type = 'button'
    cardFill.hidden = true
    cardFill.textContent = 'Fill card'

    const codeFill = document.createElement('button')
    codeFill.className = 'code'
    codeFill.type = 'button'
    codeFill.hidden = true
    codeFill.textContent = 'Fill code'

    const generate = document.createElement('select')
    generate.className = 'choice'
    generate.hidden = true
    generate.setAttribute('aria-label', 'Password format')
    for (const [value, label] of REGISTRATION_CHOICES) {
      const option = document.createElement('option')
      option.value = value
      option.textContent = label
      generate.append(option)
    }
    generate.value = choiceValue

    const statusNode = document.createElement('span')
    statusNode.className = 'status'
    statusNode.setAttribute('role', 'status')

    const close = document.createElement('button')
    close.className = 'close'
    close.type = 'button'
    close.title = 'Dismiss'
    close.setAttribute('aria-label', 'Dismiss')
    close.textContent = '×'

    card.append(mark, fill, identityFill, cardFill, codeFill, generate, statusNode, close)
    shadow.append(card)

    button = fill
    identityButton = identityFill
    cardButton = cardFill
    codeButton = codeFill
    choice = generate
    status = statusNode
    statusPresenter = (text) => { statusNode.textContent = text }
    ;(globalThis as OverlayGlobal).sesameOverlayPresentStatus = statusPresenter
    card.addEventListener('mousedown', preventFieldBlur)
    fill.addEventListener('click', onFillClick)
    identityFill.addEventListener('click', onFillIdentityClick)
    cardFill.addEventListener('click', onFillCardClick)
    codeFill.addEventListener('click', onFillCodeClick)
    generate.addEventListener('change', onChoiceChange)
    close.addEventListener('click', dismiss)
    document.documentElement.append(host)
    releaseGate.observe(host)
  }

  function preventFieldBlur(event: MouseEvent) {
    if (event.target instanceof HTMLSelectElement) return
    event.preventDefault()
  }

  function onChoiceChange() {
    if (choice) choiceValue = choice.value
  }

  function showOverlay(anchor: SafeAnchor) {
    if (anchor.field === dismissedField) return
    const plan = anchor.plan
    ensureOverlay()
    anchorField = anchor.field
    shownKind = plan.kind
    cardMode = plan.kind === 'card'
    codeMode = plan.kind === 'code'
    identityMode = plan.kind === 'identity'
    cardFieldsAvailable = plan.cardFields
    registrationMode = plan.kind === 'registration'
    identityFieldsAvailable = plan.identityFields
    if (status) status.textContent = ''
    if (host) {
      host.style.display = 'block'
    }
    releaseGate.rearm()
    positionOverlay()
    renderState()
    if (!registrationMode && !identityMode) void refreshCapability()
  }

  function hideOverlay() {
    if (host) host.style.display = 'none'
    anchorField = null
    shownKind = null
    identityMode = false
    codeMode = false
    releaseGate.rearm()
  }

  function dismiss() {
    dismissedField = anchorField
    hideOverlay()
  }

  function positionOverlay() {
    if (!host || !anchorField) return
    const bounds = anchorField.getBoundingClientRect()
    const gap = 5
    const margin = 8
    const width = host.offsetWidth
    const height = host.offsetHeight
    let left = bounds.left
    if (left + width > window.innerWidth - margin) left = window.innerWidth - width - margin
    let top = bounds.bottom + gap
    if (top + height > window.innerHeight - margin) top = bounds.top - height - gap
    host.style.top = `${window.scrollY + Math.max(margin, top)}px`
    host.style.left = `${window.scrollX + Math.max(margin, left)}px`
  }

  function renderState() {
    if (!button) return
    const blocked = !releaseGate.isOpen()
    if (!releaseGate.supported && status && status.textContent === '') {
      status.textContent = RELEASE_UNSUPPORTED_MESSAGE
    }
    if (cardButton) {
      cardButton.hidden = !(cardMode && cardFieldsAvailable.length > 0)
      cardButton.disabled = filling || blocked
      cardButton.textContent = filling ? 'Filling…' : 'Fill card'
    }
    if (codeButton) {
      codeButton.hidden = !codeMode
      codeButton.disabled = filling || blocked
      codeButton.textContent = filling ? 'Filling…' : 'Fill code'
    }
    if (cardMode || codeMode) {
      button.hidden = true
      button.disabled = filling || blocked
      if (identityButton) {
        identityButton.className = 'identity'
        identityButton.hidden = true
      }
      if (choice) choice.hidden = true
      return
    }
    if (identityMode) {
      button.hidden = true
      button.disabled = filling || blocked
      if (choice) choice.hidden = true
      if (identityButton) {
        identityButton.className = 'fill'
        identityButton.hidden = false
        identityButton.disabled = filling || blocked
        identityButton.textContent = filling ? 'Filling…' : 'Fill identity'
      }
      return
    }
    button.hidden = false
    if (choice) {
      choice.hidden = !registrationMode
      choice.disabled = filling
    }
    if (identityButton) {
      identityButton.className = 'identity'
      identityButton.hidden = identityFieldsAvailable.length === 0
      identityButton.disabled = filling || blocked
      identityButton.textContent = filling ? 'Filling…' : 'Fill identity'
    }
    if (filling) {
      button.textContent = registrationMode ? 'Creating…' : 'Filling…'
      button.disabled = true
      return
    }
    button.disabled = blocked
    if (registrationMode) {
      button.textContent = 'Create password with Sesame'
      return
    }
    const state = recordString(capability, 'state')
    button.textContent =
      state === 'locked'
        ? 'Unlock Sesame to fill'
        : state === 'desktop-offline' || state === 'unavailable'
          ? 'Open Sesame'
          : 'Fill with Sesame'
  }

  async function refreshCapability(force = false) {
    if (!force && capability && Date.now() - capabilityAt < CAPABILITY_TTL_MS) {
      renderState()
      return
    }
    try {
      capability = await options.onConnectionCheck(force)
      capabilityAt = Date.now()
    } catch {
      capability = undefined
    }
    renderState()
  }

  async function refuseRelease(event: MouseEvent): Promise<boolean> {
    if (releasing) return true
    if (releaseGate.allowsClick(event)) {
      releasing = true
      let visible = false
      try {
        visible = await releaseGate.confirmFresh()
      } finally {
        releasing = false
      }
      if (visible) return false
    }
    if (status) status.textContent = RELEASE_BLOCKED_MESSAGE
    releaseGate.invalidate()
    renderState()
    return true
  }

  async function onFillClick(event: MouseEvent) {
    if (filling || !anchorField) return
    if (await refuseRelease(event)) return
    if (filling || !anchorField) return
    filling = true
    renderState()
    if (status) status.textContent = ''
    try {
      if (registrationMode) {
        const result = await options.onCreatePasswordRequest?.(registrationChoiceStyle(choiceValue))
        if (status) status.textContent = createMessage(result)
      } else {
        if (!capability) await refreshCapability(true)
        const connectionState = recordString(capability, 'state')
        if (
          connectionState === 'locked' ||
          connectionState === 'desktop-offline' ||
          connectionState === 'unavailable'
        ) {
          const result = await options.onOpenDesktop()
          if (recordString(result, 'state') === 'opened') {
            if (status)
              status.textContent =
                connectionState === 'locked'
                  ? 'Sesame is open. Unlock it to continue.'
                  : 'Opening Sesame…'
            capability = undefined
            capabilityAt = 0
            connectionRefreshTimer = setTimeout(() => {
              void refreshCapability(true)
            }, 750)
          } else if (status) {
            status.textContent =
              'Sesame could not be opened. Start the desktop app once and try again.'
          }
          return
        }
        const result = await options.onFillRequest()
        if (status) status.textContent = fillMessage(result)
        if (recordString(result, 'state') === 'filled') {
          hideTimer = setTimeout(hideOverlay, 4_000)
        } else {
          capability = undefined
          capabilityAt = 0
          void refreshCapability()
        }
      }
    } catch {
      if (status) status.textContent = 'Sesame could not fill this form.'
    } finally {
      filling = false
      renderState()
    }
  }

  async function onFillCardClick(event: MouseEvent) {
    await runFillRequest(event, options.onFillCardRequest, cardFillMessage)
  }

  async function onFillCodeClick(event: MouseEvent) {
    await runFillRequest(event, options.onFillOneTimeCodeRequest, oneTimeCodeMessage, true)
  }

  async function onFillIdentityClick(event: MouseEvent) {
    await runFillRequest(
      event,
      options.onFillIdentityRequest,
      identityFillMessage,
      identityMode,
      () => {
        if (anchorField) recordIdentityFillAnchor(anchorField)
      },
    )
  }

  async function runFillRequest(
    event: MouseEvent,
    request: () => unknown,
    message: (result: unknown) => string,
    hideOnSuccess = false,
    beforeRequest?: () => void,
  ) {
    if (filling || !anchorField) return
    if (await refuseRelease(event)) return
    if (filling || !anchorField) return
    filling = true
    renderState()
    if (status) status.textContent = ''
    try {
      beforeRequest?.()
      const result = await request()
      if (status) status.textContent = message(result)
      if (hideOnSuccess && isRecord(result) && result.ok === true) {
        hideTimer = setTimeout(hideOverlay, 4_000)
      }
    } catch {
      if (status) status.textContent = 'Sesame could not fill this form.'
    } finally {
      clearIdentityFillAnchor()
      filling = false
      renderState()
    }
  }

  function refreshFocusedField() {
    if (stopped) return
    if (anchorField) {
      const safeAnchor = findSafeAnchor(anchorField)
      if (safeAnchor) {
        if (safeAnchor.plan.kind !== shownKind
          || !sameFields(safeAnchor.plan.identityFields, identityFieldsAvailable)) {
          showOverlay(safeAnchor)
        } else {
          positionOverlay()
        }
        return
      }
      hideOverlay()
    }
    const active = focusedInput()
    if (active) {
      const safeAnchor = findSafeAnchor(active)
      if (safeAnchor) showOverlay(safeAnchor)
    }
  }

  function onFocusIn(event: FocusEvent) {
    const target = eventTargetInput(event)
    if (!target) return
    if (target !== dismissedField) dismissedField = null
    observePageRoots()
    const safeAnchor = findSafeAnchor(target)
    if (safeAnchor) showOverlay(safeAnchor)
    else hideOverlay()
  }

  function onFocusOut() {
    setTimeout(() => {
      if (!host || document.activeElement === host) return
      const active = focusedInput()
      if (!active || !findSafeAnchor(active)) hideOverlay()
    }, 150)
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && host?.style.display === 'block') dismiss()
  }

  const pageObserver = new MutationObserver((records) => {
    if (
      records.some(
        (record) => record.type === 'childList' || record.target instanceof HTMLInputElement,
      )
    ) {
      if (records.some((record) => record.type === 'childList')) observePageRoots()
      refreshFocusedField()
    }
  })
  const observedRoots = new WeakSet<Node>()
  let observedShadowRoots = 0

  function observeRoot(root: Node) {
    if (observedRoots.has(root)) return
    observedRoots.add(root)
    pageObserver.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'type',
        'disabled',
        'readonly',
        'hidden',
        'style',
        'class',
        'autocomplete',
        'name',
        'id',
      ],
    })
  }

  function observePageRoots() {
    observeRoot(document.documentElement)
    for (const root of collectInputs(document).shadowRoots) {
      if (observedRoots.has(root)) continue
      if (observedShadowRoots >= MAX_OBSERVED_SHADOW_ROOTS) return
      observedShadowRoots += 1
      observeRoot(root)
    }
  }

  observePageRoots()
  document.addEventListener('focusin', onFocusIn, true)
  document.addEventListener('focusout', onFocusOut, true)
  document.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('resize', positionOverlay)
  window.addEventListener('scroll', positionOverlay, true)
  refreshFocusedField()

  return () => {
    stopped = true
    pageObserver.disconnect()
    document.removeEventListener('focusin', onFocusIn, true)
    document.removeEventListener('focusout', onFocusOut, true)
    document.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('resize', positionOverlay)
    window.removeEventListener('scroll', positionOverlay, true)
    if (hideTimer !== undefined) clearTimeout(hideTimer)
    if (connectionRefreshTimer !== undefined) clearTimeout(connectionRefreshTimer)
    releaseGate.destroy()
    if ((globalThis as OverlayGlobal).sesameOverlayPresentStatus === statusPresenter) {
      ;(globalThis as OverlayGlobal).sesameOverlayPresentStatus = undefined
    }
    statusPresenter = undefined
    host?.remove()
    host = null
    button = null
    identityButton = null
    cardButton = null
    cardMode = false
    cardFieldsAvailable = []
    identityMode = false
    identityFieldsAvailable = []
    shownKind = null
    codeButton = null
    codeMode = false
    choice = null
    status = null
    anchorField = null
  }
}

function focusedInput(): HTMLInputElement | null {
  let active: Element | null = document.activeElement
  let depth = 0
  while (active && depth < DEFAULT_MAX_SCAN_DEPTH) {
    const root = active.shadowRoot
    if (!root?.activeElement) break
    active = root.activeElement
    depth += 1
  }
  return active instanceof HTMLInputElement ? active : null
}

export function findSafeAnchor(field: HTMLInputElement): SafeAnchor | null {
  if (collectInputs(document).truncated) return null
  if (!isVisibleInput(field)) return null
  const plan = overlayPlan(field)
  if (!plan) return null
  if (plan.kind !== 'login' && plan.kind !== 'registration') return { field, plan }
  const passwords = visiblePasswordFields()
  if (passwords.length === 0) return null
  const passwordOwner = ownerOf(passwords[0])
  if (passwords.some((candidate) => ownerOf(candidate) !== passwordOwner)) return null
  if (field.type === 'password') {
    return passwords.includes(field) ? { field, plan } : null
  }
  return ownerOf(field) === passwordOwner ? { field, plan } : null
}

function isSafeUsernameOnlyAnchor(field: HTMLInputElement): boolean {
  if (field.type === 'password') return false
  const scan = collectInputs(document)
  if (scan.truncated) return false
  const inputs = scan.inputs.filter((input) => isVisibleInput(input))
  const candidates = inputs.filter(
    (candidate) => candidate.type !== 'password' && isLoginField(candidate),
  )
  if (candidates.length !== 1 || candidates[0] !== field) return false
  const autocomplete = String(field.autocomplete).toLowerCase().split(/\s+/)
  const explicit =
    field.type === 'email' || autocomplete.includes('username') || autocomplete.includes('email')
  if (!explicit) return false
  const surface = field.form ?? field.parentElement
  const controls = surface
    ? Array.from(
        surface.querySelectorAll<HTMLElement>('button, input[type="submit"], input[type="button"]'),
      )
    : []
  const hint = [surface, field, ...controls]
    .map((element) => {
      if (!element) return ''
      const named = element as HTMLElement & { name?: string }
      return `${named.name ?? ''} ${element.id} ${element.className} ${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('title') ?? ''} ${element === field ? '' : (element.textContent ?? '')}`
    })
    .join(' ')
    .toLowerCase()
  if (/sign[\s_-]?up|register|create[\s_-]?(?:account|password)|reset|forgot/.test(hint))
    return false
  return /log[\s_-]?in|sign[\s_-]?in|authenticate|account|identifier|session|continue|next/.test(
    hint,
  )
}

function isLoginField(field: HTMLInputElement): boolean {
  const type = String(field.type).toLowerCase()
  if (type === 'password') return true
  if (!['email', 'text', 'tel'].includes(type)) return false
  const autocomplete = String(field.autocomplete).toLowerCase()
  const hint = `${field.name} ${field.id}`.toLowerCase()
  return (
    autocomplete === 'username' ||
    autocomplete === 'email' ||
    type === 'email' ||
    /user|login|email|account|identifier/.test(hint)
  )
}

function ownerOf(field: HTMLInputElement): Element {
  return field.form ?? field.parentElement ?? field
}

export function fillMessage(result: unknown): string {
  const lookalike = lookalikeWarningForResult(result)
  if (lookalike) return lookalike
  if (recordString(result, 'state') === 'filled') {
    return fillMatchExplanation(recordString(result, 'matchKind')) ?? 'Filled. Review the page and sign in.'
  }
  const code = recordString(result, 'code') || recordString(result, 'reason')
  if (code === 'cancelled') return 'Fill was cancelled. Nothing was filled.'
  if (code === 'password-limit-too-short') return "This site's password limit is too short for Sesame to create a password here."
  if (code === 'origin-mismatch' || code === 'no-match') return 'No saved login matches this site. Check that Sesame is unlocked, then try again.'
  if (code === 'protocol-mismatch') return 'The Sesame desktop app needs an update to fill this login.'
  if (code === 'vault-locked' || code === 'locked') return 'Unlock Sesame, then try again.'
  if (code === 'desktop-unavailable' || code === 'host-not-found')
    return 'Open Sesame, then try again.'
  if (/host-disconnected|host-exited|host-communication-failed|timeout/.test(code)) {
    return 'The desktop connection closed. Keep Sesame open and try again.'
  }
  if (/approval-declined/.test(code)) return 'Nothing was filled. The request was declined.'
  if (/approval-unavailable|approval-timeout|stale-request/.test(code))
    return 'Approval expired. Try filling again.'
  if (/page-changed|stale-document/.test(code)) return 'The page changed. Try filling again.'
  if (code === 'field-write-failed')
    return 'This site blocked the field update. Nothing was submitted.'
  if (/signup|password-change|multiple|no-fields/.test(code))
    return 'This form cannot be filled automatically.'
  return 'Sesame could not fill this form.'
}

export function cardAnchorFields(field: HTMLInputElement, isSignInField: boolean): CardFieldKey[] {
  return isSignInField ? [] : cardFieldsForInput(field)
}

export function cardFillMessage(result: unknown): string {
  if (!isRecord(result)) return 'Sesame could not fill this form.'
  if (result.ok === true) {
    const count = Array.isArray(result.filledFields) ? result.filledFields.length : 0
    return count === 1 ? 'Filled one card field.' : `Filled ${count} card fields.`
  }
  const code = recordString(result, 'code')
  if (code === 'no-fields') return 'No card fields to fill on this form.'
  if (code === 'untrusted-frame') return 'Sesame does not fill a card in this embedded frame.'
  if (code === 'insecure-page') return 'Sesame only fills a card on an https page.'
  if (code === 'cancelled') return 'Card fill was declined.'
  if (code === 'page-changed') return 'The page changed before the card was filled.'
  return 'Sesame could not fill this form.'
}

export function oneTimeCodeMessage(result: unknown): string {
  const remainingSeconds = isRecord(result) && result.ok === true && typeof result.remainingSeconds === 'number'
    ? result.remainingSeconds
    : 0
  const secondsMessage = oneTimeCodeSecondsMessage(remainingSeconds)
  if (secondsMessage) return secondsMessage
  const code = recordString(result, 'code')
  if (code === 'cancelled') return 'Fill was cancelled. Nothing was filled.'
  if (code === 'no-match') return 'No one-time code is available for this site.'
  if (code === 'protocol-mismatch') return 'The Sesame desktop app needs an update to fill this code.'
  if (code === 'vault-locked' || code === 'locked') return 'Unlock Sesame, then try again.'
  if (code === 'desktop-unavailable' || code === 'host-not-found') return 'Open Sesame, then try again.'
  if (/host-disconnected|host-exited|host-communication-failed|timeout/.test(code)) {
    return 'The desktop connection closed. Keep Sesame open and try again.'
  }
  if (/approval-declined/.test(code)) return 'Nothing was filled. The request was declined.'
  if (/approval-unavailable|approval-timeout|stale-request/.test(code)) return 'Approval expired. Try filling again.'
  if (/page-changed|stale-document/.test(code)) return 'The page changed. Try filling again.'
  if (code === 'field-write-failed') return 'This site blocked the field update. Nothing was submitted.'
  if (/no-fields|multiple-matches/.test(code)) return 'This form cannot be filled automatically.'
  return 'Sesame could not fill this form.'
}

export function identityFillMessage(result: unknown): string {
  if (isRecord(result) && result.ok === true) {
    return 'Identity filled. Review the page before continuing.'
  }
  const code = recordString(result, 'code')
  if (code === 'no-fields') return 'No identity fields to fill on this form.'
  if (code === 'stale-document') return 'The page changed while filling. Try again.'
  if (code === 'field-write-failed') return 'This site blocked the field update. Nothing was submitted.'
  if (code === 'vault-locked' || code === 'locked') return 'Unlock Sesame, then choose Fill identity again.'
  if (code === 'no-match') return 'No saved identity is available. Add one in Sesame.'
  if (code === 'approval-declined' || code === 'cancelled') return 'The request was declined, so nothing was filled.'
  if (code === 'approval-timeout') return 'The approval expired. Choose Fill identity to try again.'
  if (code === 'multiple-matches') return 'Several forms could take this identity. Click into the one you want, then try again.'
  if (code === 'protocol-mismatch') return 'The Sesame desktop app needs an update to fill this identity.'
  if (code === 'origin-mismatch') return 'The page changed. Try filling again.'
  return fillMessage(result)
}

export function createMessage(result: unknown): string {
  if (isRecord(result) && result.ok === true) return 'Sesame saved a new login. Submit the form, then confirm in Sesame.'
  const code = recordString(result, 'code')
  if (code === 'password-change-form') return 'Choose Change password in the Sesame popup for this form.'
  if (code === 'multiple-matches') return 'More than one form is visible. Sesame did not guess.'
  if (code === 'pending-version-unsupported') return 'Update the Sesame desktop app to create passwords here.'
  if (code === 'password-limit-too-short') return "This site's password limit is too short for Sesame to create a password here."
  if (code === 'vault-locked') return 'Unlock Sesame, then try again.'
  if (code === 'approval-declined' || code === 'cancelled') return 'Nothing was created.'
  if (code === 'approval-timeout') return 'The approval expired. Try again.'
  if (code === 'desktop-unavailable' || code === 'host-not-found') return 'Open Sesame, then try again.'
  if (code === 'fill-in-progress') return 'Sesame is already busy. Try again in a moment.'
  return 'Sesame could not create a password for this form.'
}

function recordString(value: unknown, key: string): string {
  return typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)[key] === 'string'
    ? (value as Record<string, string>)[key]
    : ''
}

function sameFields(left: IdentityFieldKey[], right: IdentityFieldKey[]): boolean {
  return left.length === right.length && left.every((field, index) => field === right[index])
}
