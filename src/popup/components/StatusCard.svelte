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

<section class="card {toneClass}">
  <h2>{title}</h2>
  {#if message}<p>{message}</p>{/if}
</section>

<style>
  .card {
    border: 0;
    border-radius: var(--radius-md);
    padding: 12px;
    margin-bottom: 12px;
    background: var(--surface);
    box-shadow: var(--shadow-panel);
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
  .status-success { background: var(--tint); }
  .status-success h2 { color: var(--accent); }
  .status-warning { background: var(--warn-bg); }
  .status-warning h2 { color: var(--warn-text); }
  .status-error { background: var(--danger-tint); }
  .status-error h2 { color: var(--danger); }
</style>
