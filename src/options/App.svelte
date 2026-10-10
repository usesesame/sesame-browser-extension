<script lang="ts">
  import { onMount } from 'svelte'
  import {
    clearPausedSites, GLOBAL_HTTPS_PATTERN, inlinePermissionMode, loadInlineSettings,
    removeAllInlinePermissions, removeLegacySitePermissions, setSitePaused,
    setCardSuggestionsEnabled,
  } from '../permissions/inline-access'
  import { safeDiagnosticText } from '../protocol/diagnostics'
  import { desktopStateFromResponse, type DesktopState } from '../onboarding/readiness'
  import { presentConnection, READY_PRESENTATION, CHECKING_PRESENTATION } from '../protocol/connection-presentation'
  import { SESAME_LINKS } from '../shared/links'
  import { HELP_LINKS } from './help-links'
  import Icon from '../shared/Icon.svelte'
  import Switch from './Switch.svelte'

  let enabled = false
  let legacyAccess = false
  let pausedOrigins: string[] = []
  let working = false
  let status = ''
  let cardSuggestionsEnabled = true
  let desktop: DesktopState = { status: 'checking' }
  let checking = false
  let opening = false
  let diagnostic: Record<string, unknown> | undefined
  let copied = false

  const version = chrome.runtime.getManifest().version
  const setupGuideUrl = chrome.runtime.getURL('onboarding.html')
  const shortcutsUrl = navigator.userAgent.includes('Edg/') ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts'

  function openShortcuts() {
    void chrome.tabs.create({ url: shortcutsUrl }).catch(() => {
      status = 'Open your browser extension settings and choose Keyboard shortcuts.'
    })
  }

  $: connection = desktop.status === 'ready'
    ? READY_PRESENTATION
    : desktop.status === 'checking' ? CHECKING_PRESENTATION : presentConnection(desktop.code)

  onMount(() => {
    void refresh()
    void checkDesktop()
    const recheck = () => {
      if (desktop.status !== 'ready') void checkDesktop()
    }
    window.addEventListener('focus', recheck)
    return () => window.removeEventListener('focus', recheck)
  })

  async function checkDesktop() {
    if (checking) return
    checking = true
    try {
      const response = await Promise.race([
        chrome.runtime.sendMessage({ type: 'sesame:connect', force: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 9_000)),
      ])
      desktop = desktopStateFromResponse(response)
      diagnostic = (response as { diagnostic?: Record<string, unknown> } | undefined)?.diagnostic
    } catch {
      desktop = { status: 'blocked', code: 'extension-response-timeout' }
    } finally {
      checking = false
    }
  }

  async function copyDetails() {
    if (!diagnostic) return
    try {
      await navigator.clipboard.writeText(safeDiagnosticText(diagnostic))
      copied = true
      setTimeout(() => { copied = false }, 1_500)
    } catch {
      status = 'Could not copy the details.'
    }
  }

  async function openDesktop() {
    if (opening) return
    opening = true
    status = ''
    try {
      const result = await chrome.runtime.sendMessage({ type: 'sesame:open-desktop' })
      status = result?.state === 'opened'
        ? 'Sesame is opening. Unlock it, then check again.'
        : 'Sesame could not be opened. Start the desktop app once, then check again.'
    } catch {
      status = 'Sesame could not be opened. Start the desktop app once, then check again.'
    } finally {
      opening = false
    }
  }

  async function refresh() {
    try {
      const [permissions, settings] = await Promise.all([chrome.permissions.getAll(), loadInlineSettings()])
      const mode = inlinePermissionMode(permissions.origins)
      enabled = mode === 'global'
      legacyAccess = mode === 'legacy-sites'
      pausedOrigins = settings.pausedOrigins
      cardSuggestionsEnabled = settings.cardSuggestionsEnabled
    } catch {
      status = 'Could not load the current settings.'
    }
  }

  async function toggleCardSuggestions() {
    if (working) return
    working = true
    try {
      const settings = await setCardSuggestionsEnabled(!cardSuggestionsEnabled)
      cardSuggestionsEnabled = settings.cardSuggestionsEnabled
      status = cardSuggestionsEnabled ? 'Card suggestions are available on secure checkout forms.' : 'Card suggestions are disabled.'
    } catch { status = 'Could not change card suggestions.' }
    finally { working = false }
  }

  async function toggleGlobal() {
    if (working) return
    working = true
    status = ''
    try {
      if (enabled || legacyAccess) {
        await chrome.runtime.sendMessage({ type: 'sesame:detach-inline-overlays' })
        const removed = await removeAllInlinePermissions()
        if (!removed) throw new Error('permission removal failed')
        enabled = false
        legacyAccess = false
        status = 'Sesame was removed from website fields.'
      } else {
        enabled = await chrome.permissions.request({ origins: [GLOBAL_HTTPS_PATTERN] })
        status = enabled ? 'Sesame is ready on HTTPS login fields.' : 'Website access was not granted.'
      }
      await chrome.runtime.sendMessage({ type: 'sesame:sync-inline-overlay' })
    } catch {
      status = 'Could not change website access.'
    } finally {
      working = false
    }
  }

  async function upgradeGlobal() {
    if (working) return
    working = true
    status = ''
    try {
      const granted = await chrome.permissions.request({ origins: [GLOBAL_HTTPS_PATTERN] })
      if (!granted) {
        status = 'Website access was not granted.'
        return
      }
      enabled = true
      legacyAccess = false
      await removeLegacySitePermissions().catch(() => false)
      await chrome.runtime.sendMessage({ type: 'sesame:sync-inline-overlay' })
      status = 'Sesame is ready on HTTPS login fields.'
    } catch {
      status = enabled ? 'Sesame is ready on HTTPS login fields.' : 'Could not change website access.'
    } finally {
      working = false
    }
  }

  async function resume(origin: string) {
    try {
      await setSitePaused(origin, false)
      pausedOrigins = pausedOrigins.filter((candidate) => candidate !== origin)
      await chrome.runtime.sendMessage({ type: 'sesame:sync-inline-overlay' })
      status = `Sesame resumed on ${new URL(origin).hostname}.`
    } catch {
      status = 'Could not resume that site.'
    }
  }

  async function resumeAll() {
    try {
      const settings = await clearPausedSites()
      pausedOrigins = settings.pausedOrigins
      await chrome.runtime.sendMessage({ type: 'sesame:sync-inline-overlay' })
      status = 'All paused sites were resumed.'
    } catch {
      status = 'Could not resume the paused sites.'
    }
  }
