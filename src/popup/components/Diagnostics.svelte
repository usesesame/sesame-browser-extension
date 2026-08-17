<script lang="ts">
  export let diagnostic: Record<string, unknown> | undefined
  import type { PageDiagnostic } from '../states/store'

  export let pageDiagnostic: PageDiagnostic | undefined

  let copied = false

  async function copy() {
    if (!diagnostic) return
    const safeReport = {
      ...diagnostic,
      pageResult: pageDiagnostic?.code ?? 'not-checked',
      usernameField: pageDiagnostic?.hasUsernameField ?? false,
      passwordField: pageDiagnostic?.hasPasswordField ?? false,
      surfaceKind: pageDiagnostic?.surfaceKind ?? 'unknown',
      pageAccess: 'active-tab-only',
      fieldValuesRead: false,
      secretsIncluded: false,
    }
    const text = Object.entries(safeReport).map(([key, value]) => `${key}=${String(value)}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      copied = true
      setTimeout(() => (copied = false), 1200)
    } catch { /* ignore */ }
  }
</script>

{#if diagnostic}
  <details class="diagnostics">
    <summary>Connection details</summary>
    <dl>
      <dt>Result</dt><dd>{String(diagnostic.code ?? 'unknown')}</dd>
      <dt>Last check</dt><dd>{String(diagnostic.checkedAt ?? 'unknown')}</dd>
      <dt>Response</dt><dd>{typeof diagnostic.latencyMs === 'number' ? `${diagnostic.latencyMs} ms` : 'No response'}</dd>
      <dt>Protocol</dt><dd>{String(diagnostic.protocolVersion ?? 'unknown')}</dd>
      <dt>Page</dt><dd>{pageDiagnostic?.code ?? 'not-checked'}</dd>
    </dl>
    <button on:click={copy}>{copied ? 'Copied safely' : 'Copy safe diagnostic'}</button>
  </details>
{/if}
{#if pageDiagnostic}
  <p class="page-code">Page check: <code>{pageDiagnostic.code}</code></p>
{/if}

<style>
  .diagnostics {
    margin-top: 12px;
    font-size: 11px;
    color: var(--text-muted);
  }
  summary {
    cursor: pointer;
    user-select: none;
  }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; margin: 8px 0; padding: 8px; border-radius: var(--radius-sm); background: var(--surface-inset); }
  dt { color: var(--text-faint); }
  dd { min-width: 0; margin: 0; overflow: hidden; color: var(--text); text-overflow: ellipsis; white-space: nowrap; }
  button {
    margin-top: 6px;
    padding: 5px 10px;
    border: 0;
    border-radius: 6px;
    background: var(--surface-inset);
    color: var(--text);
    cursor: pointer;
    transition: background-color .16s ease, transform .1s ease;
  }
  button:hover { background: var(--tint); }
  button:active { transform: scale(.96); }
  .page-code {
    margin: 8px 0 0;
    font-size: 11px;
    color: var(--text-muted);
  }
  code {
    background: var(--surface-inset);
    padding: 1px 4px;
    border-radius: 4px;
  }
</style>
