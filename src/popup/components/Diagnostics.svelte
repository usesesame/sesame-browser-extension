<script lang="ts">
  export let diagnostic: Record<string, unknown> | undefined
  import type { PageDiagnostic } from '../states/store'
  import { formatCheckTime, safeDiagnosticText } from '../../protocol/diagnostics'

  export let pageDiagnostic: PageDiagnostic | undefined

  let copied = false

  async function copy() {
    if (!diagnostic) return
    const text = safeDiagnosticText(diagnostic, {
      pageResult: pageDiagnostic?.code ?? 'not-checked',
      usernameField: pageDiagnostic?.hasUsernameField ?? false,
      passwordField: pageDiagnostic?.hasPasswordField ?? false,
      surfaceKind: pageDiagnostic?.surfaceKind ?? 'unknown',
    })
    try {
      await navigator.clipboard.writeText(text)
      copied = true
      setTimeout(() => (copied = false), 1200)
    } catch { /* ignore */ }
  }
</script>

{#if diagnostic}
  <details class="diagnostics">
    <summary>
      <svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
      Connection details
    </summary>
    <dl>
      <dt>Result</dt><dd>{String(diagnostic.code ?? 'unknown')}</dd>
      <dt>Last check</dt><dd>{formatCheckTime(diagnostic.checkedAt)}</dd>
      <dt>Response</dt><dd>{typeof diagnostic.latencyMs === 'number' ? `${diagnostic.latencyMs} ms` : 'No response'}</dd>
      <dt>Protocol</dt><dd>{String(diagnostic.protocolVersion ?? 'unknown')}</dd>
      <dt>Page</dt><dd>{pageDiagnostic?.code ?? 'not-checked'}</dd>
    </dl>
    <button on:click={copy}>{copied ? 'Copied safely' : 'Copy safe diagnostic'}</button>
  </details>
{/if}
<style>
  .diagnostics {
    margin-top: 12px;
    font-size: var(--type-2);
    color: var(--text-muted);
  }
  .diagnostics { interpolate-size: allow-keywords; }
  .diagnostics::details-content {
    block-size: 0;
    overflow: clip;
    transition: block-size .22s ease, content-visibility .22s allow-discrete;
  }
  .diagnostics[open]::details-content { block-size: auto; }
  summary {
    display: flex;
    align-items: center;
    gap: 6px;
    width: fit-content;
    border-radius: var(--radius-sm);
    cursor: pointer;
    list-style: none;
    user-select: none;
    transition: color .16s ease;
  }
  summary::-webkit-details-marker { display: none; }
  summary:hover { color: var(--text-heading); }
  summary:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
  .chevron { flex: none; transition: transform .22s ease; }
  .diagnostics[open] .chevron { transform: rotate(90deg); }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; margin: 8px 0; padding: 8px; border-radius: var(--radius-sm); background: var(--surface-inset); }
  dt { color: var(--text-faint); }
  dd { min-width: 0; margin: 0; overflow: hidden; color: var(--text); text-overflow: ellipsis; white-space: nowrap; }
  button {
    margin-top: 6px;
    min-height: 24px;
    padding: 5px 10px;
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    color: var(--text);
    cursor: pointer;
    transition: background-color .16s ease, transform .1s ease;
  }
  button:hover { background: var(--tint); }
  button:active { transform: scale(.96); }
</style>
