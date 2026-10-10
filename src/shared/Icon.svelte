<script lang="ts">
  import { ICON_PATHS, type IconName } from './icons'

  export let name: IconName
  export let size = 20
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#each ICON_PATHS[name] as path (path)}<path d={path} />{/each}
</svg>
