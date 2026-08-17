<script lang="ts">
  import { onMount } from 'svelte'
  import { dismissOnboarding, GLOBAL_HTTPS_PATTERN } from '../permissions/inline-access'

  let enabled = false
  let working = false
  let status = ''

  onMount(async () => {
    enabled = await chrome.permissions.contains({ origins: [GLOBAL_HTTPS_PATTERN] })
  })

  async function enableEverywhere() {
    if (working) return
    working = true
    status = ''
    try {
      enabled = await chrome.permissions.request({ origins: [GLOBAL_HTTPS_PATTERN] })
      if (enabled) {
        await chrome.runtime.sendMessage({ type: 'sesame:sync-inline-overlay' })
        status = 'Sesame is ready on HTTPS login fields.'
      } else {
        status = 'Website access was not granted. You can enable it later from the Sesame popup.'
      }
    } catch {
      status = 'The browser could not change website access.'
    } finally {
      working = false
    }
  }

  async function notNow() {
    await dismissOnboarding()
    window.close()
  }
</script>

<main>
  <div class="card">
    <div class="mark" aria-hidden="true">S</div>
    <h1>Bring Sesame to your login fields</h1>
    <p class="lead">Enable Sesame once and its fill control will appear automatically when you focus a safe sign-in or registration field.</p>

    <ul>
      <li>Existing field values are never read.</li>
      <li>Every login fill still requires your approval in the desktop app.</li>
      <li>Sesame never submits or advances a form.</li>
    </ul>

    {#if enabled}
      <div class="success" role="status">Sesame is enabled on HTTPS websites.</div>
    {:else}
      <button class="primary" type="button" disabled={working} on:click={enableEverywhere}>
        {working ? 'Waiting for the browser…' : 'Enable on websites'}
      </button>
      <button class="secondary" type="button" on:click={notNow}>Not now</button>
    {/if}
    {#if status}<p class="status" role="status">{status}</p>{/if}
    <p class="shortcut">After setup, press <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>L</kbd> to fill without opening the popup.</p>
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
    box-shadow: var(--shadow-panel);
  }
  .mark { display: grid; width: 48px; height: 48px; place-items: center; border-radius: var(--radius-lg); color: var(--gold-text); background: var(--gold-soft-bg); font: 700 22px var(--font-display); }
  h1 { margin: 22px 0 0; color: var(--text-heading); font: 600 30px/1.18 var(--font-display); }
  .lead { margin: 14px 0 0; color: var(--text-muted); font-size: var(--type-3); line-height: 1.55; }
  ul { margin: 22px 0 28px; padding-left: 20px; color: var(--text); font-size: var(--type-2); line-height: 1.75; }
  li::marker { color: var(--text-faint); }
  button {
    border: 0;
    border-radius: var(--radius-md);
    padding: 13px 18px;
    font-size: var(--type-2);
    font-weight: 600;
    cursor: pointer;
    transition: background-color .16s ease, box-shadow .16s ease, transform .1s ease;
  }
  button:active { transform: scale(.97); }
  button:disabled:active { transform: none; }
  .primary { color: var(--on-accent); background: var(--accent); box-shadow: 0 1px 2px rgba(0, 0, 0, .12), 0 3px 8px rgba(0, 0, 0, .1); }
  .primary:hover { background: var(--accent-hover); }
  .secondary { margin-left: 10px; color: var(--accent-link); background: var(--surface-inset); }
  .secondary:hover { background: var(--tint); }
  button:disabled { cursor: wait; opacity: .65; }
  .success { padding: 13px 16px; border-radius: var(--radius-md); color: var(--ok-text); background: var(--ok-bg); font-weight: 600; }
  .status, .shortcut { color: var(--text-muted); font-size: var(--type-2); }
  .status { margin-top: 12px; }
  .shortcut { margin-top: 26px; }
  kbd { border-radius: 5px; padding: 2px 6px; background: var(--surface-inset); color: var(--text-2); font: 600 11px var(--font-code); }
</style>
