// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fillOneTimeCodeSurface,
  inspectOneTimeCodeSurface,
  normalizeOneTimeCodeFillOutcome,
  normalizeOneTimeCodeInspection,
  oneTimeCodeKindForField,
} from '../../src/content/one-time-code'

const origin = 'https://example.test'
const token = 'one-time-code-token-1234'
const code = '287082'

function layout(element: Element, width = 200, height = 30) {
  element.getBoundingClientRect = () => ({
    width, height, top: 0, left: 0, right: width, bottom: height,
    x: 0, y: 0, toJSON: () => ({}),
  }) as DOMRect
}

function render(html: string): HTMLInputElement[] {
  document.body.innerHTML = html
  const inputs = Array.from(document.querySelectorAll('input'))
  for (const input of inputs) layout(input)
  return inputs
}

beforeEach(() => {
  vi.stubGlobal('location', { protocol: 'https:', origin })
  vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible', opacity: '1' }))
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('inspectOneTimeCodeSurface', () => {
  it('finds a single field marked as a one-time code', () => {
    render('<input type="text" autocomplete="one-time-code">')
    expect(inspectOneTimeCodeSurface()).toEqual({
      ok: true,
      surface: { ok: true, origin },
      kind: 'single',
      fields: 1,
    })
  })

  it('finds a split group of single character boxes', () => {
    render(`<form>${'<input maxlength="1" inputmode="numeric">'.repeat(6)}</form>`)
    expect(inspectOneTimeCodeSurface()).toEqual({
      ok: true,
      surface: { ok: true, origin },
      kind: 'split',
      fields: 6,
    })
  })

  it('reads a mislabeled field through its hint and a numeric type', () => {
    render('<label for="vc">Verification code</label><input id="vc" type="tel">')
    expect(inspectOneTimeCodeSurface()).toMatchObject({ ok: true, kind: 'single', fields: 1 })
  })

  it('reads an aria-label and a placeholder hint', () => {
    expect(inspectOneTimeCodeSurface()).toEqual({ ok: false, code: 'no-fields' })
    render('<input type="text" aria-label="One time password">')
    expect(inspectOneTimeCodeSurface()).toMatchObject({ ok: true, kind: 'single' })
    render('<input type="text" placeholder="Enter the 2FA code">')
    expect(inspectOneTimeCodeSurface()).toMatchObject({ ok: true, kind: 'single' })
  })

  it('refuses two separate candidate fields', () => {
    render('<input type="text" autocomplete="one-time-code"><input type="text" name="otp">')
    expect(inspectOneTimeCodeSurface()).toEqual({ ok: false, code: 'multiple-matches' })
  })

  it('refuses a single field beside a split group', () => {
    render(`<input type="text" autocomplete="one-time-code"><form>${'<input maxlength="1">'.repeat(6)}</form>`)
    expect(inspectOneTimeCodeSurface()).toEqual({ ok: false, code: 'multiple-matches' })
  })

  it('refuses a split group with too few or too many boxes', () => {
    render(`<form>${'<input maxlength="1">'.repeat(2)}</form>`)
    expect(inspectOneTimeCodeSurface()).toEqual({ ok: false, code: 'no-fields' })
    render(`<form>${'<input maxlength="1">'.repeat(9)}</form>`)
    expect(inspectOneTimeCodeSurface()).toEqual({ ok: false, code: 'no-fields' })
  })

  it('leaves a card security code to the card surface', () => {
    render('<input type="text" name="securityCode" autocomplete="cc-csc">')
    expect(inspectOneTimeCodeSurface()).toEqual({ ok: false, code: 'no-fields' })
  })

  it('does not claim a hint without a numeric-ish type', () => {
    render('<input type="checkbox" name="verification-code">')
    expect(inspectOneTimeCodeSurface()).toEqual({ ok: false, code: 'no-fields' })
  })

  it('binds the kind to the fields it found', () => {
    const inputs = render(`<form>${'<input maxlength="1">'.repeat(6)}</form>`)
    expect(oneTimeCodeKindForField(inputs[2])).toBe('split')
    expect(oneTimeCodeKindForField(document.createElement('input'))).toBeNull()
  })
})

describe('fillOneTimeCodeSurface', () => {
  it('writes the code into a single field after a matching prepare', () => {
    const [input] = render('<input type="text" autocomplete="one-time-code">')
    expect(fillOneTimeCodeSurface(origin, token, null, 'prepare'))
      .toEqual({ ok: true, kind: 'single', filledFields: 1 })
    expect(fillOneTimeCodeSurface(origin, token, code, 'fill'))
      .toEqual({ ok: true, kind: 'single', filledFields: 1 })
    expect(input.value).toBe(code)
  })

  it('writes one digit per split box', () => {
    const inputs = render(`<form>${'<input maxlength="1">'.repeat(6)}</form>`)
    expect(fillOneTimeCodeSurface(origin, token, null, 'prepare'))
      .toEqual({ ok: true, kind: 'split', filledFields: 6 })
    expect(fillOneTimeCodeSurface(origin, token, code, 'fill'))
      .toEqual({ ok: true, kind: 'split', filledFields: 6 })
    expect(inputs.map((input) => input.value).join('')).toBe(code)
  })

  it('refuses a split code whose digit count does not match the boxes', () => {
    const inputs = render(`<form>${'<input maxlength="1">'.repeat(6)}</form>`)
    fillOneTimeCodeSurface(origin, token, null, 'prepare')
    expect(fillOneTimeCodeSurface(origin, token, '2870821', 'fill'))
      .toEqual({ ok: false, code: 'field-write-failed' })
    expect(inputs.every((input) => input.value === '')).toBe(true)
  })

  it('refuses a fill without a prepare', () => {
    render('<input type="text" autocomplete="one-time-code">')
    expect(fillOneTimeCodeSurface(origin, token, code, 'fill'))
      .toEqual({ ok: false, code: 'stale-document' })
  })

  it('refuses a document token that no document issued', () => {
    render('<input type="text" autocomplete="one-time-code">')
    expect(fillOneTimeCodeSurface(origin, 'short', null, 'prepare'))
      .toEqual({ ok: false, code: 'stale-document' })
  })

  it('refuses another origin before it looks at the surface', () => {
    render('<input type="text" autocomplete="one-time-code">')
    expect(fillOneTimeCodeSurface('https://other.test', token, null, 'prepare'))
      .toEqual({ ok: false, code: 'origin-mismatch' })
  })

  it('refuses a surface that no longer matches the prepared kind', () => {
    render(`<form>${'<input maxlength="1">'.repeat(6)}</form>`)
    fillOneTimeCodeSurface(origin, token, null, 'prepare')
    render('<input type="text" autocomplete="one-time-code">')
    expect(fillOneTimeCodeSurface(origin, token, code, 'fill'))
      .toEqual({ ok: false, code: 'stale-document' })
  })

  it('refuses a code that is not one to nine digits', () => {
    const [input] = render('<input type="text" autocomplete="one-time-code">')
    for (const candidate of ['28a082', '1234567890', '']) {
      fillOneTimeCodeSurface(origin, token, null, 'prepare')
      expect(fillOneTimeCodeSurface(origin, token, candidate, 'fill'))
        .toEqual({ ok: false, code: 'fill-failed' })
    }
    expect(input.value).toBe('')
  })

  it('clears the binding so a replay cannot write twice', () => {
    render('<input type="text" autocomplete="one-time-code">')
    fillOneTimeCodeSurface(origin, token, null, 'prepare')
    expect(fillOneTimeCodeSurface(origin, token, code, 'clear'))
      .toEqual({ ok: true, kind: 'single', filledFields: 0 })
    expect(fillOneTimeCodeSurface(origin, token, code, 'fill'))
      .toEqual({ ok: false, code: 'stale-document' })
  })

  it('dispatches input and change but never a submit or click', () => {
    const [input] = render('<input type="text" autocomplete="one-time-code">')
    const pageEvents: string[] = []
    document.addEventListener('submit', () => pageEvents.push('submit'), true)
    document.addEventListener('click', () => pageEvents.push('click'), true)
    input.addEventListener('input', () => pageEvents.push('input'))
    input.addEventListener('change', () => pageEvents.push('change'))
    fillOneTimeCodeSurface(origin, token, null, 'prepare')
    fillOneTimeCodeSurface(origin, token, code, 'fill')
    expect(pageEvents).toEqual(['input', 'change'])
  })

  it('never puts the code into the outcome or an error', () => {
    render('<input type="text" autocomplete="one-time-code">')
    fillOneTimeCodeSurface(origin, token, null, 'prepare')
    const filled = fillOneTimeCodeSurface(origin, token, code, 'fill')
    expect(JSON.stringify(filled)).not.toContain(code)
    fillOneTimeCodeSurface(origin, token, null, 'prepare')
    const failed = fillOneTimeCodeSurface(origin, token, '28a082', 'fill')
    expect(JSON.stringify(failed)).not.toContain('28a082')
  })
})

describe('one-time code normalization', () => {
  it('refuses a split kind that claims one field', () => {
    expect(normalizeOneTimeCodeInspection({ ok: true, surface: { ok: true, origin }, kind: 'split', fields: 1 }))
      .toEqual({ ok: false, code: 'invalid-inspection' })
  })

  it('refuses an origin that is not a normalized web origin', () => {
    expect(normalizeOneTimeCodeInspection({
      ok: true,
      surface: { ok: true, origin: `${origin}/code` },
      kind: 'single',
      fields: 1,
    })).toEqual({ ok: false, code: 'invalid-inspection' })
  })

  it('passes the two safe inspection failures through', () => {
    expect(normalizeOneTimeCodeInspection({ ok: false, code: 'no-fields' }))
      .toEqual({ ok: false, code: 'no-fields' })
    expect(normalizeOneTimeCodeInspection({ ok: false, code: 'multiple-matches' }))
      .toEqual({ ok: false, code: 'multiple-matches' })
    expect(normalizeOneTimeCodeInspection({ ok: false, code: 'unexpected' }))
      .toEqual({ ok: false, code: 'invalid-inspection' })
  })

  it('keeps the fill outcome closed', () => {
    expect(normalizeOneTimeCodeFillOutcome({ ok: true, kind: 'single', filledFields: 1 }))
      .toEqual({ ok: true, kind: 'single', filledFields: 1 })
    expect(normalizeOneTimeCodeFillOutcome({ ok: true, kind: 'single', filledFields: 6 }))
      .toEqual({ ok: false, code: 'invalid-outcome' })
    expect(normalizeOneTimeCodeFillOutcome({ ok: false, code: 'stale-document' }))
      .toEqual({ ok: false, code: 'stale-document' })
    expect(normalizeOneTimeCodeFillOutcome({ ok: false, code: 'surprise' }))
      .toEqual({ ok: false, code: 'invalid-outcome' })
  })
})
