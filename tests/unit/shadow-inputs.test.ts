// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cardFieldsForInput } from '../../src/content/card-fields'
import { fillCardSurface } from '../../src/content/card-writer'
import { inspectLoginSurface, isUsernameField } from '../../src/content/field-detector'
import { fillLoginSurface } from '../../src/content/field-writer'
import { inspectIdentitySurface } from '../../src/content/identity-detector'
import { fillIdentitySurface } from '../../src/content/identity-writer'
import { DEFAULT_MAX_SCAN_DEPTH, collectInputs } from '../../src/content/input-scan'
import { inspectPasswordSurface, visiblePasswordFields } from '../../src/content/registration'

const origin = 'https://example.test'
const token = 'shadow-fill-token-0123456789'

function layout(input: HTMLInputElement, width = 200, height = 30): void {
  input.getBoundingClientRect = () => ({
    width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}),
  }) as DOMRect
}

function openShadowRoot(parent: ParentNode): ShadowRoot {
  const host = document.createElement('div')
  parent.append(host)
  return host.attachShadow({ mode: 'open' })
}

function addLoginForm(root: ShadowRoot): { username: HTMLInputElement; password: HTMLInputElement } {
  const form = document.createElement('form')
  const username = document.createElement('input')
  username.type = 'email'
  username.autocomplete = 'username'
  const password = document.createElement('input')
  password.type = 'password'
  password.autocomplete = 'current-password'
  form.append(username, password)
  root.append(form)
  layout(username)
  layout(password)
  return { username, password }
}

beforeEach(() => {
  vi.stubGlobal('location', { protocol: 'https:', origin })
  vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible', opacity: '1' }))
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('input traversal through open shadow roots', () => {
  it('finds and fills a login form inside nested open shadow roots', () => {
    const third = openShadowRoot(openShadowRoot(openShadowRoot(document.body)))
    const { username, password } = addLoginForm(third)

    const scan = collectInputs(document)
    expect(scan.truncated).toBe(false)
    expect(scan.inputs).toEqual([username, password])
    expect(scan.shadowRoots).toHaveLength(3)
    expect(inspectLoginSurface()).toMatchObject({ ok: true, hasUsernameField: true, hasPasswordField: true })

    expect(fillLoginSurface(origin, token, null, 'prepare')).toEqual({
      ok: true, usernameFilled: true, passwordFilled: true,
    })
    const credential = { username: 'jamie@example.test', password: 'fictional-pass-1' }
    expect(fillLoginSurface(origin, token, credential)).toEqual({
      ok: true, usernameFilled: true, passwordFilled: true,
    })
    expect(username.value).toBe('jamie@example.test')
    expect(password.value).toBe('fictional-pass-1')
    expect(credential).toEqual({ username: '', password: '' })
  })

  it('reads a label bound by for inside the input own shadow root', () => {
    const root = openShadowRoot(document.body)
    const label = document.createElement('label')
    label.setAttribute('for', 'field-1')
    label.textContent = 'Username'
    const input = document.createElement('input')
    input.id = 'field-1'
    input.type = 'text'
    root.append(label, input)
    layout(input)

    expect(document.querySelectorAll('label[for="field-1"]')).toHaveLength(0)
    expect(isUsernameField(input)).toBe(true)
  })

  it('never sees an input inside a closed shadow root', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = host.attachShadow({ mode: 'closed' })
    const password = document.createElement('input')
    password.type = 'password'
    root.append(password)
    layout(password)

    expect(collectInputs(document).inputs).toEqual([])
    expect(inspectLoginSurface()).toEqual({ ok: false, code: 'no-fields' })
    expect(fillLoginSurface(origin, token, null, 'prepare')).toEqual({ ok: false, code: 'no-fields' })
  })

  it('rejects a honeypot behind an aria-hidden shadow host', () => {
    const hidden = document.createElement('div')
    hidden.setAttribute('aria-hidden', 'true')
    const wrapper = document.createElement('div')
    hidden.append(wrapper)
    document.body.append(hidden)
    const root = openShadowRoot(wrapper)
    const password = document.createElement('input')
    password.type = 'password'
    root.append(password)
    layout(password)

    expect(collectInputs(document).inputs).toEqual([password])
    expect(inspectLoginSurface()).toEqual({ ok: false, code: 'no-fields' })
  })

  it('fails closed when a shadow tree is deeper than the traversal bound', () => {
    const first = openShadowRoot(document.body)
    const { username, password } = addLoginForm(first)
    let deepest = first
    for (let depth = 0; depth < DEFAULT_MAX_SCAN_DEPTH; depth += 1) deepest = openShadowRoot(deepest)
    const buried = document.createElement('input')
    buried.type = 'password'
    deepest.append(buried)
    layout(buried)

    expect(collectInputs(document).truncated).toBe(true)
    expect(inspectLoginSurface()).toEqual({ ok: false, code: 'no-fields' })
    expect(fillLoginSurface(origin, token, null, 'prepare')).toEqual({ ok: false, code: 'no-fields' })
    expect(username.value).toBe('')
    expect(password.value).toBe('')
  })

  it('stops at the node budget and reports the scan as truncated', () => {
    document.body.innerHTML = '<input type="text"><input type="text"><input type="text">'
    const scan = collectInputs(document.body, { maxNodes: 2 })

    expect(scan.truncated).toBe(true)
    expect(scan.inputs.map((input) => input.value)).toEqual(['', ''])
  })

  it('scans identity fields inside open shadow roots', () => {
    const root = openShadowRoot(document.body)
    const email = document.createElement('input')
    email.type = 'email'
    email.autocomplete = 'email'
    root.append(email)
    layout(email)

    expect(inspectIdentitySurface()).toEqual({ ok: true, surface: { ok: true, origin }, fields: ['email'] })
  })

  it('reads a checkout hint inside an open shadow root', () => {
    const root = openShadowRoot(document.body)
    const form = document.createElement('form')
    const fullName = document.createElement('input')
    fullName.name = 'full_name'
    const email = document.createElement('input')
    email.id = 'checkout_email'
    form.append(fullName, email)
    root.append(form)
    layout(fullName)
    layout(email)

    expect(inspectIdentitySurface()).toEqual({
      ok: true,
      surface: { ok: true, origin },
      fields: ['fullName', 'email'],
    })
    expect(fillIdentitySurface(origin, token, null, 'prepare')).toEqual({
      ok: true,
      filledFields: ['fullName', 'email'],
    })
  })

  it('scans card fields inside open shadow roots', () => {
    const root = openShadowRoot(document.body)
    const number = document.createElement('input')
    number.autocomplete = 'cc-number'
    root.append(number)
    layout(number)

    expect(cardFieldsForInput(number)).toEqual(['number'])
    expect(fillCardSurface(origin, token, null, 'prepare')).toEqual({ ok: true, filledFields: ['number'] })
  })

  it('scans registration password fields inside open shadow roots', () => {
    const root = openShadowRoot(document.body)
    const password = document.createElement('input')
    password.type = 'password'
    password.autocomplete = 'new-password'
    root.append(password)
    layout(password)

    expect(visiblePasswordFields()).toEqual([password])
    expect(inspectPasswordSurface()).toBe('registration')
  })
})

