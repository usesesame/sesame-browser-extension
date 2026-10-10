import { describe, expect, it } from 'vitest'
import { safeDiagnosticText } from '../../src/protocol/diagnostics'

describe('safeDiagnosticText', () => {
  const diagnostic = { code: 'host-not-found', checkedAt: '2026-10-04T18:00:00.000Z', protocolVersion: '5' }

  it('lists each field on its own line and states that no secrets or values are included', () => {
    const lines = safeDiagnosticText(diagnostic).split('\n')
    expect(lines).toContain('code=host-not-found')
    expect(lines).toContain('fieldValuesRead=false')
    expect(lines).toContain('secretsIncluded=false')
    expect(lines).toContain('pageAccess=active-tab-only')
  })

  it('adds the page fields only when the caller supplies them', () => {
    expect(safeDiagnosticText(diagnostic)).not.toContain('pageResult')
    expect(safeDiagnosticText(diagnostic, { pageResult: 'ok' })).toContain('pageResult=ok')
  })

  it('does not let a caller turn off the safety statements', () => {
    const text = safeDiagnosticText(diagnostic, { secretsIncluded: true })
    expect(text).toContain('secretsIncluded=false')
    expect(text).not.toContain('secretsIncluded=true')
  })
})