</script>

<main class="options">
  <h1>Sesame settings</h1>

  <section class="connection" class:ok={desktop.status === 'ready'} class:warn={desktop.status === 'blocked'} aria-live="polite">
    <div class="state">
      <Icon name={desktop.status === 'ready' ? 'check' : desktop.status === 'blocked' ? 'alert' : 'refresh'} size={22} />
      <div class="copy">
        <strong>{connection.title}</strong>
        <p>{desktop.status === 'ready' ? 'Sesame fills only after you approve in the desktop app.' : connection.message}</p>
      </div>
    </div>
    {#if desktop.status !== 'ready'}
      <div class="actions">
        {#if connection.action === 'install' || connection.action === 'update'}
          <a class="btn primary" href={SESAME_LINKS.desktopReleases} target="_blank" rel="noopener noreferrer">{connection.actionLabel}</a>
        {:else if connection.action === 'open-desktop'}
          <button class="btn primary" type="button" disabled={opening} on:click={openDesktop}>{opening ? 'Opening…' : connection.actionLabel}</button>
        {:else if connection.action === 'reload'}
          <button class="btn primary" type="button" on:click={() => chrome.runtime.reload()}>{connection.actionLabel}</button>
        {/if}
        <button class="btn" type="button" disabled={checking} on:click={checkDesktop}>{checking ? 'Checking…' : 'Check again'}</button>
        {#if diagnostic}<button class="btn" type="button" on:click={copyDetails}>{copied ? 'Copied' : 'Copy details for support'}</button>{/if}
      </div>
    {:else}
      <div class="actions"><button class="btn" type="button" disabled={checking} on:click={checkDesktop}>{checking ? 'Checking…' : 'Check again'}</button></div>
    {/if}
  </section>

  <section>
    <h2>Website access</h2>
    <div class="row">
      <div class="copy">
        <strong>Show Sesame on websites</strong>
        <p>{enabled ? 'Sesame appears on HTTPS sign-in and registration fields.' : legacyAccess ? 'Older site-by-site access is active. Upgrade to cover every HTTPS site.' : 'Sesame stays off on websites, but the popup and the keyboard shortcut still work.'}</p>
      </div>
      {#if legacyAccess}
        <button class="btn" type="button" disabled={working} on:click={upgradeGlobal}>{working ? 'Upgrading…' : 'Upgrade'}</button>
      {/if}
      <Switch checked={enabled || legacyAccess} disabled={working} label="Show Sesame on websites" onToggle={toggleGlobal} />
    </div>
    <div class="row">
      <div class="copy">
        <strong>Suggest cards on checkout forms</strong>
        <p>{cardSuggestionsEnabled ? 'Sesame offers cards on HTTPS checkout forms, and each fill needs desktop approval.' : 'Sesame will not offer saved cards in the browser.'}</p>
      </div>
      <Switch checked={cardSuggestionsEnabled} disabled={working} label="Suggest cards on checkout forms" onToggle={toggleCardSuggestions} />
    </div>
    <div class="row">
      <div class="copy">
        <strong>Paused sites</strong>
        <p>{pausedOrigins.length === 0 ? 'No site is paused. A site appears here when you hide the inline control on it.' : 'The inline control is hidden on these sites.'}</p>
      </div>
      {#if pausedOrigins.length > 1}<button class="btn" type="button" on:click={resumeAll}>Resume all</button>{/if}
    </div>
    {#if pausedOrigins.length > 0}
      <ul class="paused">
        {#each pausedOrigins as origin (origin)}
          <li><span>{new URL(origin).hostname}</span><button class="btn small" type="button" on:click={() => resume(origin)}>Resume</button></li>
        {/each}
      </ul>
    {/if}
  </section>

  <section>
    <div class="section-head">
      <h2>Keyboard</h2>
      <button class="btn small" type="button" on:click={openShortcuts}>Change shortcuts</button>
    </div>
    <div class="row">
      <div class="copy">
        <strong>Fill a login</strong>
        <p>It works on any page, with or without website access.</p>
      </div>
      <span class="keys"><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>L</kbd></span>
    </div>
    <div class="row">
      <div class="copy">
        <strong>Fill an identity</strong>
        <p>It fills name, address and contact fields.</p>
      </div>
      <span class="keys"><kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd></span>
    </div>
  </section>

  {#if status}{#key status}<p class="status" role="status">{status}</p>{/key}{/if}

  <section>
    <h2>Help</h2>
    <ul class="links">
      <li><a href={setupGuideUrl} target="_blank" rel="noopener noreferrer">Setup guide</a><span class="hint">Go through the desktop app and website access again.</span></li>
      {#each HELP_LINKS as link (link.href)}
        <li><a href={link.href} target="_blank" rel="noopener noreferrer">{link.label}</a><span class="hint">{link.hint}</span></li>
      {/each}
    </ul>
  </section>

  <p class="version">Version {version}. Licensed under AGPL-3.0-or-later. Sesame never reads existing field values and never submits a form.</p>
</main>

<style>
  .options { box-sizing: border-box; max-width: 680px; margin: 40px auto; padding: var(--space-6); border-radius: var(--radius-xl); background: var(--surface); box-shadow: var(--shadow-raised); }
  h1 { margin: 0; color: var(--text-heading); font-family: var(--font-display); font-variation-settings: var(--font-display-settings); font-size: var(--type-6); font-weight: var(--weight-regular); line-height: 1.2; }
  .section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--space-3); margin: var(--space-6) 0 var(--space-2); }
  .section-head h2 { margin: 0; }
  h2 { margin: var(--space-6) 0 var(--space-2); color: var(--text-heading); font-size: var(--type-4); font-weight: var(--weight-bold); }
  strong { color: var(--text-heading); font-size: var(--type-3); font-weight: var(--weight-medium); }
  p { margin: 2px 0 0; color: var(--text-muted); line-height: 1.5; }

  .connection { display: grid; gap: var(--space-4); margin-top: var(--space-5); padding: var(--space-4) var(--space-5); border-radius: var(--radius-lg); background: var(--surface-inset); }
  .connection.ok { background: var(--ok-bg); }
  .connection.warn { background: var(--warn-bg); }
  .state { display: flex; align-items: flex-start; gap: var(--space-3); min-width: 0; color: var(--text-faint); }
  .state :global(svg) { flex: none; margin-top: 1px; }
  .connection.ok .state { color: var(--ok-text); }
  .connection.warn .state { color: var(--warn-text); }
  .connection.ok strong, .connection.warn strong { color: inherit; }
  .connection.ok p, .connection.warn p { color: inherit; }
  .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); padding-left: calc(22px + var(--space-3)); }

  .row { display: flex; align-items: center; gap: var(--space-4); padding: var(--space-4) 0; border-top: 1px solid var(--border-soft); }
  .copy { flex: 1; min-width: 0; }
  .keys { flex: none; color: var(--text-2); white-space: nowrap; }

  .paused { margin: 0; padding: 0; list-style: none; }
  .paused li { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-2) 0; border-top: 1px solid var(--border-soft); color: var(--text); font-size: var(--type-3); }

  .btn { display: inline-flex; min-height: var(--control-h-md); align-items: center; justify-content: center; border: 1px solid var(--button-secondary-border); border-radius: var(--control-radius); padding: 0 var(--control-px-md); color: var(--text-heading); background: var(--button-secondary-bg); box-shadow: var(--button-secondary-shadow); font: var(--control-weight) var(--type-2) var(--font-ui); text-decoration: none; white-space: nowrap; cursor: pointer; transition: var(--control-transition); }
  .btn:hover { background: var(--button-secondary-hover-bg); }
  .btn:active { transform: var(--control-press); }
  .btn:disabled { cursor: wait; opacity: var(--control-disabled); }
  .btn.primary { border-color: transparent; color: var(--on-accent); background: var(--accent); box-shadow: var(--button-shadow); }
  .btn.primary:hover { background: var(--accent-hover); }
  .btn.small { min-height: var(--control-h-sm); padding: 0 var(--control-px-sm); }

  .status { margin: var(--space-4) 0 0; color: var(--accent); font-weight: var(--weight-bold); animation: rise .24s ease, leave .4s ease 6s forwards; }
  @keyframes leave { to { opacity: 0; visibility: hidden; } }
  @keyframes rise { from { opacity: 0; transform: translateY(4px); } }

  .links { margin: 0; padding: 0; list-style: none; }
  .links li { display: grid; gap: var(--space-1); padding: var(--space-3) 0; border-top: 1px solid var(--border-soft); }
  .links a { justify-self: start; color: var(--accent-link); font-size: var(--type-3); font-weight: var(--weight-medium); }
  .links .hint { color: var(--text-muted); }

  .version { margin-top: var(--space-6); color: var(--text-faint); font-size: var(--type-2); }
  kbd { border-radius: var(--radius-sm); padding: 2px 6px; background: var(--surface-inset); color: var(--text-2); font: var(--weight-medium) var(--type-1) var(--font-code); }

  @media (max-width: 600px) {
    .options { margin: 0; padding: var(--space-5) var(--space-4); border-radius: 0; box-shadow: none; }
    .row { flex-wrap: wrap; }
  }
</style>
