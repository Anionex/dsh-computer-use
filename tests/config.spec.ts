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
        pointerInputPolicy: 'targeted',
        cursorVisualization: 'visible',
        cursorMotionMs: 180,
        cursorAutoHideMs: 1400,
      },
      grants: [{ bundleId: 'com.example.Editor', read: true, control: true }],
    })
  })

  it('accepts an explicit foreground and target-process pointer policy', () => {
    expect(resolveConfig({
      interaction: {
        focusPolicy: 'activate',
        pointerInputPolicy: 'targeted',
        cursorVisualization: 'hidden',
        cursorMotionMs: 0,
        cursorAutoHideMs: 30000,
      },
    }).interaction).toEqual({
      focusPolicy: 'activate',
      pointerInputPolicy: 'targeted',
      cursorVisualization: 'hidden',
      cursorMotionMs: 0,
      cursorAutoHideMs: 30000,
    })
  })

  it.each([
    [{ observationTtlMs: 999 }, /observationTtlMs/],
    [{ settleMs: 5001, maxSettleMs: 5000 }, /settleMs/],
    [{ artifactRoot: '../outside' }, /artifactRoot/],
    [{ helper: { path: '   ' } }, /helper\.path/],
    [{ interaction: { focusPolicy: 'invalid' } }, /interaction\.focusPolicy/],
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
