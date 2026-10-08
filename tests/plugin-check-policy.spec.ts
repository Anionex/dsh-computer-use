import { describe, expect, it } from 'vitest'
import { assertPluginCheckReport } from '../scripts/plugin-check-policy.mjs'

const packageName = '@anionex/dsh-computer-use'
const nameWarning = { code: 'non-org-recommended-name', detail: 'Existing personal npm namespace.' }
const hubWarning = { code: 'not-in-hub', detail: 'Repository is absent from the public catalog.' }

function report(warnings: unknown[] = [], errors: unknown[] = []) {
  return { verdict: errors.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass', warnings, errors }
}

describe('plugin checker aggregate policy', () => {
  it('accepts a clean report without adding advisory details', () => {
    expect(assertPluginCheckReport(report(), packageName)).toEqual([])
  })

  it('preserves the existing empty-list defaults', () => {
    expect(assertPluginCheckReport({ verdict: 'pass' }, packageName)).toEqual([])
  })

  it.each([nameWarning, hubWarning])('accepts only the approved $code advisory for the exact package', warning => {
    expect(assertPluginCheckReport(report([warning]), packageName)).toEqual([warning])
  })

  it('accepts both approved advisories and retains their complete JSON details', () => {
    const warnings = [
      { ...nameWarning, source: { file: 'package.json', field: 'name' } },
      { ...hubWarning, repository: 'Anionex/dsh-computer-use' },
    ]
    const checked = report(warnings)
    const original = JSON.stringify(checked)
    const allowedWarnings = assertPluginCheckReport(checked, packageName)
    expect(JSON.parse(JSON.stringify({ allowedWarnings }))).toEqual({ allowedWarnings: warnings })
    expect(JSON.stringify(checked)).toBe(original)
    expect(allowedWarnings).not.toBe(warnings)
  })

  it.each(['missing-peer', 'security-warning', 'unknown-future-warning', '', 'NOT-IN-HUB', 'not-in-hub-extra'])('rejects the unapproved warning code %j', code => {
    expect(() => assertPluginCheckReport(report([{ code }]), packageName)).toThrow('dsh-plugin-check did not pass cleanly')
  })

  it.each([
    '@other/dsh-computer-use',
    '@anionex/dsh-computer-use-next',
    '@Anionex/dsh-computer-use',
    ' @anionex/dsh-computer-use ',
    undefined,
    null,
  ])('does not extend the approved advisories to package %j', otherPackage => {
    expect(() => assertPluginCheckReport(report([nameWarning, hubWarning]), otherPackage)).toThrow()
  })

  it.each([false, true])('rejects mixed approved and unapproved warnings (allowHubWarning=%s)', allowHubWarning => {
    expect(() => assertPluginCheckReport(report([
      nameWarning,
      hubWarning,
      { code: 'security-warning', detail: 'This must remain blocking.' },
    ]), packageName, { allowHubWarning })).toThrow('This must remain blocking.')
  })

  it('preserves the explicit hub-only option for another package', () => {
    expect(assertPluginCheckReport(report([hubWarning]), '@other/plugin', { allowHubWarning: true })).toEqual([hubWarning])
  })

  it('keeps another package hub warning blocking without the explicit option', () => {
    expect(() => assertPluginCheckReport(report([hubWarning]), '@other/plugin')).toThrow()
  })

  it('does not extend the explicit hub option to another package namespace warning', () => {
    expect(() => assertPluginCheckReport(report([nameWarning]), '@other/plugin', { allowHubWarning: true })).toThrow()
  })

  it('does not accept another package mixed warnings through the explicit hub option', () => {
    expect(() => assertPluginCheckReport(report([hubWarning, nameWarning]), '@other/plugin', { allowHubWarning: true })).toThrow()
  })

  it('requires a boolean true for the explicit hub option', () => {
    expect(() => assertPluginCheckReport(report([hubWarning]), '@other/plugin', { allowHubWarning: 'true' })).toThrow()
  })

  it.each(['invalid-name-format', 'security-error', 'non-org-recommended-name', 'not-in-hub'])('keeps aggregate errors blocking even when their code is %s', code => {
    expect(() => assertPluginCheckReport(report([nameWarning, hubWarning], [
      { code, detail: 'A checker error must never be waived.' },
    ]), packageName, { allowHubWarning: true })).toThrow('A checker error must never be waived.')
  })

  it('never accepts a failing verdict even with absent error details', () => {
    expect(() => assertPluginCheckReport({ verdict: 'fail', errors: [], warnings: [nameWarning] }, packageName)).toThrow()
  })

  it('keeps errors blocking when there are no warnings', () => {
    expect(() => assertPluginCheckReport(report([], [{ code: 'missing-main-or-types' }]), packageName)).toThrow()
  })

  it.each([null, 'not-in-hub', ['not-in-hub'], {}, { code: null }, { code: 1 }])('rejects an unrecognized warning shape %j', warning => {
    expect(() => assertPluginCheckReport(report([warning]), packageName, { allowHubWarning: true })).toThrow()
  })

  it.each([
    null,
    [],
    'pass',
    { warnings: 'not-in-hub', errors: [] },
    { warnings: [], errors: 'error' },
    { warnings: {}, errors: [] },
    { warnings: [], errors: {} },
  ])('rejects malformed report structure %j', malformed => {
    expect(() => assertPluginCheckReport(malformed, packageName)).toThrow('dsh-plugin-check did not pass cleanly')
  })
})
