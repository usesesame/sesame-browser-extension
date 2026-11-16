<script lang="ts">
  import { onMount } from 'svelte'
  import {
    popupState, setChecking, setUnavailable, setDesktopOffline, setReady,
    setHostname, setPageDiagnostic,
  } from './states/store'
  import type { OneTimeCodeKind } from '../content/one-time-code'
  import { fillMatchExplanation } from '../shared/fill-match'
  import { lookalikeWarningForResult } from '../shared/lookalike-warning'
  import { oneTimeCodeSecondsMessage } from '../shared/one-time-code-copy'
  import { DEFAULT_PASSWORD_STYLE, normalizeFillOrigin } from '../protocol/native'
  import { GENERATED_MESSAGES, acceptMessage, generatedMessage, type PendingKindView } from './generated-messages'
  import { pageSurfaceView, type PageKind } from './page-surfaces'
  import { createRevisionGate } from './pending-revision'
  import {
    CHECKING_PRESENTATION, CONNECTION_RESPONSE_TIMEOUT_MS, DESKTOP_RELEASES_URL, presentConnection, type ConnectionPresentation,
  } from '../protocol/connection-presentation'
  import {
    GLOBAL_HTTPS_PATTERN, inlinePermissionMode, loadInlineSettings, originPattern, setSitePaused,
  } from '../permissions/inline-access'
  import Header from './components/Header.svelte'
  import StatusCard from './components/StatusCard.svelte'
  import { SESAME_LINKS } from '../shared/links'
  import FillButton from './components/FillButton.svelte'
  import Diagnostics from './components/Diagnostics.svelte'

  const RECONNECT_DELAY_MS = 4_000
  const POPUP_RESPONSE_TIMEOUT_MS = CONNECTION_RESPONSE_TIMEOUT_MS
  const PAGE_CHECK_TIMEOUT_MS = 6_000

  const FILL_MESSAGES: Record<string, string> = {
    'approval-declined': 'Nothing was filled. The request was declined in Sesame.',
    'approval-timeout': 'The approval expired. Choose Fill to try again.',
    'approval-unavailable': 'Sesame could not show the approval. Bring the desktop app forward and retry.',
    'cancelled': 'The request was cancelled. Nothing was filled.',
    'desktop-unavailable': 'Keep Sesame open, then try again.',
    'field-write-failed': 'This site blocked the field update. Nothing was submitted.',
    'fill-in-progress': 'A fill request is already open.',
    'fill-unavailable': 'Filling is unavailable in this desktop build.',
    'host-disconnected': 'The desktop connection closed. Keep Sesame open and retry.',
    'host-not-found': 'Open the Sesame desktop app, then retry.',
    'invalid-response': 'Sesame returned an invalid fill response. Update or restart the app.',
    'invalid-selection': 'That login is no longer available. Try again.',
    'multiple-matches': 'More than one login form was found. Sesame did not guess.',
    'no-match': 'No saved login matches this exact site. Check that Sesame is unlocked, then try again.',
    'no-fields': 'No sign-in fields to fill on this page.',
    'not-password-change-form': 'This is not a password-change form. Nothing was filled.',
    'password-change-fill-failed': 'Sesame could not create a new password for this form.',
    'origin-mismatch': 'The page changed. Open Sesame again to retry.',
    'page-changed': 'The active tab or site changed. Nothing was filled.',
    'page-restricted': 'This page cannot be filled.',
    'protocol-mismatch': 'The Sesame desktop app needs an update to fill this login.',
    'signup-or-password-change': 'This looks like signup or password change. Sesame did not fill it.',
    'stale-document': 'The page reloaded while you approved. Nothing was filled.',
    'stale-request': 'That approval request expired. Choose Fill to try again.',
    'timeout': 'The desktop approval did not answer in time. Try again.',
    'vault-locked': 'Unlock your vault in the Sesame desktop app.',
  }

  const SAVE_MESSAGES: Record<string, string> = {
    'approval-declined': 'Nothing was saved. The request was declined in Sesame.',
    'approval-timeout': 'The save approval expired. Choose Save this login again.',
    'approval-unavailable': 'Sesame could not show the save approval. Bring the desktop app forward and retry.',
    'desktop-unavailable': 'Open Sesame, then choose Save this login again.',
    'host-disconnected': 'The desktop connection closed. Keep Sesame open and retry.',
    'host-exited': 'Sesame stopped the connection. Open it again and retry.',
    'host-forbidden': 'Install the extension from the store listing that Sesame links to, then choose Save this login again.',
    'host-not-found': 'Open Sesame, then choose Save this login again.',
    'invalid-capture': 'Sesame could not verify that form. Nothing was saved.',
    'no-password': 'No new password to read on this page. Fill the form with Sesame first.',
    'protocol-mismatch': 'Update Sesame and the extension, then choose Save this login again.',
    'save-failed': 'Sesame could not save this login.',
    'save-in-progress': 'A save request is already open.',
    'save-not-armed': 'Fill the form with Sesame before saving.',
    'timeout': 'The save did not answer in time. Choose Save this login again.',
    'vault-locked': 'Unlock your vault in the Sesame desktop app, then choose Save this login again.',
  }

  interface PageState {
    kind: PageKind
    code: string
    hostname: string
    hasUsernameField: boolean
    hasPasswordField: boolean
  }

  const IDENTITY_FIELD_LABELS: Record<string, string> = {
    fullName: 'name', email: 'email', phone: 'phone', addressLine1: 'address', addressLine2: 'address',
    city: 'city', region: 'region', postalCode: 'postal code', country: 'country',
  }

  const IDENTITY_MESSAGES: Record<string, string> = {
    'approval-declined': 'Nothing was filled. The request was declined in Sesame.',
    'approval-timeout': 'The approval expired. Choose Fill identity to try again.',
    'approval-unavailable': 'Sesame could not show the approval. Bring the desktop app forward and retry.',
    'cancelled': 'The request was cancelled. Nothing was filled.',
    'desktop-unavailable': 'Keep Sesame open, then try again.',
    'field-write-failed': 'This site blocked the field update. Nothing was submitted.',
    'fill-in-progress': 'A fill request is already open.',
    'host-disconnected': 'The desktop connection closed. Keep Sesame open and retry.',
    'invalid-response': 'Sesame returned an invalid response. Update or restart the app.',
    'no-match': 'No saved identity is available. Add one in Sesame.',
    'no-fields': 'No identity fields to fill on this page.',
    'origin-mismatch': 'The page changed. Open Sesame again to retry.',
    'page-changed': 'The active tab or site changed. Nothing was filled.',
    'page-restricted': 'This page cannot be filled.',
    'stale-document': 'The page reloaded while you approved. Nothing was filled.',
    'vault-locked': 'Unlock your vault in the Sesame desktop app.',
  }

  let page: PageState = { kind: 'checking', code: 'checking', hostname: '', hasUsernameField: false, hasPasswordField: false }
  let identityFields: string[] = []
  let cardFields: string[] = []
  let cardWorking = false
  let cardFeedback = ''
  let identityWorking = false
  let identityFeedback = ''
  let codeKind: OneTimeCodeKind | null = null
  let codeWorking = false
  let codeFeedback = ''
  let activeTabId: number | null = null
  let activeOrigin = ''
  let inlineGlobalEnabled = false
  let inlineLegacyAccess = false
  let inlineSitePaused = false
  let inlineWorking = false
  let inlineFeedback = ''
  let desktopState = 'checking'
  let desktopFillAvailable = false
  let connection: ConnectionPresentation = CHECKING_PRESENTATION
  let checkingDesktop = false
  let refreshing = false
  let reconnectScheduled = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let fillWorking = false
  let desktopOpening = false
  let fillFeedback = ''
  let registrationWorking = false
  let changeWorking = false
  let saveArmed = false
  let saveWorking = false
  let saveFeedback = ''
  let pendingKind: PendingKindView = null
  let pendingWorking = false
  let pendingFeedback = ''
  const pendingRevision = createRevisionGate()

  onMount(() => {
    void refreshAll()
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer)
    }
  })

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectScheduled = true
    reconnectTimer = setTimeout(() => { void checkDesktop(true) }, RECONNECT_DELAY_MS)
  }

  async function checkDesktop(automatic = false) {
    if (checkingDesktop) return
    checkingDesktop = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = null
    reconnectScheduled = false
    setChecking()
    try {
      const response = await withTimeout(chrome.runtime.sendMessage({ type: 'sesame:connect', force: !automatic }), POPUP_RESPONSE_TIMEOUT_MS)
      applyConnectionState(response)
      if (response?.state === 'unavailable' || response?.state === 'desktop-offline') scheduleReconnect()
    } catch {
      desktopState = 'unavailable'
      desktopFillAvailable = false
      connection = presentConnection('extension-response-timeout')
      setUnavailable(
        'extension-response-timeout',
        connection.title,
        connection.message,
        { code: 'extension-response-timeout', checkedAt: new Date().toISOString(), extensionVersion: chrome.runtime.getManifest().version },
      )
      scheduleReconnect()
    } finally {
      checkingDesktop = false
    }
  }

  function applyConnectionState(response: any) {
    desktopState = response?.state ?? 'unavailable'
    desktopFillAvailable = desktopState === 'ready'
    if (response?.diagnostic?.code && response.diagnostic.code !== 'connected') {
      const code = response.diagnostic.code as string
      connection = presentConnection(code)
      setUnavailable(code, connection.title, connection.message, response.diagnostic)
      return
    }
    if (desktopState === 'desktop-offline') {
      connection = presentConnection('desktop-unavailable')
      setDesktopOffline(connection.title, connection.message)
    } else if (desktopState === 'ready') {
      connection = presentConnection('connected')
      setReady(false)
    } else {
      const code = response?.diagnostic?.code ?? 'extension-error'
      connection = presentConnection(code)
      setUnavailable(code, connection.title, connection.message, response?.diagnostic)
    }
  }

  async function inspectPage() {
    page = { kind: 'checking', code: 'checking', hostname: '', hasUsernameField: false, hasPasswordField: false }
    inlineFeedback = ''
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      activeTabId = Number.isInteger(tab?.id) ? tab.id! : null
      const parsed = tab?.url ? new URL(tab.url) : null
      const origin = normalizeFillOrigin(parsed?.origin)
      page.hostname = parsed?.hostname ?? ''
      setHostname(page.hostname)
      activeOrigin = originPattern(origin ?? '') ? origin! : ''
      if (activeTabId === null || !origin) throw new Error('restricted page')
    } catch {
      activeTabId = null
      activeOrigin = ''
      page = { ...page, kind: 'restricted', code: 'page-restricted' }
    }
    try {
      const [permissions, settings] = await Promise.all([
        chrome.permissions.getAll(),
        loadInlineSettings(),
      ])
      const permissionMode = inlinePermissionMode(permissions.origins)
      inlineGlobalEnabled = permissionMode === 'global'
      inlineLegacyAccess = permissionMode === 'legacy-sites'
      inlineSitePaused = activeOrigin ? settings.pausedOrigins.includes(activeOrigin) : false
    } catch {
      inlineSitePaused = false
    }
    identityFields = []
    cardFields = []
    cardFeedback = ''
    codeKind = null
    if (activeTabId !== null) {
      let surfaces: unknown
      try {
        surfaces = await withTimeout(chrome.runtime.sendMessage({ type: 'sesame:inspect-surfaces' }), PAGE_CHECK_TIMEOUT_MS)
      } catch {
        surfaces = undefined
      }
      applyPageSurfaces(surfaces)
    }
    const saveState = activeTabId === null ? { armed: false } : await querySaveState(activeTabId)
    const saveSurface = page.kind === 'registration' || page.kind === 'password-change'
    saveArmed = saveSurface && saveState.armed
    saveFeedback = ''
    const pendingTabId = activeTabId
    const pendingRead = await pendingRevision.read(async () => pendingTabId === null ? null : queryPending(pendingTabId))
    if (pendingRead.current) pendingKind = pendingRead.value
    setPageDiagnostic({
      code: page.code,
      hasUsernameField: page.hasUsernameField,
      hasPasswordField: page.hasPasswordField,
      surfaceKind: page.kind,
    })
  }

  function applyPageSurfaces(surfaces: unknown) {
    const view = pageSurfaceView(surfaces)
    if (view.kind === 'restricted' && (surfaces as { state?: unknown } | undefined)?.state === 'restricted') {
      activeTabId = null
      activeOrigin = ''
      inlineSitePaused = false
    }
    page = { ...page, kind: view.kind, code: view.code, hasUsernameField: view.hasUsernameField, hasPasswordField: view.hasPasswordField }
    identityFields = view.identityFields
    cardFields = view.cardFields
    cardFeedback = view.cardFeedback
    codeKind = view.codeKind
  }

  async function enableInlineEverywhere() {
    if (inlineWorking) return
    inlineWorking = true
    inlineFeedback = ''
    try {
      const granted = await chrome.permissions.request({ origins: [GLOBAL_HTTPS_PATTERN] })
      if (!granted) {
        inlineFeedback = 'Website access was not granted.'
        return
      }
      inlineGlobalEnabled = true
      inlineLegacyAccess = false
      await chrome.runtime.sendMessage({ type: 'sesame:sync-inline-overlay' })
      if (activeTabId !== null && activeOrigin && !inlineSitePaused) {
        await chrome.scripting.executeScript({ target: { tabId: activeTabId }, files: ['content-overlay.js'] })
      }
      inlineFeedback = 'Enabled everywhere. Focus a sign-in field, or press Alt+Shift+L for a login or Alt+Shift+F for an identity on Windows and Linux, or Command+Shift+L for a login or Command+Shift+I for an identity on Mac.'
    } catch {
      inlineFeedback = 'Could not enable website access. Reload the extension and try again.'
    } finally {
      inlineWorking = false
    }
  }

  async function toggleSitePause() {
    if (!inlineGlobalEnabled || !activeOrigin || activeTabId === null || inlineWorking) return
    inlineWorking = true
    inlineFeedback = ''
    try {
      inlineSitePaused = !inlineSitePaused
      await setSitePaused(activeOrigin, inlineSitePaused)
      await chrome.runtime.sendMessage({ type: 'sesame:sync-inline-overlay' })
      if (inlineSitePaused) {
        await chrome.scripting.executeScript({ target: { tabId: activeTabId }, func: detachInlineButton })
        inlineFeedback = 'Sesame is paused on this site.'
      } else {
        await chrome.scripting.executeScript({ target: { tabId: activeTabId }, files: ['content-overlay.js'] })
        inlineFeedback = 'Sesame is active on this site again.'
      }
    } catch {
      inlineSitePaused = !inlineSitePaused
      inlineFeedback = 'Could not update this site exception.'
    } finally {
      inlineWorking = false
    }
  }

  function detachInlineButton() {
    const target = globalThis as typeof globalThis & { sesameDetachInlineButton?: () => void }
    target.sesameDetachInlineButton?.()
    target.sesameDetachInlineButton = undefined
  }

  async function openDesktop() {
    if (desktopOpening) return
    desktopOpening = true
    fillFeedback = 'Opening Sesame…'
    try {
      const result = await withTimeout(
        chrome.runtime.sendMessage({ type: 'sesame:open-desktop' }),
        POPUP_RESPONSE_TIMEOUT_MS,
      )
      if (result?.state === 'opened') {
        fillFeedback = 'Sesame is opening. Unlock it, then return to this page.'
        scheduleReconnect()
      } else {
        fillFeedback = 'Sesame could not be opened. Start the desktop app once and try again.'
      }
    } catch {
      fillFeedback = 'Sesame could not be opened. Start the desktop app once and try again.'
    } finally {
      desktopOpening = false
    }
  }

  function openDesktopDownload() {
    void chrome.tabs.create({ url: DESKTOP_RELEASES_URL })
  }

  async function fill() {
    if (fillWorking || desktopState !== 'ready' || !desktopFillAvailable) return
    fillWorking = true
    fillFeedback = 'Waiting for approval in Sesame…'
    const port = chrome.runtime.connect({ name: 'sesame:fill' })
    const result = await new Promise<any>((resolve) => {
      let settled = false
      const finish = (value: any) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      port.onMessage.addListener((message) => { finish(message); port.disconnect() })
      port.onDisconnect.addListener(() => finish({ state: 'unavailable', code: 'host-disconnected' }))
      port.postMessage({ type: 'start' })
    })
    fillWorking = false
    if (result?.state === 'filled') {
      if (activeTabId !== null) await armSave(activeTabId)
      fillFeedback = fillMatchExplanation(result.matchKind)
        ?? (result.usernameFilled && result.passwordFilled
          ? 'Username and password filled. Review the page before signing in.'
          : 'Sign-in field filled. Review the page before continuing.')
    } else {
      fillFeedback = unavailableFillMessage(result)
    }
  }

  function unavailableFillMessage(result: any): string {
    return lookalikeWarningForResult(result)
      ?? (result?.code === 'no-match' && page.hostname
        ? `No login is saved for ${page.hostname}. Add or edit its website in Sesame.`
        : FILL_MESSAGES[result?.code] ?? 'The fill request could not be completed.')
  }

  async function fillIdentity() {
    if (identityWorking || desktopState !== 'ready' || identityFields.length === 0) return
    identityWorking = true
    identityFeedback = 'Waiting for approval in Sesame…'
    const port = chrome.runtime.connect({ name: 'sesame:identity-fill' })
    const result = await new Promise<any>((resolve) => {
      let settled = false
      const finish = (value: any) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      port.onMessage.addListener((message) => { finish(message); port.disconnect() })
      port.onDisconnect.addListener(() => finish({ ok: false, code: 'host-disconnected' }))
      port.postMessage({ type: 'start' })
    })
    identityWorking = false
    identityFeedback = result?.ok === true
      ? `Filled ${result.filledFields.map((field: string) => IDENTITY_FIELD_LABELS[field] ?? field).join(', ')}. Review the page before continuing.`
      : IDENTITY_MESSAGES[result?.code] ?? 'The fill request could not be completed.'
  }

  async function fillCard() {
    if (cardWorking || desktopState !== 'ready' || cardFields.length === 0) return
    cardWorking = true
    cardFeedback = 'Waiting for approval in Sesame…'
    const port = chrome.runtime.connect({ name: 'sesame:card-fill' })
    const result = await new Promise<any>((resolve) => {
      let settled = false
      const finish = (value: any) => { if (!settled) { settled = true; resolve(value) } }
      port.onMessage.addListener((message) => { finish(message); port.disconnect() })
      port.onDisconnect.addListener(() => finish({ ok: false, code: 'host-disconnected' }))
      port.postMessage({ type: 'start' })
    })
    cardWorking = false
    cardFeedback = result?.ok === true
      ? 'Card fields filled. Review the page before paying.'
      : result?.code === 'card-suggestions-disabled'
        ? 'Card suggestions are disabled in the extension settings.'
        : result?.code === 'insecure-page'
          ? 'Cards are never filled on HTTP pages.'
          : result?.code === 'untrusted-frame'
            ? 'Cards are filled only on this page or in Stripe payment frames.'
            : IDENTITY_MESSAGES[result?.code] ?? 'The card fill request could not be completed.'
  }

  async function fillCode() {
    if (codeWorking || desktopState !== 'ready' || codeKind === null) return
    codeWorking = true
    codeFeedback = 'Waiting for approval in Sesame…'
    try {
      const result = await withTimeout(
        chrome.runtime.sendMessage({ type: 'sesame:autofill-one-time-code' }),
        POPUP_RESPONSE_TIMEOUT_MS,
      )
      const secondsMessage = oneTimeCodeSecondsMessage(
        result?.ok === true && typeof result.remainingSeconds === 'number' ? result.remainingSeconds : 0,
      )
      if (secondsMessage) {
        codeKind = null
        codeFeedback = secondsMessage
      } else {
        codeFeedback = result?.code === 'protocol-mismatch'
          ? 'The Sesame desktop app needs an update to fill this code.'
          : FILL_MESSAGES[result?.code] ?? 'The code fill request could not be completed.'
      }
    } catch {
      codeFeedback = 'The code fill request could not be completed.'
    } finally {
      codeWorking = false
    }
  }

  function runGenerated(portName: 'sesame:create-password' | 'sesame:change-password'): Promise<any> {
    const port = chrome.runtime.connect({ name: portName })
    return new Promise<any>((resolve) => {
      let settled = false
      const finish = (value: any) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      port.onMessage.addListener((message) => { finish(message); port.disconnect() })
      port.onDisconnect.addListener(() => finish({ state: 'unavailable', code: 'host-disconnected' }))
      port.postMessage({ type: 'start', style: DEFAULT_PASSWORD_STYLE.style, size: DEFAULT_PASSWORD_STYLE.size })
    })
  }

  async function createPassword() {
    if (registrationWorking || activeTabId === null || desktopState !== 'ready') return
    registrationWorking = true
    pendingFeedback = ''
    fillFeedback = 'Waiting for approval in Sesame…'
    try {
      const result = await runGenerated('sesame:create-password')
      if (result?.state === 'created') setPendingKind('new')
      fillFeedback = generatedMessage(result)
    } catch {
      fillFeedback = generatedMessage(null)
    } finally {
      registrationWorking = false
    }
  }

  async function changePassword() {
    if (changeWorking || activeTabId === null || desktopState !== 'ready' || !desktopFillAvailable) return
    changeWorking = true
    pendingFeedback = ''
    fillFeedback = 'Waiting for approval in Sesame…'
    try {
      const result = await runGenerated('sesame:change-password')
      if (result?.state === 'changed') setPendingKind('change')
      fillFeedback = lookalikeWarningForResult(result) ?? generatedMessage(result)
    } catch {
      fillFeedback = generatedMessage(null)
    } finally {
      changeWorking = false
    }
  }

  function setPendingKind(kind: PendingKindView) {
    pendingRevision.advance()
    pendingKind = kind
  }

  async function queryPending(tabId: number): Promise<PendingKindView> {
    try {
      const response = await withTimeout(chrome.runtime.sendMessage({ type: 'sesame:pending-state', tabId }), 4_000)
      return response?.pending === 'change' || response?.pending === 'new' ? response.pending : null
    } catch {
      return null
    }
  }

  async function acceptPending() {
    if (pendingWorking || activeTabId === null || pendingKind === null) return
    pendingWorking = true
    const kind = pendingKind
    try {
      const response = await withTimeout(chrome.runtime.sendMessage({ type: 'sesame:pending-accept', tabId: activeTabId }), POPUP_RESPONSE_TIMEOUT_MS)
      pendingFeedback = acceptMessage(response, kind)
      if (typeof response?.state === 'string' && response.state !== 'unconfirmed') setPendingKind(null)
      if (response?.code === 'pending-not-found') setPendingKind(null)
    } catch {
      pendingFeedback = acceptMessage(null, kind)
    } finally {
      pendingWorking = false
    }
  }

  function invokeSaveCurrentLogin(): unknown {
    const save = (globalThis as typeof globalThis & { sesameSaveCurrentLogin?: () => unknown }).sesameSaveCurrentLogin
    return typeof save === 'function' ? save() : { ok: false, code: 'save-failed' }
  }

  function normalizeSaveOutcome(value: unknown): { ok: true } | { ok: false; code: string } {
    if (typeof value !== 'object' || value === null) return { ok: false, code: 'save-failed' }
    const record = value as { ok?: unknown; code?: unknown }
    if (record.ok === true) return { ok: true }
    return { ok: false, code: typeof record.code === 'string' ? record.code : 'save-failed' }
  }

  async function querySaveState(tabId: number): Promise<{ armed: boolean }> {
    try {
      const response = await withTimeout(chrome.runtime.sendMessage({ type: 'sesame:save-state', tabId }), 4_000)
      return { armed: response?.armed === true }
    } catch {
      return { armed: false }
    }
  }

  async function loadLastFillResult() {
    if (activeTabId === null) return
    try {
      const response = await withTimeout(chrome.runtime.sendMessage({ type: 'sesame:last-fill-result' }), 4_000)
      if (response?.state === 'missed') {
        fillFeedback = unavailableFillMessage(response.result)
        return
      }
      if (response?.state !== 'filled') return
      const explanation = fillMatchExplanation(response.matchKind)
      if (explanation) fillFeedback = explanation
    } catch { /* noop */ }
  }

  async function armSave(tabId: number) {
    if (!activeOrigin) {
      saveArmed = false
      return
    }
    try {
      const response = await chrome.runtime.sendMessage({ type: 'sesame:arm-save', tabId, origin: activeOrigin })
      saveArmed = response?.armed === true && (page.kind === 'registration' || page.kind === 'password-change')
    } catch {
      saveArmed = false
    }
  }

  async function saveLogin() {
    if (saveWorking || activeTabId === null || !saveArmed) return
    saveWorking = true
    saveFeedback = 'Waiting for approval in Sesame…'
    try {
      await chrome.scripting.executeScript({ target: { tabId: activeTabId }, files: ['content.js'] })
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        func: invokeSaveCurrentLogin,
      })
      const outcome = normalizeSaveOutcome(injection?.result)
      if (outcome.ok) {
        saveArmed = false
        saveFeedback = 'Login saved in Sesame.'
      } else {
        saveFeedback = SAVE_MESSAGES[outcome.code] ?? 'Sesame could not save this login.'
      }
    } catch {
      saveFeedback = 'Sesame could not save this login.'
    } finally {
      saveWorking = false
    }
  }

  function openSettings() {
    chrome.runtime.openOptionsPage()
  }

  function reloadExtension() {
    chrome.runtime.reload()
  }

  async function refreshAll() {
    if (refreshing) return
    refreshing = true
    fillFeedback = ''
    await Promise.allSettled([checkDesktop(), inspectPage()])
    await loadLastFillResult()
    refreshing = false
  }

  function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('extension response timeout')), timeoutMs)
      promise.then(
        (value) => { clearTimeout(timer); resolve(value) },
        (error) => { clearTimeout(timer); reject(error) },
      )
    })
  }

  function pagePresentation(current: PageState) {
    if (current.kind === 'checking') return { title: 'Checking this page', message: 'Looking only for visible sign-in fields.', badge: 'Checking', tone: 'neutral' as const }
    if (current.kind === 'restricted') return { title: 'Browser page', message: 'Sesame cannot fill on this page.', badge: 'Unavailable', tone: 'warning' as const }
    if (current.kind === 'unchecked') return { title: current.hostname || 'This page', message: 'Sesame could not finish checking this page. Choose the refresh button to check it again.', badge: 'Not checked', tone: 'warning' as const }
    if (current.kind === 'password-change') return { title: current.hostname || 'This page', message: 'Sesame fills your current password and saves a new one in the desktop app.', badge: 'Change form', tone: 'success' as const }
    if (current.kind === 'ambiguous') return { title: current.hostname || 'This page', message: 'More than one password surface is visible. Sesame did not guess.', badge: 'Ambiguous', tone: 'warning' as const }
    if (current.kind === 'registration') return { title: current.hostname || 'This page', message: 'Sesame makes a password in the desktop app and fills it here.', badge: 'Registration', tone: 'success' as const }
    if (current.kind === 'login') return { title: current.hostname || 'This page', message: current.hasUsernameField ? 'Username and password fields were found.' : 'A password field was found.', badge: 'Sign-in', tone: 'success' as const }
    if (current.kind === 'username') return { title: current.hostname || 'This page', message: 'A possible username field was found.', badge: 'Username', tone: 'neutral' as const }
    return { title: current.hostname || 'This page', message: 'No visible sign-in fields were found.', badge: 'No form', tone: 'neutral' as const }
  }

  $: phase = $popupState.phase
  $: pageCard = pagePresentation(page)
  $: pageFillable = page.kind === 'login' || page.kind === 'username'
  $: statusOffersSupport = phase.name === 'unavailable' || phase.name === 'desktop-offline'
  $: desktopNeedsOpening = desktopState === 'desktop-offline' || desktopState === 'unavailable'
  $: retryNote = reconnectScheduled ? 'Trying the desktop connection again while this window is open.' : ''
