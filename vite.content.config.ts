import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig(({ mode }) => ({
  build: {
    outDir: `dist/${mode}`,
    emptyOutDir: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/content/main.ts'),
      formats: ['iife'],
      name: 'SesameContentBridge',
      fileName: () => 'content.js',
    },
  },
}))
