<script lang="ts">
  export let title: string
  export let subtitle: string = ''
  export let refreshing = false
  export let onRefresh: () => void = () => {}
  export let onOpenSettings: () => void = () => {}
</script>

<header class="topbar">
  <div class="brand">
    <img class="logo" src="icons/32x32.png" alt="" width="32" height="32" />
    <div class="brand-copy">
      <span class="brand-name">Sesame</span>
      {#if subtitle}
        <span class="brand-meta">{subtitle}</span>
      {/if}
    </div>
  </div>
  <div class="topbar-actions">
    <button class="icon-button" type="button" aria-label="Open Sesame settings" title="Settings" on:click={onOpenSettings}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>
    </button>
    <button class="icon-button" type="button" aria-label={`${title}: check desktop connection and page again`} title="Check again" disabled={refreshing} on:click={onRefresh}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18.7 9A7 7 0 0 0 6.2 6.2L4 8"/><path d="M5.3 15A7 7 0 0 0 17.8 17.8L20 16"/></svg>
    </button>
  </div>
</header>

<style>
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 38px;
    margin-bottom: 12px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .logo {
    display: block;
    width: 30px;
    height: 30px;
    flex: 0 0 30px;
  }
  .brand-copy { display: grid; gap: 1px; }
  .brand-name { font-family: var(--font-display); font-size: 15px; font-weight: 600; color: var(--text-heading); letter-spacing: -.01em; }
  .brand-meta { color: var(--text-muted); font-size: 11px; }
  .topbar-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; }
  .icon-button { display: grid; width: 30px; height: 30px; place-items: center; border: 0; border-radius: var(--radius-sm); padding: 0; color: var(--text-muted); background: transparent; cursor: pointer; transition: background-color .16s ease, color .16s ease, transform .1s ease; }
  .icon-button:hover { color: var(--text); background: var(--tint); }
  .icon-button:active { transform: scale(.9); }
  .icon-button:disabled { cursor: wait; opacity: .62; }
  .icon-button:disabled:active { transform: none; }
  .icon-button svg { width: 16px; height: 16px; }
</style>
