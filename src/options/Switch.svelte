<script lang="ts">
  export let checked = false
  export let disabled = false
  export let label: string
  export let onToggle: () => void
</script>

<button class="switch" class:on={checked} type="button" role="switch" aria-checked={checked} aria-label={label} {disabled} on:click={onToggle}>
  <span class="knob"></span>
</button>

<style>
  .switch { position: relative; flex: none; width: 44px; height: 26px; padding: 0; border: 0; border-radius: var(--radius-pill); background: color-mix(in srgb, var(--text) 22%, var(--surface)); cursor: pointer; transition: background .15s ease; }
  .switch.on { background: var(--accent); }
  .switch:disabled { cursor: wait; opacity: var(--control-disabled); }
  .knob { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: var(--surface); box-shadow: 0 1px 2px rgb(0 0 0 / .25); transition: transform .15s ease; }
  .switch.on .knob { transform: translateX(18px); }
  @media (prefers-reduced-motion: reduce) { .switch, .knob { transition: none; } }
</style>
