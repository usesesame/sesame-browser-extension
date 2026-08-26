// Closed shadow root; never reads field values or submits.
import { OVERLAY_TOKEN_CSS } from './overlay-tokens'
import { inspectIdentitySurfaceScoped } from './identity-detector'
import { cardFieldsForInput } from './card-fields'
import { isRecord } from '../shared/values'
import { isVisibleInput } from '../shared/dom'
import {
  fillRegistrationSurface,
  inspectPasswordSurface,
  makeRegistrationPassword,
} from './registration'
import { copyTemporarily, type TemporaryCopyHandle } from './temporary-copy'
import type { CardFieldKey, IdentityFieldKey } from '../protocol/native'

// Static stylesheet set via textContent, never parsed as markup.
const OVERLAY_CSS = `
        ${OVERLAY_TOKEN_CSS}
        .card{display:inline-flex;align-items:center;gap:8px;padding:6px 8px 6px 6px;
          font-family:var(--font-ui);background:var(--surface);color:var(--text-heading);
          border:1px solid var(--border);border-radius:var(--radius-md);box-shadow:var(--shadow-pop)}
        .mark{display:inline-grid;place-items:center;width:22px;height:22px;flex:0 0 22px;border-radius:6px;
          background:var(--gold);color:var(--gold-mark-text);font-family:var(--font-display);
          font-size:14px;font-weight:700}
        button{font-family:inherit}
        .fill{border:0;border-radius:var(--radius-sm);padding:6px 12px;cursor:pointer;
          background:var(--accent);color:var(--on-accent);
          font-size:13px;font-weight:600;white-space:nowrap}
        .fill:hover{background:var(--accent-hover)}.fill:disabled{opacity:.6;cursor:default}
        .copy{border:1px solid var(--border-strong);border-radius:var(--radius-sm);padding:6px 9px;
          background:var(--surface);color:var(--accent);
          cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap}.copy[hidden]{display:none}
        .identity{border:1px solid var(--border-strong);border-radius:var(--radius-sm);padding:6px 9px;
          background:var(--surface);color:var(--accent);
          cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap}.identity[hidden]{display:none}
        .identity:disabled{opacity:.6;cursor:default}
        .status{max-width:220px;color:var(--text-muted);font-size:12px;line-height:1.3}
        .close{border:0;background:transparent;color:var(--text-faint);cursor:pointer;font-size:15px;line-height:1;padding:2px 4px}`

export interface OverlayOptions {
  onFillRequest(): Promise<unknown> | unknown
  onConnectionCheck(force?: boolean): Promise<unknown> | unknown
  onOpenDesktop(): Promise<unknown> | unknown
  onFillIdentityRequest(): Promise<unknown> | unknown
  onFillCardRequest(): Promise<unknown> | unknown
}

const HOST_ID = 'sesame-inline-button'
const CAPABILITY_TTL_MS = 15_000
const GENERATED_PASSWORD_TTL_MS = 120_000

