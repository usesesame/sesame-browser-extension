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
    min-height: var(--control-h-md);
    padding: 0 var(--control-px-md);
    border: 1px solid transparent;
    border-radius: var(--control-radius);
    background: var(--accent);
    color: var(--on-accent);
    font-weight: var(--control-weight);
    cursor: pointer;
    box-shadow: var(--button-shadow);
    transition: var(--control-transition);
  }
  .fill-button:hover:not(:disabled) { background: var(--accent-hover); }
  .fill-button:active:not(:disabled) { background: var(--accent-active); box-shadow: var(--button-shadow-pressed); transform: var(--control-press); }
  .fill-button:disabled {
    opacity: var(--control-disabled);
    cursor: not-allowed;
  }
  .fill-button.secondary {
    border-color: var(--button-secondary-border);
    color: var(--text-heading);
    background: var(--button-secondary-bg);
    box-shadow: var(--button-secondary-shadow);
  }
  .fill-button.secondary:hover:not(:disabled) { background: var(--button-secondary-hover-bg); }
  .fill-button.secondary:active:not(:disabled) { background: var(--control-active-bg), var(--button-secondary-bg); box-shadow: none; }
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
