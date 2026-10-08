import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'

describe('Computer Use configuration', () => {
  it('resolves bounded defaults and promotes control grants to read access', () => {
    const config = resolveConfig({
      grants: [{ bundleId: 'com.example.Editor', control: true }],
    })
    expect(config).toMatchObject({
      observationTtlMs: 0,
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
        cursorSpeedPxPerSecond: 1600,
        cursorAccelerationPxPerSecondSquared: 6000,
        cursorClickDelayMs: 90,
        cursorAutoHideMs: 0,
      },
      grants: [{ bundleId: 'com.example.Editor', read: true, control: true }],
      allowAllApps: false,
    })
  })

  it.each([{}, { helper: {} }, { helper: { path: '' } }, { helper: { path: ' \t\n ' } }])(
    'uses the managed helper for an omitted or blank path: %o', (value) => {
      const config = resolveConfig(value)
      expect(config.helper).toEqual({ allowSourceBuild: false })
      expect(config.allowAllApps).toBe(false)
      expect(config.grants).toEqual([])
    },
  )

  it('preserves a trimmed custom helper path and explicit source-build policy', () => {
    expect(resolveConfig({ helper: { path: '  /custom/helper  ', allowSourceBuild: true } }).helper)
      .toEqual({ path: '/custom/helper', allowSourceBuild: true })
    expect(resolveConfig({ helper: { path: '', allowSourceBuild: true } }).helper)
      .toEqual({ allowSourceBuild: true })
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
        cursorSpeedPxPerSecond: 50000,
        cursorAccelerationPxPerSecondSquared: 500000,
        cursorClickDelayMs: 0,
        cursorAutoHideMs: 30000,
      },
    }).interaction).toEqual({
      focusPolicy: 'activate',
      keyboardPolicy: 'activate',
      pointerInputPolicy: 'targeted',
      cursorVisualization: 'hidden',
      cursorSpeedPxPerSecond: 50000,
      cursorAccelerationPxPerSecondSquared: 500000,
      cursorClickDelayMs: 0,
      cursorAutoHideMs: 30000,
    })
  })

  it('loads a 0.2.x interaction document containing only the deprecated motion duration', () => {
    expect(resolveConfig({ interaction: { cursorMotionMs: 750 } }).interaction).toEqual({
      focusPolicy: 'preserve',
      keyboardPolicy: 'preserve',
      pointerInputPolicy: 'targeted',
      cursorVisualization: 'visible',
      cursorSpeedPxPerSecond: 1600,
      cursorAccelerationPxPerSecondSquared: 6000,
      cursorClickDelayMs: 90,
      cursorAutoHideMs: 0,
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
    [{ interaction: { focusPolicy: 'invalid' } }, /interaction\.focusPolicy/],
    [{ interaction: { keyboardPolicy: 'invalid' } }, /interaction\.keyboardPolicy/],
    [{ interaction: { pointerInputPolicy: 'invalid' } }, /interaction\.pointerInputPolicy/],
    [{ interaction: { cursorVisualization: 'invalid' } }, /interaction\.cursorVisualization/],
    [{ interaction: { cursorMotionMs: 2001 } }, /interaction\.cursorMotionMs/],
    [{ interaction: { cursorSpeedPxPerSecond: 99 } }, /interaction\.cursorSpeedPxPerSecond/],
    [{ interaction: { cursorSpeedPxPerSecond: 50001 } }, /interaction\.cursorSpeedPxPerSecond/],
    [{ interaction: { cursorAccelerationPxPerSecondSquared: 99 } }, /interaction\.cursorAccelerationPxPerSecondSquared/],
    [{ interaction: { cursorAccelerationPxPerSecondSquared: 500001 } }, /interaction\.cursorAccelerationPxPerSecondSquared/],
    [{ interaction: { cursorClickDelayMs: 1001 } }, /interaction\.cursorClickDelayMs/],
    [{ interaction: { cursorAutoHideMs: 30001 } }, /interaction\.cursorAutoHideMs/],
    [{ grants: [{ bundleId: '*' }] }, /non-wildcard/],
    [{ grants: [{ bundleId: 'com.example.App' }, { bundleId: 'com.example.App' }] }, /duplicate/],
  ] as const)('rejects invalid configuration %o', (value, pattern) => {
    expect(() => resolveConfig(value)).toThrow(pattern)
  })
})
