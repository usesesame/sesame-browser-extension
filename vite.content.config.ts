import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { shippedPackages } from './scripts/shipped-packages.mjs'

export default defineConfig(({ mode }) => ({
  plugins: [shippedPackages(`content-${mode}`)],
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
