<script lang="ts">
  export let title: string
  export let message: string
  export let tone: 'neutral' | 'success' | 'warning' | 'error' = 'neutral'

  const toneClass = {
    neutral: 'status-neutral',
    success: 'status-success',
    warning: 'status-warning',
    error: 'status-error',
  }[tone]
</script>

<section class="connection-status {toneClass}">
  <h2>{title}</h2>
  {#if message}<p>{message}</p>{/if}
</section>

<style>
  .connection-status {
    position: relative;
    margin: 0 0 10px;
    border: 0;
    padding: 9px 4px 9px 20px;
    background: transparent;
  }
  .connection-status::before {
    position: absolute;
    top: 14px;
    left: 5px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-faint);
    content: '';
  }
  h2 {
    margin: 0 0 4px;
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 600;
  }
  p {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }
  .status-success::before { background: var(--ok-text); }
  .status-success h2 { color: var(--accent); }
  .status-warning::before { background: var(--warn-text); }
  .status-warning h2 { color: var(--warn-text); }
  .status-error::before { background: var(--danger); }
  .status-error h2 { color: var(--danger); }
</style>
