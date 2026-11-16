import { describe, expect, it } from 'vitest'
import { pauseChangedOrigins } from '../../src/permissions/inline-access'

function settings(pausedOrigins: unknown, cardSuggestionsEnabled = true) {
  return { version: 2, pausedOrigins, onboardingDismissed: false, cardSuggestionsEnabled }
}

describe('origins whose inline pause state changed', () => {
  it('names only the origin that was paused or resumed', () => {
    expect(pauseChangedOrigins(
      settings(['https://a.example.test']),
      settings(['https://a.example.test', 'https://b.example.test']),
    )).toEqual(['https://b.example.test'])
    expect(pauseChangedOrigins(
      settings(['https://a.example.test', 'https://b.example.test']),
      settings(['https://b.example.test']),
    )).toEqual(['https://a.example.test'])
  })

  it('names no origin when another setting changed', () => {
    expect(pauseChangedOrigins(
      settings(['https://a.example.test'], true),
      settings(['https://a.example.test'], false),
    )).toEqual([])
  })

  it('treats a first write or a cleared setting as a change for every paused origin', () => {
    expect(pauseChangedOrigins(undefined, settings(['https://b.example.test', 'https://a.example.test'])))
      .toEqual(['https://a.example.test', 'https://b.example.test'])
    expect(pauseChangedOrigins(settings(['https://a.example.test']), undefined)).toEqual(['https://a.example.test'])
  })

  it('ignores malformed stored origins on either side', () => {
    expect(pauseChangedOrigins(
      settings(['https://a.example.test/path', 7, 'javascript:alert(1)']),
      settings('https://a.example.test'),
    )).toEqual([])
  })
})
