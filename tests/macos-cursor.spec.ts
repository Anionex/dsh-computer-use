import { describe, expect, it, vi } from 'vitest'
import type { BackendCursorAction } from '../src/backend.ts'
import { resolveConfig } from '../src/config.ts'
import { MacOSBackend } from '../src/providers/macos.ts'

const target = {
  targetPid: 7331,
  targetWindowNumber: 42,
  targetWindowFrame: { x: 100, y: 200, width: 640, height: 480 },
}

describe('macOS cursor visualization', () => {
  for (const [kind, operation] of [
    ['click', 'validate'],
    ['scroll', 'validate'],
    ['drag', 'release'],
  ] as const) {
    it(`validates the overlay target during the ${kind} after phase`, async () => {
      const backend = new MacOSBackend({} as never, resolveConfig({
        interaction: { cursorVisualization: 'visible', cursorAutoHideMs: 250 },
      }))
      const cursorCommand = vi.spyOn(backend.client, 'cursorCommand').mockResolvedValue({
        visible: false,
        reason: 'the target moved after input',
      })
      const action: BackendCursorAction = {
        kind,
        to: { x: 320, y: 360 },
        ...target,
      }
      const signal = new AbortController().signal

      await expect(backend.visualizeCursor(action, 'after', signal)).resolves.toEqual({
        visible: false,
        reason: 'the target moved after input',
      })
      expect(cursorCommand).toHaveBeenCalledOnce()
      expect(cursorCommand).toHaveBeenCalledWith({
        op: operation,
        autoHideMs: 250,
        ...target,
      }, signal)
    })
  }
})
