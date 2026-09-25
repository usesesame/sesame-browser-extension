<script lang="ts">
  import { onMount } from 'svelte'
  import { dismissOnboarding, GLOBAL_HTTPS_PATTERN } from '../permissions/inline-access'
  import { DESKTOP_RELEASES_URL } from '../protocol/connection-presentation'
  import { desktopStateFromResponse, onboardingView, type DesktopState, type PermissionState } from './readiness'

  const CONNECTION_TIMEOUT_MS = 9_000
  const POPUP_HINT = 'The popup and the keyboard shortcut keep working without website access.'

  let permission: PermissionState = 'not-granted'
  let desktop: DesktopState = { status: 'checking' }
  let working = false
  let checking = false
  let opening = false
  let status = ''

  $: view = onboardingView(permission, desktop)

  onMount(() => {
    void initialize()
    const recheck = () => {
      if (desktop.status !== 'ready') void checkDesktop(true)
    }
    window.addEventListener('focus', recheck)
    return () => window.removeEventListener('focus', recheck)
  })

  async function initialize() {
    try {
      const granted = await chrome.permissions.contains({ origins: [GLOBAL_HTTPS_PATTERN] })
      permission = granted ? 'granted' : 'not-granted'
    } catch {
      permission = 'not-granted'
    }
    await checkDesktop(true)
  }

  async function checkDesktop(force: boolean) {
    if (checking) return
    checking = true
    try {
      const response = await withTimeout(
        chrome.runtime.sendMessage({ type: 'sesame:connect', force }),
        CONNECTION_TIMEOUT_MS,
      )
      desktop = desktopStateFromResponse(response)
    } catch {
      desktop = { status: 'blocked', code: 'extension-response-timeout' }
    } finally {
      checking = false
    }
  }

  async function retry() {
    status = ''
    await checkDesktop(true)
    status = desktop.status === 'ready'
      ? 'Sesame is connected.'
      : desktop.status === 'locked'
        ? 'Sesame is locked. Unlock it in the desktop app, then check again.'
        : 'Sesame is still not connected. Install or open the desktop app, then check again.'
  }

  async function openDesktop() {
    if (opening) return
    opening = true
    status = ''
    try {
      const result = await withTimeout(
        chrome.runtime.sendMessage({ type: 'sesame:open-desktop' }),
        CONNECTION_TIMEOUT_MS,
      )
      status = result?.state === 'opened'
        ? 'Sesame is opening. Unlock it, then check again.'
        : 'Sesame could not be opened. Start the desktop app once, then check again.'
    } catch {
      status = 'Sesame could not be opened. Start the desktop app once, then check again.'
    } finally {
      opening = false
    }
  }

  async function enableEverywhere() {
    if (working) return
    working = true
    status = ''
    try {
      const granted = await chrome.permissions.request({ origins: [GLOBAL_HTTPS_PATTERN] })
      if (!granted) {
        status = 'Website access was not granted. You can enable it later from the Sesame popup.'
        return
      }
      permission = 'granted'
      await chrome.runtime.sendMessage({ type: 'sesame:sync-inline-overlay' })
      status = desktop.status === 'ready'
        ? 'Sesame is ready on HTTPS login fields.'
        : 'Website access is on. Sesame starts filling once the desktop app is connected.'
    } catch {
      status = 'The browser could not change website access.'
    } finally {
      working = false
    }
  }

  async function finish() {
    await dismissOnboarding()
    window.close()
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
</script>

<main>
  <div class="card">
    <div class="brand">
      <img class="logo" src="icons/48x48.png" alt="" />
      <span>Sesame</span>
    </div>

    <h1>{view.headline}</h1>
    <p class="lead">{view.lead}</p>

    {#if view.ready}
      <div class="success" role="status">Sesame is enabled on HTTPS websites.</div>
      <button class="primary" type="button" on:click={finish}>Close this tab</button>
    {:else}
      <section class="connection" class:ok={view.connection.state === 'ready'} aria-live="polite">
        <strong>{view.connection.title}</strong>
        {#if view.connection.message}<p>{view.connection.message}</p>{/if}
      </section>

      {#if view.showConnectionAction}
        <div class="actions">
          {#if view.connection.action === 'install' || view.connection.action === 'update'}
            <a class={view.showPermissionStep ? 'secondary' : 'primary'} href={DESKTOP_RELEASES_URL} target="_blank" rel="noopener noreferrer">{view.connection.actionLabel}</a>
          {:else if view.connection.action === 'open-desktop'}
            <button class={view.showPermissionStep ? 'secondary' : 'primary'} type="button" disabled={opening} on:click={openDesktop}>
              {opening ? 'Opening…' : view.connection.actionLabel}
            </button>
          {/if}
          <button class="secondary" type="button" disabled={checking} on:click={retry}>
            {checking ? 'Checking…' : 'Check again'}
          </button>
        </div>
      {/if}
    {/if}

    <ul>
      <li>Sesame reads a new password only when you choose Save in the popup after filling the form.</li>
      <li>Every login fill still requires your approval in the desktop app.</li>
      <li>Sesame never submits or advances a form.</li>
    </ul>

    {#if view.showPermissionStep}
      <section class="permission">
        <div>
          <strong>Show Sesame on login fields</strong>
          <p>Allow Sesame on HTTPS sites. The fill control appears when you focus a sign-in or registration field.</p>
        </div>
        <button class="primary" type="button" disabled={working} on:click={enableEverywhere}>
          {working ? 'Waiting for the browser…' : 'Enable on websites'}
        </button>
      </section>
    {/if}

    {#if !view.ready}
      <button class="secondary not-now" type="button" on:click={finish}>Not now</button>
    {/if}

    {#if status}<p class="status" role="status">{status}</p>{/if}
    <p class="shortcut">{POPUP_HINT} Press <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>L</kbd> for a login or <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>I</kbd> for an identity.</p>
  </div>
</main>

<style>
  :global(html), :global(body) { height: 100%; }
  main {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    padding: 6vh 24px;
  }
  .card {
    box-sizing: border-box;
    width: 100%;
    max-width: 560px;
    margin: auto;
    padding: 40px;
    border: 0;
    border-radius: var(--radius-xl);
    background: var(--surface);
    box-shadow: var(--shadow-raised);
  }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 26px; color: var(--text-2); font-weight: var(--weight-bold); }
  .logo { width: 30px; height: 30px; }
  h1 { margin: 0; color: var(--text-heading); font-family: var(--font-display); font-variation-settings: var(--font-display-settings); font-size: var(--type-6); font-weight: var(--weight-regular); line-height: 1.18; }
  .lead { margin: 14px 0 0; color: var(--text-muted); font-size: var(--type-3); line-height: 1.55; }
  ul { margin: 22px 0 28px; padding-left: 20px; color: var(--text); font-size: var(--type-3); line-height: 1.75; }
  li::marker { color: var(--text-faint); }
  .connection { margin: 18px 0; padding: 13px 16px; border-radius: var(--radius-md); background: var(--warn-bg); }
  .connection.ok { background: var(--ok-bg); }
  .connection strong { display: block; color: var(--warn-text); font-size: var(--type-3); font-weight: var(--weight-bold); }
  .connection.ok strong { color: var(--ok-text); }
  .connection p { margin: 4px 0 0; color: var(--warn-text); font-size: var(--type-2); line-height: 1.5; }
  .connection.ok p { color: var(--ok-text); }
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 22px; }
  button, a.primary, a.secondary {
    border: 0;
    border-radius: var(--radius-md);
    padding: 13px 18px;
    font-size: var(--type-2);
    font-weight: var(--weight-medium);
    cursor: pointer;
    transition: background-color .16s ease, box-shadow .16s ease, transform .1s ease;
  }
  button:active, a.primary:active, a.secondary:active { transform: scale(.97); }
  button:disabled:active { transform: none; }
  a.primary, a.secondary { display: inline-block; text-decoration: none; }
  .primary { color: var(--on-accent); background: var(--accent); box-shadow: inset 0 1px 0 var(--button-edge); }
  .primary:hover { background: var(--accent-hover); }
  .secondary, a.secondary { border: 1px solid var(--border-soft); color: var(--accent-link); background: var(--surface-inset); }
  .secondary:hover, a.secondary:hover { border-color: var(--border-strong); background: var(--tint); }
  button:disabled { cursor: wait; opacity: .65; }
  .permission { display: grid; gap: 10px; margin: 0 0 22px; padding: 13px 16px; border-radius: var(--radius-md); background: var(--surface-inset); }
  .permission strong { font-size: var(--type-3); font-weight: var(--weight-bold); }
  .permission p { margin: 3px 0 0; color: var(--text-muted); font-size: var(--type-2); line-height: 1.5; }
  .not-now { margin-top: 4px; }
  .success { margin-bottom: 18px; padding: 13px 16px; border-radius: var(--radius-md); color: var(--ok-text); background: var(--ok-bg); font-weight: var(--weight-medium); }
  .status, .shortcut { color: var(--text-muted); font-size: var(--type-2); }
  .status { margin-top: 12px; }
  .shortcut { margin-top: 26px; }
  kbd { border-radius: var(--radius-sm); padding: 2px 6px; background: var(--surface-inset); color: var(--text-2); font: var(--weight-medium) var(--type-1) var(--font-code); }
</style>
