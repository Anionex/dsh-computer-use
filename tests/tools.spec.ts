import { describe, expect, it, vi } from 'vitest'
import { createComputerUseTools } from '../src/tools.ts'
import type { ComputerObservation } from '../src/types.ts'
import { ComputerObservationId } from '../src/types.ts'
import { FIXTURE_APP } from './helpers.ts'

function observation(withScreenshot = false): ComputerObservation {
  return {
    observationId: ComputerObservationId('observation-1'),
    app: FIXTURE_APP,
    createdAt: '2026-08-11T00:00:00.000Z',
    expiresAt: '2026-08-11T00:00:15.000Z',
    frontmost: true,
    window: { title: 'Fixture', frame: { x: 1, y: 2, width: 3, height: 4 } },
    tree: { mode: 'full', text: '[0] AXWindow', truncated: false },
    elements: [],
    ...(withScreenshot ? {
      screenshot: {
        path: '/tmp/screenshot.png',
        filename: 'screenshot.png',
        mimeType: 'image/png',
        kind: 'image',
        description: 'Current app',
        sourceTool: 'computer_observe',
        previewIntent: 'image',
        bytes: 12,
        width: 3,
        height: 4,
      },
    } : {}),
    permissions: { accessibility: 'granted', screenRecording: 'granted' },
  }
}

