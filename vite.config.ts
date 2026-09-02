import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const modeToManifest = {
  chrome: 'chrome.json',
  edge: 'edge.json',
  firefox: 'firefox.json',
  integration: 'chrome.json',
}

export default defineConfig(({ mode }) => {
  const manifestName = modeToManifest[mode] ?? 'chrome.json'
  return {
    plugins: [
      svelte(),
      {
        name: 'manifest',
        generateBundle() {
          const manifest = JSON.parse(
            readFileSync(resolve(import.meta.dirname, 'manifests', manifestName), 'utf8')
          )
          if (mode === 'integration') {
            manifest.host_permissions = ['http://127.0.0.1/*', 'http://localhost/*']
          }
          this.emitFile({
            type: 'asset',
            fileName: 'manifest.json',
            source: JSON.stringify(manifest, null, 2),
          })
        },
      },
    ],
    build: {
      outDir: `dist/${mode}`,
      emptyOutDir: true,
      modulePreload: false,
      rollupOptions: {
        input: {
          popup: resolve(import.meta.dirname, 'popup.html'),
          options: resolve(import.meta.dirname, 'options.html'),
          onboarding: resolve(import.meta.dirname, 'onboarding.html'),
          background: resolve(import.meta.dirname, 'src/background/main.ts'),
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: '[name].js',
          assetFileNames: '[name][extname]',
        },
      },
    },
  }
})
