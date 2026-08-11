import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'

describe('Computer Use configuration', () => {
  it('resolves bounded defaults and promotes control grants to read access', () => {
    const config = resolveConfig({
      grants: [{ bundleId: 'com.example.Editor', control: true }],
    })
    expect(config).toMatchObject({
      observationTtlMs: 15000,
      confirmationTtlMs: 300000,
      actionTimeoutMs: 15000,
      settleMs: 250,
      maxSettleMs: 5000,
      artifactRoot: '.dsh-computer-use/artifacts',
      helper: { allowSourceBuild: false },
      grants: [{ bundleId: 'com.example.Editor', read: true, control: true }],
    })
  })

  it.each([
    [{ observationTtlMs: 999 }, /observationTtlMs/],
    [{ settleMs: 5001, maxSettleMs: 5000 }, /settleMs/],
    [{ artifactRoot: '../outside' }, /artifactRoot/],
    [{ helper: { path: '   ' } }, /helper\.path/],
    [{ grants: [{ bundleId: '*' }] }, /non-wildcard/],
    [{ grants: [{ bundleId: 'com.example.App' }, { bundleId: 'com.example.App' }] }, /duplicate/],
  ] as const)('rejects invalid configuration %o', (value, pattern) => {
    expect(() => resolveConfig(value)).toThrow(pattern)
  })
})