describe('model-facing Computer Use tools', () => {
  it('exposes only the focused tool vocabulary with structured output and render intent', async () => {
    const current = observation(true)
    const service = {
      listApps: vi.fn(async () => [{ ...FIXTURE_APP, frontmost: true, accessibility: 'granted', screenRecording: 'granted' }]),
      observe: vi.fn(async () => current),
      act: vi.fn(async (action: { kind: string }) => ({
        action: action.kind,
        channel: 'accessibility',
        activation: 'not-requested',
        pointerInput: false,
        pointerRouting: 'none',
        observation: current,
      })),
      confirm: vi.fn(async () => ({
        token: 'confirmation-1',
        observationId: current.observationId,
        app: FIXTURE_APP,
        expiresAt: current.expiresAt,
      })),
    }
    const tools = createComputerUseTools(service as never)
    expect(tools.map(tool => tool.name)).toEqual([
      'computer_list_apps',
      'computer_observe',
      'computer_click',
      'computer_set_value',
      'computer_type_text',
      'computer_press_key',
      'computer_scroll',
      'computer_drag',
      'computer_perform_action',
      'computer_wait',
      'computer_confirm',
    ])
    expect(tools.every(tool => typeof tool.presentCall === 'function')).toBe(true)
    expect(tools[0]!.presentCall?.({})).toMatchObject({ card: 'generic', kind: 'read' })
    expect(tools[1]?.parameters).toMatchObject({
      required: ['app'],
      properties: {
        app: { type: 'object' },
        screenshot: { enum: ['none', 'optional', 'required'] },
      },
    })
    expect(tools[5]?.parameters).toMatchObject({
      required: ['observationId', 'key'],
      properties: {
        key: { enum: expect.arrayContaining(['return', 'escape', 'left', 'right']) },
        modifiers: { items: { enum: ['command', 'control', 'option', 'shift'] } },
      },
    })
    expect(tools[2]?.parameters).not.toHaveProperty('properties.focusPolicy')
    expect(tools[2]?.parameters).not.toHaveProperty('properties.pointerInputPolicy')
    expect(tools[2]?.output.schema).toMatchObject({
      required: ['action', 'channel', 'activation', 'pointerInput', 'pointerRouting', 'observation'],
      properties: {
        activation: { enum: ['not-requested', 'already-frontmost', 'activated'] },
        pointerInput: { type: 'boolean' },
        pointerRouting: { enum: ['none', 'target-process'] },
      },
    })
    const confirmationBranches = (tools[10]?.parameters as {
      properties: { action: { oneOf: Array<{ properties: { kind: { const: string } } }> } }
    }).properties.action.oneOf
    expect(confirmationBranches.map(branch => branch.properties.kind.const)).toEqual([
      'click', 'set-value', 'type-text', 'press-key', 'scroll', 'drag', 'perform-action',
    ])

    const exec = {
      name: 'computer-test',
      callId: 'call-1',
      signal: new AbortController().signal,
      agent: { session: { header: {} } },
    }
    await tools[0]!.execute({}, exec as never)
    await tools[1]!.execute({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'required', full: true }, exec as never)
    await tools[2]!.execute({ observationId: 'observation-1', elementIndex: 4, allowCoordinateFallback: true }, exec as never)
    await tools[3]!.execute({ observationId: 'observation-1', elementIndex: 5, value: 'secret-value' }, exec as never)
    await tools[4]!.execute({ observationId: 'observation-1', text: 'typed-secret' }, exec as never)
    await tools[5]!.execute({ observationId: 'observation-1', key: 'return', modifiers: ['command'] }, exec as never)
    await tools[6]!.execute({ observationId: 'observation-1', direction: 'down', x: 1, y: 2, pages: 2 }, exec as never)
    await tools[7]!.execute({ observationId: 'observation-1', fromX: 1, fromY: 2, toX: 3, toY: 4 }, exec as never)
    await tools[8]!.execute({ observationId: 'observation-1', elementIndex: 6, action: 'AXShowMenu' }, exec as never)
    await tools[9]!.execute({ observationId: 'observation-1', condition: { text: 'ready' }, timeoutMs: 500 }, exec as never)
    await tools[10]!.execute({
      action: { kind: 'click', observationId: 'observation-1', elementIndex: 7 },
      reason: 'publish',
      target: 'fixture',
      dataSummary: 'status only',
    }, exec as never)

    expect(service.listApps).toHaveBeenCalledOnce()
    expect(service.observe).toHaveBeenCalledWith(
      { app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'required', full: true },
      expect.objectContaining({ workspace: process.cwd(), callId: 'call-1' }),
    )
    expect(service.act.mock.calls.map(call => call[0])).toEqual([
      expect.objectContaining({ kind: 'click', observationId: 'observation-1', elementIndex: 4, allowCoordinateFallback: true }),
      expect.objectContaining({ kind: 'set-value', value: 'secret-value' }),
      expect.objectContaining({ kind: 'type-text', text: 'typed-secret' }),
      expect.objectContaining({ kind: 'press-key', key: 'return', modifiers: ['command'] }),
      expect.objectContaining({ kind: 'scroll', direction: 'down', x: 1, y: 2, pages: 2 }),
      expect.objectContaining({ kind: 'drag', fromX: 1, toY: 4 }),
      expect.objectContaining({ kind: 'perform-action', elementIndex: 6, action: 'AXShowMenu' }),
      expect.objectContaining({ kind: 'wait', condition: { text: 'ready' }, timeoutMs: 500 }),
    ])
    expect(service.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({ kind: 'click', observationId: 'observation-1', sensitive: true }),
        reason: 'publish',
        target: 'fixture',
      }),
      expect.any(Object),
    )

    const actionResult = await tools[3]!.execute({ observationId: 'observation-1', elementIndex: 5, value: 'do-not-render' }, exec as never)
    const rendered = tools[3]!.output.render({}, actionResult)
    expect(JSON.stringify(rendered)).not.toContain('do-not-render')
    expect(tools[3]!.output.presentationMeta?.({}, actionResult)).toEqual({
      artifacts: [expect.objectContaining({ path: '/tmp/screenshot.png', previewIntent: 'image' })],
    })
    expect(tools[1]!.output.presentationMeta?.({}, current)).toEqual({ artifacts: [current.screenshot] })
  })

  it('requires an Agent-backed Session for execution', async () => {
    const service = { listApps: vi.fn() }
    const [list] = createComputerUseTools(service as never)
    await expect(list!.execute({}, {
      name: 'computer_list_apps',
      signal: new AbortController().signal,
    } as never)).rejects.toThrow(/Agent Session is required/)
  })
})