</script>

<main>
  <Header subtitle={$popupState.hostname ? `for ${$popupState.hostname}` : ''} {refreshing} onRefresh={refreshAll} onOpenSettings={openSettings} />

  {#if phase.name === 'initial' || phase.name === 'checking'}
    <StatusCard title="Finding the desktop app" message="Checking the private connection on this device." />
  {:else if phase.name === 'unavailable'}
    <StatusCard title={phase.title} message={phase.message} note={retryNote} helpUrl={SESAME_LINKS.support} tone="warning" />
  {:else if phase.name === 'desktop-offline'}
    <StatusCard title={phase.title} message={phase.message} note={retryNote} helpUrl={SESAME_LINKS.support} tone="warning" />
  {:else if phase.name === 'ready'}
    <StatusCard title="Connected" message="Sesame asks for approval in the desktop app for every fill." tone="success" />
  {/if}

  <section class="page-context" class:success={pageCard.tone === 'success'} class:warning={pageCard.tone === 'warning'} aria-live="polite">
    <div><strong>{pageCard.title}</strong><p>{pageCard.message}</p></div>
    <span class="page-badge">{pageCard.badge}</span>
  </section>

  {#if !inlineGlobalEnabled}
    <section class="inline-access">
      <div><strong>Show Sesame on login fields</strong><p>{inlineLegacyAccess ? 'Upgrade the older site-by-site setup with one approval.' : 'Enable once for every HTTPS website. No site-by-site setup.'}</p></div>
      <button type="button" disabled={inlineWorking} on:click={enableInlineEverywhere}>{inlineWorking ? 'Enabling…' : 'Enable'}</button>
      {#if inlineFeedback}<p class="inline-feedback" role="status">{inlineFeedback}</p>{/if}
    </section>
  {:else}
    <section class="inline-access active-everywhere">
      <div><strong>{inlineSitePaused ? 'Inline control paused here' : 'Available on login fields'}</strong><p>{inlineSitePaused ? 'Keyboard and popup filling still work here.' : 'Focus a field, or press Alt+Shift+L for a login or Alt+Shift+F for an identity on Windows and Linux, or Command+Shift+L for a login or Command+Shift+I for an identity on Mac.'}</p></div>
      {#if activeOrigin}
        <button type="button" class:enabled={!inlineSitePaused} disabled={inlineWorking} on:click={toggleSitePause}>{inlineSitePaused ? 'Resume' : 'Pause here'}</button>
      {/if}
      {#if inlineFeedback}<p class="inline-feedback" role="status">{inlineFeedback}</p>{/if}
    </section>
  {/if}

  {#if pendingKind}
    <section class="pending-password" aria-live="polite">
      <p>{GENERATED_MESSAGES.waiting[pendingKind]}</p>
      <button class="generate-button" type="button" disabled={pendingWorking} on:click={acceptPending}>{pendingWorking ? 'Telling Sesame…' : 'The site accepted it'}</button>
    </section>
  {:else if page.kind === 'registration'}
    <button class="generate-button" type="button" disabled={registrationWorking || desktopState !== 'ready'} on:click={createPassword}>{registrationWorking ? 'Creating…' : 'Create password'}</button>
  {:else if page.kind === 'password-change'}
    <button class="generate-button" type="button" disabled={changeWorking || desktopState !== 'ready' || !desktopFillAvailable} on:click={changePassword}>{changeWorking ? 'Creating…' : 'Change password'}</button>
  {/if}
  {#if pendingFeedback}<p class="fill-feedback" role="status">{pendingFeedback}</p>{/if}
  {#if saveArmed}
    <FillButton onClick={saveLogin} loading={saveWorking} loadingLabel="Saving…" label="Save this login" secondary={page.kind === 'registration'} />
  {/if}
  {#if saveFeedback}<p class="fill-feedback" role="status">{saveFeedback}</p>{/if}
  {#if desktopNeedsOpening}
    {#if connection.action === 'install' || connection.action === 'update'}
      <FillButton onClick={openDesktopDownload} label={connection.actionLabel} secondary={page.kind === 'registration'} />
    {:else if connection.action === 'open-desktop'}
      <FillButton
        onClick={openDesktop}
        disabled={checkingDesktop}
        loading={desktopOpening}
        loadingLabel="Starting Sesame…"
        label={connection.actionLabel}
        secondary={page.kind === 'registration'}
      />
    {:else if connection.action === 'reload'}
      <FillButton onClick={reloadExtension} label={connection.actionLabel} secondary={page.kind === 'registration'} />
    {:else if connection.action === 'retry'}
      <FillButton onClick={refreshAll} disabled={refreshing} loading={refreshing} loadingLabel="Checking…" label={connection.actionLabel} secondary={page.kind === 'registration'} />
    {/if}
  {:else if pageFillable}
    <FillButton onClick={fill} disabled={desktopState !== 'ready' || !desktopFillAvailable} loading={fillWorking} label={page.kind === 'username' ? 'Fill username' : 'Fill login'} />
  {/if}
  {#if fillFeedback}<p class="fill-feedback" role="status">{fillFeedback}</p>{/if}

  {#if !desktopNeedsOpening && identityFields.length > 0}
    <FillButton onClick={fillIdentity} disabled={desktopState !== 'ready'} loading={identityWorking} loadingLabel="Waiting for approval…" label="Fill identity" />
  {/if}
  {#if identityFeedback}<p class="fill-feedback" role="status">{identityFeedback}</p>{/if}

  {#if !desktopNeedsOpening && cardFields.length > 0}
    <FillButton onClick={fillCard} disabled={desktopState !== 'ready'} loading={cardWorking} loadingLabel="Waiting for approval…" label="Fill card" />
  {/if}
  {#if cardFeedback}<p class="fill-feedback" role="status">{cardFeedback}</p>{/if}

  {#if !desktopNeedsOpening && codeKind !== null}
    <FillButton onClick={fillCode} disabled={desktopState !== 'ready'} loading={codeWorking} loadingLabel="Waiting for approval…" label="Fill code" />
  {/if}
  {#if codeFeedback}<p class="fill-feedback" role="status">{codeFeedback}</p>{/if}

  <Diagnostics diagnostic={$popupState.diagnostic} pageDiagnostic={$popupState.pageDiagnostic} />
  <footer>
    <span>Version {chrome.runtime.getManifest().version}</span>
    <nav aria-label="Help">
      {#if !statusOffersSupport}<a href={SESAME_LINKS.support} target="_blank" rel="noopener noreferrer">Support</a>{/if}
      <a href={SESAME_LINKS.privacy} target="_blank" rel="noopener noreferrer">Privacy</a>
    </nav>
  </footer>
</main>

<style>
  main { padding: 14px; background: var(--bg); }
  .page-context { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; margin: 10px 0; padding: 11px; border: 0; border-radius: var(--radius-md); background: var(--surface); box-shadow: var(--shadow-raised); }
  .page-context strong { display: block; overflow: hidden; font-family: var(--font-display); font-size: var(--type-3); font-weight: var(--weight-regular); text-overflow: ellipsis; white-space: nowrap; }
  .page-context p, .inline-access p, .fill-feedback { margin: 2px 0 0; color: var(--text-muted); font-size: var(--type-2); line-height: 1.45; }
  .page-badge { max-width: 84px; padding: 4px 7px; border-radius: var(--radius-pill); color: var(--text-muted); background: var(--surface-inset); font-size: var(--type-1); font-weight: var(--weight-bold); text-align: center; }
  .page-context.success .page-badge { color: var(--accent); background: var(--tint); }
  .page-context.warning .page-badge { color: var(--warn-text); background: var(--warn-bg); }
  .inline-access { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; margin-bottom: 10px; padding: 10px 11px; border: 0; border-radius: var(--radius-md); background: var(--surface); box-shadow: var(--shadow-raised); }
  .inline-access strong { font-size: var(--type-3); font-weight: var(--weight-bold); }
  .inline-access > button { min-width: 62px; border: 0; border-radius: var(--radius-pill); padding: 6px 10px; color: var(--text); background: var(--surface-inset); font-size: var(--type-2); font-weight: var(--weight-medium); cursor: pointer; transition: background-color .16s ease, color .16s ease, transform .1s ease; }
  .inline-access > button:active { transform: scale(.95); }
  .inline-access > button.enabled { color: var(--accent); background: var(--tint); }
  .inline-access > button:disabled { cursor: wait; opacity: .6; }
  .inline-access > button:disabled:active { transform: none; }
  .inline-feedback { grid-column: 1 / -1; }
  .generate-button { width: 100%; min-height: var(--control-h-md); border: 1px solid transparent; border-radius: var(--control-radius); padding: 0 var(--control-px-md); color: var(--on-accent); background: var(--accent); font-weight: var(--control-weight); cursor: pointer; box-shadow: var(--button-shadow); transition: var(--control-transition); }
  .generate-button:hover:not(:disabled) { background: var(--accent-hover); }
  .generate-button:active:not(:disabled) { background: var(--accent-active); box-shadow: var(--button-shadow-pressed); transform: var(--control-press); }
  .pending-password { display: grid; gap: 8px; margin-top: 12px; border-top: 1px solid var(--border); padding-top: 12px; }
  .pending-password p { margin: 0; color: var(--text); font-size: var(--type-3); line-height: 1.45; }
  .generate-button:disabled { cursor: wait; opacity: var(--control-disabled); }
  .fill-feedback { min-height: 15px; margin: 7px 3px 0; }
  footer { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; color: var(--text-faint); font-size: var(--type-2); }
  footer nav { display: flex; gap: var(--space-3); }
  footer a { color: var(--text-muted); text-underline-offset: 2px; }
  footer a:hover { color: var(--text-heading); }
  footer a:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; border-radius: var(--radius-sm); }
</style>