export function attachInlineButton(options: OverlayOptions): () => void {
  let stopped = false
  let host: HTMLDivElement | null = null
  let button: HTMLButtonElement | null = null
  let copyButton: HTMLButtonElement | null = null
  let identityButton: HTMLButtonElement | null = null
  let status: HTMLSpanElement | null = null
  let anchorField: HTMLInputElement | null = null
  let dismissedField: HTMLInputElement | null = null
  let registrationMode = false
  let identityFieldsAvailable: IdentityFieldKey[] = []
  let cardButton: HTMLButtonElement | null = null
  let cardFieldsAvailable: CardFieldKey[] = []
  let cardMode = false
  let filling = false
  let capability: unknown
  let capabilityAt = 0
  let registrationPassword = ''
  let copyHandle: TemporaryCopyHandle | undefined
  let expiryTimer: ReturnType<typeof setTimeout> | undefined
  let hideTimer: ReturnType<typeof setTimeout> | undefined
  let connectionRefreshTimer: ReturnType<typeof setTimeout> | undefined

  function ensureOverlay() {
    if (host) return
    document.getElementById(HOST_ID)?.remove()
    host = document.createElement('div')
    host.id = HOST_ID
    host.dataset.sesameOverlay = 'closed'
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
    mark.textContent = 'S'

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

    const copy = document.createElement('button')
    copy.className = 'copy'
    copy.type = 'button'
    copy.hidden = true
    copy.textContent = 'Copy password'

    const statusNode = document.createElement('span')
    statusNode.className = 'status'
    statusNode.setAttribute('role', 'status')

    const close = document.createElement('button')
    close.className = 'close'
    close.type = 'button'
    close.title = 'Dismiss'
    close.setAttribute('aria-label', 'Dismiss')
    close.textContent = '×'

    card.append(mark, fill, identityFill, cardFill, copy, statusNode, close)
    shadow.append(card)

    button = fill
    identityButton = identityFill
    cardButton = cardFill
    copyButton = copy
    status = statusNode
    host.addEventListener('mousedown', preventFieldBlur)
    fill.addEventListener('click', onFillClick)
    identityFill.addEventListener('click', onFillIdentityClick)
    cardFill.addEventListener('click', onFillCardClick)
    copy.addEventListener('click', onCopyPassword)
    close.addEventListener('click', dismiss)
    document.documentElement.append(host)
  }

  function preventFieldBlur(event: MouseEvent) {
    event.preventDefault()
  }

  function showOverlay(field: HTMLInputElement) {
    if (field === dismissedField) return
    const signInField = isLoginField(field)
    const passwordKind = signInField ? inspectPasswordSurface() : 'none'
    const signInKind =
      passwordKind === 'login' || passwordKind === 'registration'
        ? passwordKind
        : signInField && passwordKind === 'none' && isSafeUsernameOnlyAnchor(field)
          ? 'username'
          : null
    const cardFields = cardAnchorFields(field, signInField)
    const kind = signInKind ?? (cardFields.length > 0 ? 'card' : null)
    if (!kind) {
      hideOverlay()
      return
    }
    ensureOverlay()
    anchorField = field
    cardMode = kind === 'card'
    cardFieldsAvailable = cardFields
    registrationMode = kind === 'registration'
    identityFieldsAvailable = registrationMode ? inspectIdentitySurfaceScoped(ownerOf(field)) : []
    if (status) status.textContent = ''
    if (copyButton && !registrationPassword) copyButton.hidden = true
    if (host) {
      host.dataset.surface = kind
      host.style.display = 'block'
    }
    positionOverlay()
    renderState()
    if (!registrationMode) void refreshCapability()
  }

  function hideOverlay() {
    if (host) host.style.display = 'none'
    anchorField = null
  }

  function dismiss() {
    dismissedField = anchorField
    hideOverlay()
  }

  function positionOverlay() {
    if (!host || !anchorField) return
    const bounds = anchorField.getBoundingClientRect()
    host.style.top = `${window.scrollY + bounds.bottom + 5}px`
    host.style.left = `${window.scrollX + bounds.left}px`
  }

  function renderState() {
    if (!button) return
    if (cardButton) {
      cardButton.hidden = !(cardMode && cardFieldsAvailable.length > 0)
      cardButton.disabled = filling
      cardButton.textContent = filling ? 'Filling…' : 'Fill card'
    }
    if (cardMode) {
      button.hidden = true
      if (identityButton) identityButton.hidden = true
      if (copyButton) copyButton.hidden = true
      return
    }
    button.hidden = false
    if (identityButton) {
      identityButton.hidden = !(registrationMode && identityFieldsAvailable.length > 0)
      identityButton.disabled = filling
      identityButton.textContent = filling ? 'Filling…' : 'Fill identity'
    }
    if (filling) {
      button.textContent = registrationMode ? 'Creating…' : 'Filling…'
      button.disabled = true
      return
    }
    button.disabled = false
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

  async function onFillClick() {
    if (filling || !anchorField) return
    filling = true
    renderState()
    if (status) status.textContent = ''
    try {
      if (registrationMode) {
        copyHandle?.cancel()
        if (expiryTimer !== undefined) clearTimeout(expiryTimer)
        registrationPassword = makeRegistrationPassword()
        const outcome = fillRegistrationSurface(location.origin, registrationPassword)
        if (!outcome.ok) {
          registrationPassword = ''
          if (copyButton) copyButton.hidden = true
          if (status) status.textContent = registrationMessage(outcome.code)
        } else {
          if (copyButton) {
            copyButton.hidden = false
            copyButton.textContent = 'Copy password'
          }
          if (status)
            status.textContent =
              outcome.fieldsFilled > 1 ? 'Password and confirmation filled.' : 'Password filled.'
          expiryTimer = setTimeout(clearRegistrationPassword, GENERATED_PASSWORD_TTL_MS)
        }
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
          hideTimer = setTimeout(hideOverlay, 2_200)
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

  async function onFillCardClick() {
    await runFillRequest(options.onFillCardRequest, cardFillMessage)
  }

  async function onFillIdentityClick() {
    await runFillRequest(options.onFillIdentityRequest, identityFillMessage)
  }

  async function runFillRequest(request: () => unknown, message: (result: unknown) => string) {
    if (filling || !anchorField) return
    filling = true
    renderState()
    if (status) status.textContent = ''
    try {
      const result = await request()
      if (status) status.textContent = message(result)
    } catch {
      if (status) status.textContent = 'Sesame could not fill this form.'
    } finally {
      filling = false
      renderState()
    }
  }

  async function onCopyPassword() {
    if (!registrationPassword || !copyButton) return
    try {
      copyHandle?.cancel()
      copyHandle = await copyTemporarily(registrationPassword, {
        onExpired: () => {
          if (copyButton) copyButton.textContent = 'Copy password'
        },
      })
      copyButton.textContent = 'Copied'
      if (status) status.textContent = 'Copied temporarily. Save the login in Sesame after sign-up.'
    } catch {
      if (status) status.textContent = 'The password is filled, but clipboard access was blocked.'
    }
  }

  function clearRegistrationPassword() {
    registrationPassword = ''
    expiryTimer = undefined
    if (copyButton) copyButton.hidden = true
  }

  function refreshFocusedField() {
    if (stopped) return
    if (anchorField) {
      const safeAnchor = findSafeAnchor(anchorField)
      if (safeAnchor) {
        const nextRegistrationMode = inspectPasswordSurface() === 'registration'
        if (nextRegistrationMode !== registrationMode) showOverlay(safeAnchor)
        else positionOverlay()
        return
      }
      hideOverlay()
    }
    const active = document.activeElement
    if (active instanceof HTMLInputElement) {
      const safeAnchor = findSafeAnchor(active)
      if (safeAnchor) showOverlay(safeAnchor)
    }
  }

  function onFocusIn(event: FocusEvent) {
    const target = event.target
    if (!(target instanceof HTMLInputElement)) return
    if (target !== dismissedField) dismissedField = null
    const safeAnchor = findSafeAnchor(target)
    if (safeAnchor) showOverlay(safeAnchor)
    else hideOverlay()
  }

  function onFocusOut() {
    setTimeout(() => {
      if (!host || document.activeElement === host) return
      const active = document.activeElement
      if (!(active instanceof HTMLInputElement) || !findSafeAnchor(active)) hideOverlay()
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
      refreshFocusedField()
    }
  })
  pageObserver.observe(document.documentElement, {
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
    if (expiryTimer !== undefined) clearTimeout(expiryTimer)
    if (connectionRefreshTimer !== undefined) clearTimeout(connectionRefreshTimer)
    copyHandle?.cancel()
    registrationPassword = ''
    host?.remove()
    host = null
    button = null
    identityButton = null
    cardButton = null
    cardMode = false
    cardFieldsAvailable = []
    copyButton = null
    status = null
    anchorField = null
  }
}

function findSafeAnchor(field: HTMLInputElement): HTMLInputElement | null {
  if (!isVisibleInput(field)) return null
  if (!isLoginField(field)) return cardFieldsForInput(field).length > 0 ? field : null
  const kind = inspectPasswordSurface()
  if (kind === 'none') return isSafeUsernameOnlyAnchor(field) ? field : null
  if (kind !== 'login' && kind !== 'registration') return null
  const passwords = visiblePasswordFields()
  if (passwords.length === 0) return null
  const passwordOwner = ownerOf(passwords[0])
  if (passwords.some((candidate) => ownerOf(candidate) !== passwordOwner)) return null
  if (field.type === 'password') return passwords.includes(field) ? field : null
  return ownerOf(field) === passwordOwner ? field : null
}

function isSafeUsernameOnlyAnchor(field: HTMLInputElement): boolean {
  if (field.type === 'password') return false
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input')).filter((input) => isVisibleInput(input))
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

function visiblePasswordFields(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]')).filter(
    (input) => isVisibleInput(input),
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
  if (recordString(result, 'state') === 'filled') return 'Filled. Review the page and sign in.'
  const code = recordString(result, 'code') || recordString(result, 'reason')
  if (code === 'cancelled') return ''
  if (code === 'origin-mismatch' || code === 'no-match') return 'No saved login matches this site.'
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

export function identityFillMessage(result: unknown): string {
  if (isRecord(result) && result.ok === true) {
    return 'Identity filled. Review the page before continuing.'
  }
  const code = recordString(result, 'code')
  if (code === 'origin-mismatch') return 'The page changed. Try filling again.'
  if (code === 'no-fields') return 'No identity fields to fill on this form.'
  if (code === 'stale-document') return 'The page changed while filling. Try again.'
  if (code === 'field-write-failed') return 'This site blocked the field update. Nothing was submitted.'
  return 'Sesame could not fill this form.'
}

function registrationMessage(code: string): string {
  if (code === 'password-change-form') return 'Password-change forms are not filled.'
  if (code === 'multiple-matches') return 'More than one form is visible. Sesame did not guess.'
  return 'Sesame could not create a password for this form.'
}

function recordString(value: unknown, key: string): string {
  return typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)[key] === 'string'
    ? (value as Record<string, string>)[key]
    : ''
}
