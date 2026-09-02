import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig(({ mode }) => ({
  build: {
    outDir: `dist/${mode}`,
    emptyOutDir: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/content/overlay-main.ts'),
      formats: ['iife'],
      name: 'SesameInlineOverlay',
      fileName: () => 'content-overlay.js',
    },
  },
}))
