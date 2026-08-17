<script lang="ts">
  import { onMount } from 'svelte'
  import {
    clearPausedSites, GLOBAL_HTTPS_PATTERN, inlinePermissionMode, loadInlineSettings,
    removeAllInlinePermissions, setSitePaused,
  } from '../permissions/inline-access'

  let enabled = false
  let legacyAccess = false
  let pausedOrigins: string[] = []
  let working = false
  let status = ''

  onMount(refresh)

  async function refresh() {
    const [permissions, settings] = await Promise.all([chrome.permissions.getAll(), loadInlineSettings()])
    const mode = inlinePermissionMode(permissions.origins)
    enabled = mode === 'global'
    legacyAccess = mode === 'legacy-sites'
    pausedOrigins = settings.pausedOrigins
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

  async function resume(origin: string) {
    await setSitePaused(origin, false)
    pausedOrigins = pausedOrigins.filter((candidate) => candidate !== origin)
    await chrome.runtime.sendMessage({ type: 'sesame:sync-inline-overlay' })
    status = `Sesame resumed on ${new URL(origin).hostname}.`
  }

  async function resumeAll() {
    const settings = await clearPausedSites()
    pausedOrigins = settings.pausedOrigins
    await chrome.runtime.sendMessage({ type: 'sesame:sync-inline-overlay' })
    status = 'All paused sites were resumed.'
  }
</script>

<main class="options">
  <h1>Settings</h1>
  <p class="intro">Enable once. Sesame then appears automatically on safe sign-in and registration fields across HTTPS websites.</p>

  <section class="setting">
    <div>
      <strong>Show Sesame on websites</strong>
      <p>{enabled ? 'Active across HTTPS websites.' : legacyAccess ? 'Older site-by-site access is active. Upgrade to global access.' : 'Currently disabled.'}</p>
    </div>
    <button class:danger={enabled || legacyAccess} type="button" disabled={working} on:click={toggleGlobal}>
      {enabled || legacyAccess ? 'Turn off' : working ? 'Enabling…' : 'Enable'}
    </button>
  </section>

  <p class="privacy">Sesame detects field structure but never reads existing values. Filling still requires desktop approval and never submits the form.</p>

  <section class="paused">
    <div class="section-heading">
      <div><strong>Paused inline controls</strong><p>Only sites where you explicitly hid the inline control are stored here.</p></div>
      {#if pausedOrigins.length > 1}<button type="button" on:click={resumeAll}>Resume all</button>{/if}
    </div>
    {#if pausedOrigins.length === 0}
      <p class="empty">No paused sites.</p>
    {:else}
      <ul>
        {#each pausedOrigins as origin}
          <li><span>{new URL(origin).hostname}</span><button type="button" on:click={() => resume(origin)}>Resume</button></li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="shortcut"><strong>Keyboard fill</strong><p>Press <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>L</kbd> on a login page. Browser shortcut conflicts can be changed from the browser's extension shortcut settings.</p></section>
  {#if status}<p class="status" role="status">{status}</p>{/if}
</main>

<style>
  .options { box-sizing: border-box; max-width: 680px; margin: 40px auto; padding: 32px; background: var(--surface); border-radius: var(--radius-xl); border: 0; box-shadow: var(--shadow-panel); }
  h1 { margin: 0; color: var(--text-heading); font: 600 27px var(--font-display); }
  .intro { max-width: 560px; color: var(--text-muted); line-height: 1.5; }
  .setting, .section-heading, li { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
  .setting { margin-top: 24px; padding: 16px; border: 0; border-radius: var(--radius-md); background: var(--surface-inset); }
  strong { font-size: 14px; color: var(--text-heading); } p { margin: 4px 0 0; color: var(--text-muted); font-size: 13px; }
  button { border: 0; border-radius: var(--radius-pill); padding: 8px 14px; color: var(--accent-link); background: var(--tint); font-weight: 700; cursor: pointer; transition: background-color .16s ease, transform .1s ease; }
  button:hover { background: var(--tint-hover); }
  button:active { transform: scale(.96); }
  button.danger { color: var(--warn-text); background: var(--warn-bg); }
  button:disabled { cursor: wait; opacity: .6; }
  button:disabled:active { transform: none; }
  .privacy, .shortcut { margin-top: 16px; padding: 13px; border-radius: var(--radius-md); background: var(--tint); line-height: 1.5; }
  .paused { margin-top: 28px; }
  .section-heading > button { font-size: 11px; }
  ul { margin: 12px 0 0; padding: 0; list-style: none; }
  li { padding: 10px 0; border-top: 1px solid var(--border-soft); font-size: 13px; }
  li button { padding: 5px 10px; font-size: 11px; }
  .empty { margin-top: 12px; padding: 12px; border-radius: var(--radius-sm); background: var(--surface-inset); }
  .shortcut { background: var(--surface-inset); }
  kbd { border-radius: 5px; padding: 2px 6px; background: var(--surface); color: var(--text-2); font: 600 11px var(--font-code); }
  .status { margin-top: 18px; color: var(--accent); font-weight: 650; }
</style>
