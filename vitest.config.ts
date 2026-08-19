import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // A suite that disappears has to fail the run. With this allowed, the gate
    // stayed green for months while tests/ held nothing at all.
    passWithNoTests: false,
  },
})
