<script lang="ts">
  export let disabled: boolean = false
  export let loading: boolean = false
  export let onClick: () => void
  export let label: string = 'Fill login'
  export let loadingLabel: string = 'Filling…'
  export let secondary: boolean = false
</script>

<button class="fill-button" class:secondary on:click={onClick} disabled={disabled || loading}>
  {#if loading}
    <span class="spinner" aria-hidden="true"></span>
  {/if}
  <span>{loading ? loadingLabel : label}</span>
</button>

<style>
  .fill-button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    margin-top: 10px;
    padding: 11px 14px;
    border: none;
    border-radius: var(--radius-md);
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(0, 0, 0, .12), 0 3px 8px rgba(0, 0, 0, .1);
    transition: background-color .16s ease, box-shadow .16s ease, transform .1s ease;
  }
  .fill-button:hover:not(:disabled) { background: var(--accent-hover); }
  .fill-button:active:not(:disabled) { background: var(--accent-active); transform: scale(.97); }
  .fill-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .fill-button.secondary {
    color: var(--accent-link);
    background: var(--surface-inset);
    box-shadow: none;
  }
  .fill-button.secondary:hover:not(:disabled) { background: var(--tint); }
  .fill-button.secondary:active:not(:disabled) { background: var(--tint-hover); }
  .fill-button.secondary .spinner {
    border-color: color-mix(in srgb, var(--accent-link) 40%, transparent);
    border-top-color: var(--accent-link);
  }
  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgb(255 255 255 / 40%);
    border-top-color: var(--on-accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
