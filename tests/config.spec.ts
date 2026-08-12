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
      interaction: {
        focusPolicy: 'preserve',
        keyboardPolicy: 'preserve',
        pointerInputPolicy: 'targeted',
        cursorVisualization: 'visible',
        cursorMotionMs: 180,
        cursorAutoHideMs: 1400,
      },
      grants: [{ bundleId: 'com.example.Editor', read: true, control: true }],
      allowAllApps: false,
    })
  })

  it('resolves allowAllApps independently of per-app grants', () => {
    expect(resolveConfig({ allowAllApps: true })).toMatchObject({ allowAllApps: true })
  })

  it('accepts an explicit foreground, keyboard, and target-process pointer policy', () => {
    expect(resolveConfig({
      interaction: {
        focusPolicy: 'activate',
        keyboardPolicy: 'activate',
        pointerInputPolicy: 'targeted',
        cursorVisualization: 'hidden',
        cursorMotionMs: 0,
        cursorAutoHideMs: 30000,
      },
    }).interaction).toEqual({
      focusPolicy: 'activate',
      keyboardPolicy: 'activate',
      pointerInputPolicy: 'targeted',
      cursorVisualization: 'hidden',
      cursorMotionMs: 0,
      cursorAutoHideMs: 30000,
    })
  })

  it('accepts an observation TTL of zero to disable expiry and raises the upper bound', () => {
    expect(resolveConfig({ observationTtlMs: 0 }).observationTtlMs).toBe(0)
    expect(resolveConfig({ observationTtlMs: 86400000 }).observationTtlMs).toBe(86400000)
  })

  it.each([
    [{ observationTtlMs: 999 }, /observationTtlMs/],
    [{ observationTtlMs: 86400001 }, /observationTtlMs/],
    [{ settleMs: 5001, maxSettleMs: 5000 }, /settleMs/],
    [{ artifactRoot: '../outside' }, /artifactRoot/],
    [{ helper: { path: '   ' } }, /helper\.path/],
    [{ interaction: { focusPolicy: 'invalid' } }, /interaction\.focusPolicy/],
    [{ interaction: { keyboardPolicy: 'invalid' } }, /interaction\.keyboardPolicy/],
    [{ interaction: { pointerInputPolicy: 'invalid' } }, /interaction\.pointerInputPolicy/],
    [{ interaction: { cursorVisualization: 'invalid' } }, /interaction\.cursorVisualization/],
    [{ interaction: { cursorMotionMs: 2001 } }, /interaction\.cursorMotionMs/],
    [{ interaction: { cursorAutoHideMs: 30001 } }, /interaction\.cursorAutoHideMs/],
    [{ grants: [{ bundleId: '*' }] }, /non-wildcard/],
    [{ grants: [{ bundleId: 'com.example.App' }, { bundleId: 'com.example.App' }] }, /duplicate/],
  ] as const)('rejects invalid configuration %o', (value, pattern) => {
    expect(() => resolveConfig(value)).toThrow(pattern)
  })
})
