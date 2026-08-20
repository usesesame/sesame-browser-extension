<script lang="ts">
  import { onMount } from 'svelte'
  import {
    popupState, setChecking, setUnavailable, setDesktopOffline, setLocked, setReady,
    setHostname, setPageDiagnostic,
  } from './states/store'
  import { makeRegistrationPassword, normalizeRegistrationOutcome, type PasswordSurfaceKind } from '../content/registration'
  import { copyTemporarily, type TemporaryCopyHandle } from '../content/temporary-copy'
  import { normalizeFillOrigin } from '../protocol/native'
  import {
    GLOBAL_HTTPS_PATTERN, inlinePermissionMode, loadInlineSettings, originPattern, setSitePaused,
  } from '../permissions/inline-access'
  import Header from './components/Header.svelte'
  import StatusCard from './components/StatusCard.svelte'
  import FillButton from './components/FillButton.svelte'
  import Diagnostics from './components/Diagnostics.svelte'

  const RECONNECT_DELAY_MS = 4_000
  const POPUP_RESPONSE_TIMEOUT_MS = 9_000
  const REGISTRATION_EXPIRY_MS = 120_000

  const CONNECTION_MESSAGES: Record<string, [string, string]> = {
    'host-not-found': ['Desktop helper not found', 'Open or restart Sesame. This extension will reconnect automatically.'],
    'host-forbidden': ['Connection needs a refresh', 'Reload the unpacked extension once, then restart Sesame.'],
    'host-exited': ['Desktop helper stopped', 'Keep Sesame open. We will try the connection again.'],
    'host-communication-failed': ['Connection was interrupted', 'Keep Sesame open. We will try the connection again.'],
    'host-disconnected': ['Desktop helper disconnected', 'Keep Sesame open. We will try the connection again.'],
    'protocol-mismatch': ['Update needed', 'The desktop app and extension use different connection versions.'],
    'request-mismatch': ['Response could not be verified', 'Reload the extension and try once more.'],
    'unsafe-response': ['Response was blocked', 'Sesame rejected an unexpected response to protect your vault.'],
    'invalid-response': ['Desktop response was not understood', 'Restart Sesame and try again.'],
    'host-rejected-request': ['Desktop helper declined the check', 'Update or restart Sesame and try again.'],
    'host-unavailable': ['Desktop helper is unavailable', 'Open or restart Sesame.'],
    'timeout': ['Sesame is taking too long', 'Keep the desktop app open. We will retry automatically.'],
    'native-runtime-error': ['Browser connection failed', 'Reload this extension and try again.'],
  }

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
    'no-match': 'No saved login matches this exact site.',
    'no-fields': 'No sign-in fields to fill on this page.',
    'origin-mismatch': 'The page changed. Open Sesame again to retry.',
    'page-changed': 'The active tab or site changed. Nothing was filled.',
    'page-restricted': 'This page cannot be filled.',
    'signup-or-password-change': 'This looks like signup or password change. Sesame did not fill it.',
    'stale-document': 'The page reloaded while you approved. Nothing was filled.',
    'stale-request': 'That approval request expired. Choose Fill to try again.',
    'timeout': 'The desktop approval did not answer in time. Try again.',
    'vault-locked': 'Unlock your vault in the Sesame desktop app.',
  }

  type PageKind = 'checking' | 'restricted' | 'none' | 'username' | 'login' | 'registration' | 'password-change' | 'ambiguous'
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
  let activeTabId: number | null = null
  let activeOrigin = ''
  let inlineGlobalEnabled = false
  let inlineLegacyAccess = false
  let inlineSitePaused = false
  let inlineWorking = false
  let inlineFeedback = ''
  let desktopState = 'checking'
  let desktopFillAvailable = false
  let checkingDesktop = false
  let refreshing = false
  let reconnectScheduled = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let fillWorking = false
  let desktopOpening = false
  let fillFeedback = ''
  let generatedPassword = ''
  let registrationWorking = false
  let copiedPassword = false
  let generatedExpiryTimer: ReturnType<typeof setTimeout> | null = null
  let copyHandle: TemporaryCopyHandle | null = null

  onMount(() => {
    void refreshAll()
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (generatedExpiryTimer) clearTimeout(generatedExpiryTimer)
      copyHandle?.cancel()
      generatedPassword = ''
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
      setUnavailable(
        'extension-response-timeout',
        automatic ? 'Still looking for Sesame' : 'Extension did not answer',
        'Keep Sesame open. This window will try the private connection again.',
        { code: 'extension-response-timeout', checkedAt: new Date().toISOString(), extensionVersion: chrome.runtime.getManifest().version },
      )
      scheduleReconnect()
    } finally {
      checkingDesktop = false
    }
  }

  function applyConnectionState(response: any) {
    desktopState = response?.state ?? 'unavailable'
    desktopFillAvailable = desktopState === 'ready' && response?.capabilities?.fillAvailable === true
    if (response?.diagnostic?.code && response.diagnostic.code !== 'connected') {
      const code = response.diagnostic.code as string
      const [title, message] = CONNECTION_MESSAGES[code] ?? CONNECTION_MESSAGES['native-runtime-error']
      setUnavailable(code, title, message, response.diagnostic)
      return
    }
    if (desktopState === 'desktop-offline') {
      setDesktopOffline(response.title, response.message)
    } else if (desktopState === 'locked') {
      setLocked(response.title, response.message)
    } else if (desktopState === 'ready') {
      setReady(desktopFillAvailable, false)
    } else {
      setUnavailable(response?.diagnostic?.code ?? 'extension-error', response?.title ?? 'Desktop connection unavailable', response?.message ?? 'Reload this extension and try again.', response?.diagnostic)
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
      const [permissions, settings] = await Promise.all([
        chrome.permissions.getAll(),
        loadInlineSettings(),
      ])
      const permissionMode = inlinePermissionMode(permissions.origins)
      inlineGlobalEnabled = permissionMode === 'global'
      inlineLegacyAccess = permissionMode === 'legacy-sites'
      inlineSitePaused = activeOrigin ? settings.pausedOrigins.includes(activeOrigin) : false
      if (activeTabId === null || !origin) throw new Error('restricted page')

      await chrome.scripting.executeScript({ target: { tabId: activeTabId }, files: ['content.js'] })
      const [purposeResult] = await chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        func: invokePasswordSurfaceInspection,
      })
      const purpose = normalizePasswordSurfaceKind(purposeResult?.result)
      const response = await withTimeout(chrome.runtime.sendMessage({ type: 'sesame:inspect-page' }), 4_000)
      if (response?.state !== 'ready') {
        page = { ...page, kind: 'restricted', code: response?.code ?? 'page-check-failed' }
      } else {
        const hasUsernameField = response.hasUsernameField === true
        const hasPasswordField = response.hasPasswordField === true
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
        page = { ...page, kind, code, hasUsernameField, hasPasswordField }
      }

      const identityResponse = await withTimeout(chrome.runtime.sendMessage({ type: 'sesame:inspect-identity' }), 4_000)
      identityFields = identityResponse?.state === 'ready' && Array.isArray(identityResponse.fields)
        ? identityResponse.fields
        : []
      const cardResponse = await withTimeout(chrome.runtime.sendMessage({ type: 'sesame:inspect-card' }), 4_000)
      cardFields = cardResponse?.state === 'ready' && Array.isArray(cardResponse.fields) ? cardResponse.fields : []
      cardFeedback = cardResponse?.code === 'insecure-page'
        ? 'Cards are never filled on HTTP pages.'
        : cardResponse?.code === 'untrusted-frame'
          ? 'Cards are not filled in an embedded frame with a different page origin.'
          : cardResponse?.code === 'no-fields'
            ? 'No supported top-level card fields were found on this page.' : ''
    } catch {
      activeTabId = null
      activeOrigin = ''
      inlineSitePaused = false
      identityFields = []
      cardFields = []
      page = { ...page, kind: 'restricted', code: 'page-restricted' }
    }
    setPageDiagnostic({
      code: page.code,
      hasUsernameField: page.hasUsernameField,
      hasPasswordField: page.hasPasswordField,
      surfaceKind: page.kind,
    })
  }

  function invokePasswordSurfaceInspection(): unknown {
    const inspect = (globalThis as typeof globalThis & { sesameInspectPasswordSurface?: () => unknown }).sesameInspectPasswordSurface
    return typeof inspect === 'function' ? inspect() : 'none'
  }

  function normalizePasswordSurfaceKind(value: unknown): PasswordSurfaceKind {
    return value === 'login' || value === 'registration' || value === 'password-change' || value === 'ambiguous' || value === 'none'
      ? value
      : 'ambiguous'
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
      inlineFeedback = 'Enabled everywhere. Focus a sign-in field or press Ctrl+Shift+L.'
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
    fillFeedback = desktopState === 'locked' ? 'Bringing Sesame forward…' : 'Opening Sesame…'
    try {
      const result = await withTimeout(
        chrome.runtime.sendMessage({ type: 'sesame:open-desktop' }),
        POPUP_RESPONSE_TIMEOUT_MS,
      )
      if (result?.state === 'opened') {
        fillFeedback = desktopState === 'locked'
          ? 'Sesame is open. Unlock it to continue.'
          : 'Sesame is opening. Unlock it, then return to this page.'
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
      if (activeTabId !== null) await armSignupCapture(activeTabId)
      fillFeedback = result.usernameFilled && result.passwordFilled
        ? 'Username and password filled. Review the page before signing in. When you submit, Sesame will offer to save the login.'
        : 'Sign-in field filled. Review the page before continuing. When you submit, Sesame will offer to save the login.'
    } else {
      fillFeedback = result?.code === 'no-match' && page.hostname
        ? `No login is saved for ${page.hostname}. Add or edit its website in Sesame.`
        : FILL_MESSAGES[result?.code] ?? 'The fill request could not be completed.'
    }
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
            ? 'Cards are not filled in an embedded frame with a different page origin.'
            : IDENTITY_MESSAGES[result?.code] ?? 'The card fill request could not be completed.'
  }

  async function generateAndFillPassword() {
    if (registrationWorking || activeTabId === null) return
    registrationWorking = true
    fillFeedback = 'Creating a strong password on this device…'
    copyHandle?.cancel()
    if (generatedExpiryTimer) clearTimeout(generatedExpiryTimer)
    generatedPassword = makeRegistrationPassword()
    copiedPassword = false
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      const origin = normalizeFillOrigin(tab?.url ? new URL(tab.url).origin : undefined)
      if (!Number.isInteger(tab?.id) || tab.id !== activeTabId || !origin) throw new Error('page changed')
      await chrome.scripting.executeScript({ target: { tabId: activeTabId }, files: ['content.js'] })
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        func: invokeRegistrationFill,
        args: [origin, generatedPassword],
      })
      const outcome = normalizeRegistrationOutcome(injection?.result)
      if (!outcome.ok) throw new Error(outcome.code)
      await armSignupCapture(activeTabId)
      fillFeedback = outcome.fieldsFilled === 1
        ? 'Password filled. Copy it before completing registration.'
        : 'Password and confirmation filled. Copy it before completing registration.'
      generatedExpiryTimer = setTimeout(clearGeneratedPassword, REGISTRATION_EXPIRY_MS)
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      generatedPassword = ''
      fillFeedback = code === 'password-change-form'
        ? 'This is a password-change form, so Sesame did not fill it.'
        : code === 'multiple-matches'
          ? 'More than one registration form was found. Sesame did not guess.'
          : 'Could not create a password for this form.'
    } finally {
      registrationWorking = false
    }
  }

  function invokeRegistrationFill(origin: string, password: string): unknown {
    const fillRegistration = (globalThis as typeof globalThis & { sesameFillRegistrationSurface?: (expectedOrigin: string, generated: string) => unknown }).sesameFillRegistrationSurface
    return typeof fillRegistration === 'function'
      ? fillRegistration(origin, password)
      : { version: 1, ok: false, code: 'registration-fill-failed' }
  }

  function invokeEnsureSignupCapture(): unknown {
    const ensure = (globalThis as typeof globalThis & { sesameEnsureSignupCapture?: () => unknown }).sesameEnsureSignupCapture
    return typeof ensure === 'function' ? ensure() : false
  }

  async function armSignupCapture(tabId: number) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, func: invokeEnsureSignupCapture })
    } catch { /* noop */ }
  }

  async function copyGeneratedPassword() {
    if (!generatedPassword) return
    try {
      copyHandle?.cancel()
      copyHandle = await copyTemporarily(generatedPassword, { onExpired: () => { copiedPassword = false } })
      copiedPassword = true
      fillFeedback = 'Copied temporarily. Save the login in Sesame after registration succeeds.'
    } catch {
      fillFeedback = 'Clipboard access is unavailable. The password remains filled in the form.'
    }
  }

  function clearGeneratedPassword() {
    generatedPassword = ''
    copiedPassword = false
    generatedExpiryTimer = null
  }

  function openSettings() {
    chrome.runtime.openOptionsPage()
  }

  async function refreshAll() {
    if (refreshing) return
    refreshing = true
    fillFeedback = ''
    await Promise.allSettled([checkDesktop(), inspectPage()])
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
    if (current.kind === 'restricted') return { title: 'Browser page', message: 'This page cannot be inspected or filled.', badge: 'Unavailable', tone: 'warning' as const }
    if (current.kind === 'password-change') return { title: current.hostname || 'This page', message: 'Password-change forms are refused because Sesame will not guess which existing password to replace.', badge: 'Change form', tone: 'warning' as const }
    if (current.kind === 'ambiguous') return { title: current.hostname || 'This page', message: 'More than one password surface is visible. Sesame did not guess.', badge: 'Ambiguous', tone: 'warning' as const }
    if (current.kind === 'registration') return { title: current.hostname || 'This page', message: 'Create a strong password and fill its matching confirmation fields.', badge: 'Registration', tone: 'success' as const }
    if (current.kind === 'login') return { title: current.hostname || 'This page', message: current.hasUsernameField
      ? inlineGlobalEnabled && !inlineSitePaused ? 'Username and password are ready. Sesame offers to save the login when you submit.' : 'Username and password are ready.'
      : inlineGlobalEnabled && !inlineSitePaused ? 'A password field is ready. Sesame offers to save the login when you submit.' : 'A password field is ready.', badge: 'Ready', tone: 'success' as const }
    if (current.kind === 'username') return { title: current.hostname || 'This page', message: 'A possible username field was found.', badge: 'Username', tone: 'neutral' as const }
    return { title: current.hostname || 'This page', message: 'No visible sign-in fields were found.', badge: 'No form', tone: 'neutral' as const }
  }

  $: phase = $popupState.phase
  $: pageCard = pagePresentation(page)
  $: pageFillable = page.kind === 'login' || page.kind === 'username'
  $: desktopNeedsOpening = desktopState === 'locked' || desktopState === 'desktop-offline' || desktopState === 'unavailable'
