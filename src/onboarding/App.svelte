<script lang="ts">
  import { onMount } from 'svelte'
  import { dismissOnboarding, GLOBAL_HTTPS_PATTERN } from '../permissions/inline-access'
  import { DESKTOP_RELEASES_URL } from '../protocol/connection-presentation'
  import { SESAME_LINKS } from '../shared/links'
  import { desktopStateFromResponse, onboardingView, setupSteps, type DesktopState, type PermissionState } from './readiness'
  import Icon from '../shared/Icon.svelte'

  const CONNECTION_TIMEOUT_MS = 9_000

  let permission: PermissionState = 'not-granted'
  let desktop: DesktopState = { status: 'checking' }
  let working = false
  let checking = false
  let opening = false
  let status = ''

  $: view = onboardingView(permission, desktop)
  $: steps = setupSteps(permission, desktop)

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

    <section aria-live="polite">
      <h1>{view.headline}</h1>
      <p class="lead">{view.lead}</p>
    </section>

    <ol class="steps">
      {#each steps as step, index (step.title)}
        <li class={step.state}>
          <span class="marker">{#if step.state === 'done'}<Icon name="check" size={14} />{:else}{index + 1}{/if}</span>
          <div>
            <strong>{step.title}</strong>
            {#if step.detail}<p>{step.detail}</p>{/if}
            {#if step.state === 'current' && index === 0 && view.connection && view.showConnectionAction}
              <div class="actions">
                {#if view.connection.action === 'install' || view.connection.action === 'update'}
                  <a class="primary" href={DESKTOP_RELEASES_URL} target="_blank" rel="noopener noreferrer">{view.connection.actionLabel}</a>
                {:else if view.connection.action === 'open-desktop'}
                  <button class="primary" type="button" disabled={opening} on:click={openDesktop}>
                    {opening ? 'Opening…' : view.connection.actionLabel}
                  </button>
                {/if}
                <button class="secondary" type="button" disabled={checking} on:click={retry}>
                  {checking ? 'Checking…' : 'Check again'}
                </button>
                {#if view.connection.action !== 'install' && view.connection.action !== 'update'}
                  <a class="quiet" href={DESKTOP_RELEASES_URL} target="_blank" rel="noopener noreferrer">Download Sesame</a>
                {/if}
              </div>
            {:else if step.state === 'current' && index === 1}
              <div class="actions">
                <button class="primary" type="button" disabled={working} on:click={enableEverywhere}>
                  {working ? 'Waiting for the browser…' : 'Enable on websites'}
                </button>
                <button class="quiet" type="button" on:click={finish}>Not now</button>
              </div>
            {/if}
          </div>
        </li>
      {/each}
    </ol>

    {#if view.ready}
      <p class="note">Sesame reads a new password only when you choose Save in the popup after filling the form.</p>
      <div class="actions">
        <button class="primary" type="button" on:click={finish}>Close this tab</button>
      </div>
      <p class="shortcut">Press <kbd>Alt+Shift+L</kbd> for a login or <kbd>Alt+Shift+F</kbd> for an identity on Windows and Linux, or <kbd>Command+Shift+L</kbd> for a login or <kbd>Command+Shift+I</kbd> for an identity on Mac.</p>
    {:else if view.showConnectionAction}
      <button class="quiet" type="button" on:click={finish}>Not now</button>
    {/if}

    {#if status}<p class="status" role="status">{status}</p>{/if}
    <p class="help">Need help? <a href={SESAME_LINKS.support} target="_blank" rel="noopener noreferrer">Get support</a> or read the <a href={SESAME_LINKS.privacy} target="_blank" rel="noopener noreferrer">privacy policy</a>.</p>
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
  .steps { display: grid; gap: var(--space-4); margin: 28px 0 0; padding: 0; list-style: none; }
  .steps li { display: flex; align-items: flex-start; gap: var(--space-3); transition: opacity .2s ease; }
  .steps li.waiting .marker, .steps li.waiting strong, .steps li.waiting p { opacity: .6; }
  .steps strong { color: var(--text-heading); font-size: var(--type-3); font-weight: var(--weight-medium); }
  .steps p { margin: 1px 0 0; color: var(--text-muted); font-size: var(--type-2); line-height: 1.45; }
  .marker { display: grid; flex: none; width: 24px; height: 24px; place-items: center; border-radius: 50%; border: 1px solid var(--border-strong); color: var(--text-2); font-size: var(--type-1); font-weight: var(--weight-bold); transition: background-color .2s ease, color .2s ease; }
  .steps li.current .marker { border-color: var(--accent); color: var(--accent); }
  .steps li.done .marker { border-color: transparent; color: var(--on-accent); background: var(--accent); }
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); margin-top: var(--space-3); }
  button, a.primary {
    display: inline-flex;
    min-height: var(--control-h-lg);
    align-items: center;
    justify-content: center;
    gap: var(--control-gap);
    border: 1px solid transparent;
    border-radius: var(--control-radius);
    padding: 0 var(--control-px-lg);
    font-family: var(--font-ui);
    font-size: var(--type-2);
    font-weight: var(--control-weight);
    cursor: pointer;
    transition: var(--control-transition);
  }
  button:active, a.primary:active { transform: var(--control-press); }
  button:disabled:active { transform: none; }
  a.primary { text-decoration: none; }
  .primary { color: var(--on-accent); background: var(--accent); box-shadow: var(--button-shadow); }
  .primary:hover { background: var(--accent-hover); }
  .primary:active { background: var(--accent-active); box-shadow: var(--button-shadow-pressed); }
  .secondary { border-color: var(--button-secondary-border); color: var(--text-heading); background: var(--button-secondary-bg); box-shadow: var(--button-secondary-shadow); }
  .secondary:hover { background: var(--button-secondary-hover-bg); }
  button:disabled { cursor: wait; opacity: var(--control-disabled); }
  .note, .status, .shortcut { color: var(--text-muted); font-size: var(--type-2); line-height: 1.5; }
  .note { margin: 24px 0 0; }
  .quiet { margin-top: var(--space-5); border-color: transparent; padding: 0; min-height: 0; color: var(--text-muted); background: none; text-decoration: underline; }
  .actions .quiet { margin-top: 0; }
  .quiet:hover { color: var(--text-heading); }
  a.quiet { font-size: var(--type-2); font-weight: var(--control-weight); }
  .status { margin-top: 12px; }
  .shortcut { margin-top: 16px; }
  .help { margin: var(--space-5) 0 0; color: var(--text-muted); font-size: var(--type-2); }
  .help a { color: var(--accent); font-weight: var(--weight-medium); }
  kbd { border-radius: var(--radius-sm); padding: 2px 6px; background: var(--surface-inset); color: var(--text-2); font: var(--weight-medium) var(--type-1) var(--font-code); }
</style>
