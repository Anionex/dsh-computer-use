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
  it('waits for arrival and dwell without arming auto-hide before click input', async () => {
    vi.useFakeTimers()
    try {
      const backend = new MacOSBackend({} as never, resolveConfig({
        interaction: {
          cursorVisualization: 'visible',
          cursorSpeedPxPerSecond: 12000,
          cursorAccelerationPxPerSecondSquared: 120000,
          cursorClickDelayMs: 90,
          cursorAutoHideMs: 50,
        },
      }))
      const arrival = Promise.withResolvers<{ visible: boolean }>()
      const cursorCommand = vi.spyOn(backend.client, 'cursorCommand').mockImplementation(async (command) => {
        if (command.op === 'move') return await arrival.promise
        return { visible: true }
      })
      const action: BackendCursorAction = { kind: 'click', to: { x: 320, y: 360 }, ...target }
      const signal = new AbortController().signal

      const visualization = backend.visualizeCursor(action, 'before', signal)
      await vi.advanceTimersByTimeAsync(0)
      expect(cursorCommand).toHaveBeenCalledOnce()
      expect(cursorCommand).toHaveBeenNthCalledWith(1, {
        op: 'move',
        x: 320,
        y: 360,
        speedPxPerSecond: 12000,
        accelerationPxPerSecondSquared: 120000,
        autoHideMs: 0,
        ...target,
      }, signal)

      arrival.resolve({ visible: true })
      await vi.advanceTimersByTimeAsync(89)
      expect(cursorCommand).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(1)
      await expect(visualization).resolves.toEqual({ visible: true })
      expect(cursorCommand).toHaveBeenNthCalledWith(2, {
        op: 'press',
        autoHideMs: 0,
        ...target,
        sustainedPress: false,
      }, signal)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not press when the action is cancelled during post-arrival dwell', async () => {
    vi.useFakeTimers()
    try {
      const backend = new MacOSBackend({} as never, resolveConfig({
        interaction: { cursorVisualization: 'visible', cursorClickDelayMs: 500 },
      }))
      const cursorCommand = vi.spyOn(backend.client, 'cursorCommand').mockResolvedValue({ visible: true })
      const controller = new AbortController()
      const action: BackendCursorAction = { kind: 'click', to: { x: 320, y: 360 }, ...target }

      const visualization = backend.visualizeCursor(action, 'before', controller.signal)
      await vi.advanceTimersByTimeAsync(0)
      expect(cursorCommand).toHaveBeenCalledOnce()
      controller.abort()
      await expect(visualization).rejects.toMatchObject({ name: 'AbortError' })
      expect(cursorCommand).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not add click dwell or press feedback when a background target hides the cursor', async () => {
    const backend = new MacOSBackend({} as never, resolveConfig({
      interaction: { cursorVisualization: 'visible', cursorClickDelayMs: 1000 },
    }))
    const cursorCommand = vi.spyOn(backend.client, 'cursorCommand').mockResolvedValue({
      visible: false,
      reason: 'the target application is not frontmost',
      reasonCode: 'target-not-frontmost',
    })
    const action: BackendCursorAction = { kind: 'click', to: { x: 320, y: 360 }, ...target }

    await expect(backend.visualizeCursor(action, 'before', new AbortController().signal)).resolves.toEqual({
      visible: false,
      reason: 'the target application is not frontmost',
      reasonCode: 'target-not-frontmost',
    })
    expect(cursorCommand).toHaveBeenCalledOnce()
    expect(cursorCommand.mock.calls[0]?.[0]).toMatchObject({ op: 'move' })
  })

  it('completes both drag moves around sustained press feedback before returning', async () => {
    const backend = new MacOSBackend({} as never, resolveConfig({
      interaction: { cursorVisualization: 'visible', cursorClickDelayMs: 0 },
    }))
    const startArrival = Promise.withResolvers<{ visible: boolean }>()
    const endArrival = Promise.withResolvers<{ visible: boolean }>()
    let moveCount = 0
    const cursorCommand = vi.spyOn(backend.client, 'cursorCommand').mockImplementation(async (command) => {
      if (command.op !== 'move') return { visible: true }
      moveCount += 1
      return await (moveCount === 1 ? startArrival.promise : endArrival.promise)
    })
    const action: BackendCursorAction = {
      kind: 'drag',
      from: { x: 200, y: 240 },
      to: { x: 500, y: 540 },
      ...target,
    }
    let settled = false
    const visualization = backend.visualizeCursor(action, 'before', new AbortController().signal)
    void visualization.then(() => { settled = true })

    await vi.waitFor(() => { expect(cursorCommand).toHaveBeenCalledTimes(1) })
    expect(cursorCommand.mock.calls[0]?.[0]).toMatchObject({ op: 'move', x: 200, y: 240, autoHideMs: 0 })
    startArrival.resolve({ visible: true })
    await vi.waitFor(() => { expect(cursorCommand).toHaveBeenCalledTimes(3) })
    expect(cursorCommand.mock.calls[1]?.[0]).toMatchObject({ op: 'press', sustainedPress: true, autoHideMs: 0 })
    expect(cursorCommand.mock.calls[2]?.[0]).toMatchObject({ op: 'move', x: 500, y: 540, autoHideMs: 0 })
    expect(settled).toBe(false)

    endArrival.resolve({ visible: true })
    await expect(visualization).resolves.toEqual({ visible: true })
  })

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