</script>

<main>
  <Header title={phase.name} subtitle={$popupState.hostname ? `for ${$popupState.hostname}` : ''} {refreshing} onRefresh={refreshAll} onOpenSettings={openSettings} />

  {#if phase.name === 'initial' || phase.name === 'checking'}
    <StatusCard title="Finding the desktop app" message="Checking the private connection on this device." />
  {:else if phase.name === 'unavailable'}
    <StatusCard title={phase.title} message={phase.message} tone="warning" />
  {:else if phase.name === 'desktop-offline'}
    <StatusCard title={phase.title} message={phase.message} tone="warning" />
  {:else if phase.name === 'locked'}
    <StatusCard title={phase.title} message={phase.message} />
  {:else if phase.name === 'ready'}
    <StatusCard title="Connected" message={desktopFillAvailable ? 'Ready to fill from this browser.' : 'Page filling is unavailable in this desktop build.'} tone="success" />
  {/if}
  {#if reconnectScheduled}<p class="retry-note" role="status">Trying the desktop connection again while this window is open.</p>{/if}

  <section class="page-context" class:success={pageCard.tone === 'success'} class:warning={pageCard.tone === 'warning'} aria-live="polite">
    <span class="page-icon" aria-hidden="true">S</span>
    <div><strong>{pageCard.title}</strong><p>{pageCard.message}</p></div>
    <span class="page-badge">{pageCard.badge}</span>
  </section>

  {#if !inlineGlobalEnabled}
    <section class="inline-access">
      <div><strong>Show Sesame on login fields</strong><p>{inlineLegacyAccess ? 'Upgrade the older site-by-site setup with one approval.' : 'Enable once for every HTTPS website—no site-by-site setup.'}</p></div>
      <button type="button" disabled={inlineWorking} on:click={enableInlineEverywhere}>{inlineWorking ? 'Enabling…' : 'Enable'}</button>
      {#if inlineFeedback}<p class="inline-feedback" role="status">{inlineFeedback}</p>{/if}
    </section>
  {:else}
    <section class="inline-access active-everywhere">
      <div><strong>{inlineSitePaused ? 'Inline control paused here' : 'Available on login fields'}</strong><p>{inlineSitePaused ? 'Keyboard and popup filling remain available; the inline control stays active everywhere else.' : 'Focus a field or press Ctrl+Shift+L. No popup is required.'}</p></div>
      {#if activeOrigin}
        <button type="button" class:enabled={!inlineSitePaused} disabled={inlineWorking} on:click={toggleSitePause}>{inlineSitePaused ? 'Resume' : 'Pause here'}</button>
      {/if}
      {#if inlineFeedback}<p class="inline-feedback" role="status">{inlineFeedback}</p>{/if}
    </section>
  {/if}

  {#if page.kind === 'registration'}
    <button class="generate-button" type="button" disabled={registrationWorking} on:click={generateAndFillPassword}>{registrationWorking ? 'Creating…' : 'Create password'}</button>
    {#if generatedPassword}
      <div class="generated-password"><code>{generatedPassword}</code><button type="button" on:click={copyGeneratedPassword}>{copiedPassword ? 'Copied' : 'Copy temporarily'}</button></div>
    {/if}
  {/if}
  {#if desktopNeedsOpening}
    <FillButton
      onClick={openDesktop}
      disabled={checkingDesktop}
      loading={desktopOpening}
      loadingLabel={desktopState === 'locked' ? 'Opening Sesame…' : 'Starting Sesame…'}
      label={desktopState === 'locked' ? 'Unlock Sesame' : 'Open Sesame'}
      secondary={page.kind === 'registration'}
    />
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

  <Diagnostics diagnostic={$popupState.diagnostic} pageDiagnostic={$popupState.pageDiagnostic} />
  <footer>Development build {chrome.runtime.getManifest().version}</footer>
</main>

<style>
  main { padding: 14px; background: var(--bg); }
  .retry-note { margin: -4px 2px 10px; color: var(--warn-text); font-size: 10px; }
  .page-context { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 10px; align-items: center; margin: 10px 0; padding: 11px; border: 0; border-radius: var(--radius-md); background: var(--surface); box-shadow: var(--shadow-panel); }
  .page-icon { display: grid; width: 34px; height: 34px; place-items: center; border-radius: var(--radius-md); color: var(--gold-text); background: var(--gold-soft-bg); font: 700 17px var(--font-display); }
  .page-context.success .page-icon { color: var(--accent); background: var(--tint); }
  .page-context.warning .page-icon { color: var(--warn-text); background: var(--warn-bg); }
  .page-context strong { display: block; overflow: hidden; font-family: var(--font-display); font-size: 12.5px; text-overflow: ellipsis; white-space: nowrap; }
  .page-context p, .inline-access p, .fill-feedback { margin: 2px 0 0; color: var(--text-muted); font-size: 10px; line-height: 1.45; }
  .page-badge { max-width: 84px; padding: 4px 7px; border-radius: var(--radius-pill); color: var(--text-muted); background: var(--surface-inset); font-size: 9px; font-weight: 700; text-align: center; }
  .page-context.success .page-badge { color: var(--accent); background: var(--tint); }
  .page-context.warning .page-badge { color: var(--warn-text); background: var(--warn-bg); }
  .inline-access { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; margin-bottom: 10px; padding: 10px 11px; border: 0; border-radius: var(--radius-md); background: var(--surface); box-shadow: var(--shadow-panel); }
  .inline-access strong { font-size: 11px; }
  .inline-access > button { min-width: 62px; border: 0; border-radius: var(--radius-pill); padding: 6px 10px; color: var(--text); background: var(--surface-inset); font-size: 10px; font-weight: 700; cursor: pointer; transition: background-color .16s ease, color .16s ease, transform .1s ease; }
  .inline-access > button:active { transform: scale(.95); }
  .inline-access > button.enabled { color: var(--accent); background: var(--tint); }
  .inline-access > button:disabled { cursor: wait; opacity: .6; }
  .inline-access > button:disabled:active { transform: none; }
  .inline-feedback { grid-column: 1 / -1; }
  .generate-button { width: 100%; border: 0; border-radius: var(--radius-md); padding: 11px 14px; color: var(--on-accent); background: var(--accent); font-weight: 650; cursor: pointer; box-shadow: 0 1px 2px rgba(0, 0, 0, .12), 0 3px 8px rgba(0, 0, 0, .1); transition: background-color .16s ease, transform .1s ease; }
  .generate-button:hover:not(:disabled) { background: var(--accent-hover); }
  .generate-button:active:not(:disabled) { background: var(--accent-active); transform: scale(.97); }
  .generate-button:disabled { cursor: wait; opacity: .65; }
  .generated-password { display: flex; align-items: center; gap: 8px; margin-top: 9px; padding: 8px; border-radius: var(--radius-sm); background: var(--surface-inset); }
  .generated-password code { flex: 1; overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  .generated-password button { border: 0; border-radius: 6px; padding: 5px 8px; color: var(--text); background: var(--surface); font-size: 10px; cursor: pointer; transition: background-color .16s ease, transform .1s ease; }
  .generated-password button:hover { background: var(--tint); }
  .generated-password button:active { transform: scale(.95); }
  .fill-feedback { min-height: 15px; margin: 7px 3px 0; }
  footer { margin-top: 12px; color: var(--text-faint); font-size: 9px; text-align: center; }
</style>
