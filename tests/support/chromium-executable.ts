import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'

export function findChromiumExecutable(): string {
  const configured = process.env.SESAME_BROWSER_TEST_EXECUTABLE
  if (configured) {
    if (existsSync(configured)) return configured
    throw new Error(`SESAME_BROWSER_TEST_EXECUTABLE points at a missing file: ${configured}`)
  }
  const pinned = chromium.executablePath()
  if (pinned && existsSync(pinned)) return pinned
  const candidates = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/opt/helium-browser-bin/chrome',
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  const discovered = spawnSync(
    'sh',
    ['-c', 'command -v chromium chromium-browser'],
    { encoding: 'utf8' },
  )
  const first = discovered.stdout.split('\n').map((line) => line.trim()).find(Boolean)
  if (first) return first
  throw new Error(
    'No Chromium executable found. Install one or set SESAME_BROWSER_TEST_EXECUTABLE.',
  )
}
