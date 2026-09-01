import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalOutcome, ApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import { resolveConfig, type ComputerUseConfig } from '../src/config.ts'
import type { ComputerUseSessionState } from '../src/leases.ts'
import { ComputerUseError } from '../src/errors.ts'
import { ComputerUseService } from '../src/service.ts'
import {
  ComputerObservationId,
  ComputerConfirmationToken,
  ComputerTargetHandle,
  type ComputerActionRequest,
  type ComputerUseContext,
} from '../src/types.ts'
import { FakeBackend, FIXTURE_APP, backendObservation, fakeAgent, temporaryDirectory } from './helpers.ts'

class TestComputerUseService extends ComputerUseService {
  initializeForTest(): Promise<void> {
    return this.initialize()
  }

  reconfigureForTest(backend: FakeBackend, config: ComputerUseConfig): Promise<void> {
    return this.reconfigure(backend, resolveConfig(config))
  }
}

function serviceHarness(
  config: ComputerUseConfig = {},
  approval: ApprovalOutcome = 'allowed-once',
  policy: ApprovalPolicy = 'ask',
  options: { storage?: boolean; flushParticipates?: boolean } = {},
) {
  const ctx = new Context()
  const order: string[] = []
  let approvalId = 0
  const request = vi.fn(({ agent }: { agent: ReturnType<typeof fakeAgent> }) => {
    const id = `approval-${++approvalId}`
    agent.session.append('approval/asked', { id })
    agent.session.append('approval/decided', { id, outcome: approval })
    order.push('approval:decided')
    return Promise.resolve(approval)
  })
  ctx.provide('approval', {
    request,
    overrideOf: () => (policy === 'never' ? 'never' : undefined),
    config: { policy },
  } as never)
  const rows = new Map<string, ComputerUseSessionState>()
  const flush = vi.fn(() => {
    order.push('session:flushed')
    return Promise.resolve(options.flushParticipates ?? true)
  })
  ctx.provide('sessions', { flush } as never)
  if (options.storage !== false) {
    ctx.provide('storageDomain', {
      open: () => Promise.resolve({
        table: () => ({
          get: (key: string) => rows.get(key),
          put: (key: string, value: ComputerUseSessionState) => {
            order.push('sidecar:durable')
            rows.set(key, value)
            return Promise.resolve()
          },
        }),
        close: () => Promise.resolve(),
      }),
    } as never)
  }
  const backend = new FakeBackend()
  const service = new TestComputerUseService(ctx, backend, resolveConfig({
    settleMs: 0,
    maxSettleMs: 100,
    grants: [{ bundleId: FIXTURE_APP.bundleId, read: true, control: true }],
    ...config,
  }))
  return { ctx, backend, service, request, rows, flush, order }
}

function callContext(agent: ReturnType<typeof fakeAgent>, workspace: string): ComputerUseContext {
  return { agent, workspace, signal: new AbortController().signal }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Computer Use Service', () => {
  it('initializes health, lists apps, observes, acts, returns fresh diff state, and rejects stale reuse', async () => {
    const workspace = await temporaryDirectory('dsh-computer-service-')
    try {
      const { backend, service } = serviceHarness()
      await service.initializeForTest()
      expect(service.status()).toMatchObject({
        ready: true,
        provider: 'macos-ax',
        helperVersion: '0.1.0-test',
        generation: 1,
      })
      const agent = fakeAgent(workspace.path)
      const context = callContext(agent, workspace.path)
      expect(await service.listApps(context)).toHaveLength(1)
      const before = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)
      expect(before.tree.mode).toBe('full')
      const result = await service.act({ kind: 'click', observationId: before.observationId, elementIndex: 1 }, context)
      expect(result).toMatchObject({
        action: 'click',
        channel: 'accessibility',
        activation: 'not-requested',
        pointerInput: false,
        pointerRouting: 'none',
        resolution: {
          mode: 'exact-locator',
          confidence: 1,
          candidateCount: 1,
          targetChanged: false,
        },
      })
      expect(result.observation.observationId).not.toBe(before.observationId)
      expect(result.observation.tree.mode).toBe('diff')
      expect(result.observation.tree.text).toContain('AXStaticText')
      expect(backend.actions).toHaveLength(1)
      expect(backend.cursorActions).toEqual([
        { phase: 'before', action: { kind: 'click', to: { x: 260, y: 334 }, targetPid: FIXTURE_APP.pid, targetWindowNumber: 7, targetWindowFrame: { x: 100, y: 200, width: 760, height: 592 } } },
        { phase: 'after', action: { kind: 'click', to: { x: 260, y: 334 }, targetPid: FIXTURE_APP.pid, targetWindowNumber: 7, targetWindowFrame: { x: 100, y: 200, width: 760, height: 592 } } },
      ])
      await expect(service.act({ kind: 'click', observationId: before.observationId, elementIndex: 1 }, context))
        .rejects.toMatchObject({ code: 'COMPUTER_STALE_OBSERVATION' })
    } finally {
      await workspace.cleanup()
    }
  })

  it('reports bounded structural observation changes without claiming causal proof', async () => {
    // Routing fields describe the attempt. The effect reports only the
    // structural state hash and explicitly preserves uncertainty about pixels,
    // transient UI, remote effects, and unrelated external changes.
    const workspace = await temporaryDirectory('dsh-computer-effect-')
    try {
      const { backend, service } = serviceHarness()
      await service.initializeForTest()
      const agent = fakeAgent(workspace.path)
      const context = callContext(agent, workspace.path)

      const before = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)
      const effective = await service.act(
        { kind: 'click', observationId: before.observationId, elementIndex: 1 },
        context,
      )
      expect(effective.effect.observedStateChanged).toBe(true)
      expect(effective.effect).not.toHaveProperty('note')

      backend.inert = true
      const after = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)
      const inert = await service.act(
        { kind: 'click', observationId: after.observationId, elementIndex: 1 },
        context,
      )
      expect(inert.effect.observedStateChanged).toBe(false)
      expect(inert.effect.note).toContain('pixel-only, remote, or transient effects may still have occurred')
      // The attempt still reads as a clean success, which is exactly why the
      // outcome needs its own field.
      expect(inert.pointerRouting).toBe('target-process')
    } finally {
      await workspace.cleanup()
    }
  })

  it('serializes actions for one app through their post-action observation', async () => {
    const workspace = await temporaryDirectory('dsh-computer-action-queue-')
    try {
      const { backend, service } = serviceHarness()
      backend.inert = true
      await service.initializeForTest()
      const firstAgent = fakeAgent(workspace.path, 'queue-1')
      const secondAgent = fakeAgent(workspace.path, 'queue-2')
      const firstContext = callContext(firstAgent, workspace.path)
      const secondContext = callContext(secondAgent, workspace.path)
      const firstObservation = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, firstContext)
      const secondObservation = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, secondContext)
      const originalAct = backend.act.bind(backend)
      let active = 0
      let maximumActive = 0
      vi.spyOn(backend, 'act').mockImplementation(async request => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await new Promise(resolve => setTimeout(resolve, 20))
        try {
          return await originalAct(request)
        } finally {
          active -= 1
        }
      })

      const [first, second] = await Promise.all([
        service.act({ kind: 'click', observationId: firstObservation.observationId, elementIndex: 1 }, firstContext),
        service.act({ kind: 'click', observationId: secondObservation.observationId, elementIndex: 1 }, secondContext),
      ])
      expect(maximumActive).toBe(1)
      expect(first.effect.observedStateChanged).toBe(false)
      expect(second.effect.observedStateChanged).toBe(false)
    } finally {
      await workspace.cleanup()
    }
  })

  it('fails closed when a foreground cursor cannot complete before input', async () => {
    const workspace = await temporaryDirectory('dsh-computer-cursor-')
    try {
      const { backend, service } = serviceHarness()
      await service.initializeForTest()
      const agent = fakeAgent(workspace.path)
      const context = callContext(agent, workspace.path)

      const visible = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)
      const shown = await service.act({ kind: 'click', observationId: visible.observationId, elementIndex: 1 }, context)
      expect(shown).not.toHaveProperty('agentCursor')

      backend.cursorVisibility = { visible: false, reason: 'the bound target window moved' }
      const next = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)
      await expect(service.act({ kind: 'click', observationId: next.observationId, elementIndex: 1 }, context)).rejects.toMatchObject({
        code: 'COMPUTER_PROVIDER_FAILURE',
        message: expect.stringContaining('the bound target window moved'),
      })
      expect(backend.actions).toHaveLength(1)
    } finally {
      await workspace.cleanup()
    }
  })

  it('allows targeted background input when the cursor is hidden for that explicit reason', async () => {
    const workspace = await temporaryDirectory('dsh-computer-cursor-background-')
    try {
      const { backend, service } = serviceHarness()
      backend.cursorVisibility = {
        visible: false,
        reason: 'the bound target application is not frontmost',
        reasonCode: 'target-not-frontmost',
      }
      await service.initializeForTest()
      const agent = fakeAgent(workspace.path)
      const context = callContext(agent, workspace.path)

      const before = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)
      const result = await service.act({ kind: 'click', observationId: before.observationId, elementIndex: 1 }, context)
      expect(result.agentCursor).toEqual({
        visible: false,
        reason: 'the bound target application is not frontmost',
      })
      expect(backend.actions).toHaveLength(1)
      expect(backend.cursorActions).toHaveLength(1)
    } finally {
      await workspace.cleanup()
    }
  })

  it('does not bypass cursor feedback after activation-mode focus loss', async () => {
    const workspace = await temporaryDirectory('dsh-computer-cursor-activation-focus-loss-')
    try {
      const { backend, service } = serviceHarness({ interaction: { focusPolicy: 'activate' } })
      backend.cursorVisibility = {
        visible: false,
        reason: 'the bound target application is not frontmost',
        reasonCode: 'target-not-frontmost',
      }
      await service.initializeForTest()
      const agent = fakeAgent(workspace.path)
      const context = callContext(agent, workspace.path)

      const before = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)
      await expect(service.act({
        kind: 'click',
        observationId: before.observationId,
        x: 300,
        y: 350,
        coordinateSpace: 'window',
      }, context)).rejects.toMatchObject({
        code: 'COMPUTER_PROVIDER_FAILURE',
        message: expect.stringContaining('not frontmost'),
      })
      expect(backend.actions).toHaveLength(0)
    } finally {
      await workspace.cleanup()
    }
  })

  it('keeps semantic background clicks nonactivating in activation mode', async () => {
    const workspace = await temporaryDirectory('dsh-computer-cursor-semantic-background-')
    try {
      const { backend, service } = serviceHarness({ interaction: { focusPolicy: 'activate' } })
      backend.observation = backendObservation({ frontmost: false })
      backend.cursorVisibility = {
        visible: false,
        reason: 'the bound target application is not frontmost',
        reasonCode: 'target-not-frontmost',
      }
      await service.initializeForTest()
      const agent = fakeAgent(workspace.path)
      const context = callContext(agent, workspace.path)

      const before = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)
      const result = await service.act({ kind: 'click', observationId: before.observationId, elementIndex: 1 }, context)
      expect(result.agentCursor).toEqual({
        visible: false,
        reason: 'the bound target application is not frontmost',
      })
      expect(backend.cursorActivations).toHaveLength(0)
      expect(backend.actions).toHaveLength(1)
    } finally {
      await workspace.cleanup()
    }
  })

  it('starts native drag input with the separate live cursor-tracking phase', async () => {
    const workspace = await temporaryDirectory('dsh-computer-cursor-drag-order-')
    try {
      const { backend, service } = serviceHarness()
      const beforeCursor = Promise.withResolvers<{ visible: boolean }>()
      const duringCursor = Promise.withResolvers<{ visible: boolean }>()
      const visualize = vi.spyOn(backend, 'visualizeCursor').mockImplementation((_action, phase) => (
        phase === 'before' ? beforeCursor.promise : phase === 'during' ? duringCursor.promise : Promise.resolve({ visible: true })
      ))
      await service.initializeForTest()
      const agent = fakeAgent(workspace.path)
      const context = callContext(agent, workspace.path)
      const before = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)

      const action = service.act({
        kind: 'drag',
        observationId: before.observationId,
        fromX: 10,
        fromY: 20,
        toX: 200,
        toY: 240,
      }, context)
      await vi.waitFor(() => { expect(visualize).toHaveBeenCalledTimes(1) })
      expect(backend.actions).toHaveLength(0)

      beforeCursor.resolve({ visible: true })
      await vi.waitFor(() => { expect(backend.actions).toHaveLength(1) })
      expect(visualize.mock.calls.map(call => call[1])).toEqual(['before', 'during'])
      let settled = false
      void action.then(() => { settled = true })
      await Promise.resolve()
      expect(settled).toBe(false)

      duringCursor.resolve({ visible: true })
      await expect(action).resolves.toMatchObject({ effect: expect.any(Object) })
      expect(visualize.mock.calls.map(call => call[1])).toEqual(['before', 'during', 'after'])
    } finally {
      await workspace.cleanup()
    }
  })

  it('reports an after-only cursor failure instead of dropping release validation', async () => {
    const workspace = await temporaryDirectory('dsh-computer-cursor-after-')
    try {
      const { backend, service } = serviceHarness()
      await service.initializeForTest()
      const agent = fakeAgent(workspace.path)
      const context = callContext(agent, workspace.path)
      vi.spyOn(backend, 'visualizeCursor').mockImplementation((_action, phase) => Promise.resolve(
        phase === 'before'
          ? { visible: true }
          : { visible: false, reason: 'the target window moved during the action' },
      ))

      const before = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)
      const result = await service.act({ kind: 'click', observationId: before.observationId, elementIndex: 1 }, context)
      expect(result.agentCursor).toEqual({ visible: false, reason: 'the target window moved during the action' })
    } finally {
      await workspace.cleanup()
    }
  })

  it('releases cursor feedback when confirmation consumption fails after arrival', async () => {
    const workspace = await temporaryDirectory('dsh-computer-cursor-confirmation-cleanup-')
    try {
      const { backend, service } = serviceHarness()
      await service.initializeForTest()
      const agent = fakeAgent(workspace.path)
      const context = callContext(agent, workspace.path)
      const before = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)

      await expect(service.act({
        kind: 'click',
        observationId: before.observationId,
        elementIndex: 1,
        sensitive: true,
        confirmationToken: ComputerConfirmationToken('unknown'),
      }, context)).rejects.toMatchObject({ code: 'COMPUTER_CONFIRMATION_REQUIRED' })
      expect(backend.cursorActions.map(entry => entry.phase)).toEqual(['before', 'after'])
      expect(backend.actions).toHaveLength(0)
    } finally {
      await workspace.cleanup()
    }
  })

  it('uses an independent bounded signal for cursor cleanup after cancellation', async () => {
    const workspace = await temporaryDirectory('dsh-computer-cursor-cancel-cleanup-')
    try {
      const { backend, service } = serviceHarness()
      const controller = new AbortController()
      vi.spyOn(backend, 'act').mockImplementation(() => {
        controller.abort()
        return Promise.reject(new ComputerUseError('COMPUTER_CANCELLED', 'fixture action cancelled'))
      })
      await service.initializeForTest()
      const agent = fakeAgent(workspace.path)
      const context = { ...callContext(agent, workspace.path), signal: controller.signal }
      const before = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)

      await expect(service.act({ kind: 'click', observationId: before.observationId, elementIndex: 1 }, context))
        .rejects.toMatchObject({ code: 'COMPUTER_CANCELLED' })
      expect(backend.cursorActions.map(entry => entry.phase)).toEqual(['before', 'after'])
      expect(backend.cursorSignals[0]?.aborted).toBe(true)
      expect(backend.cursorSignals[1]?.aborted).toBe(false)
    } finally {
      await workspace.cleanup()
    }
  })

  it('fails closed before foreground input when the cursor has no stable window id', async () => {
    const workspace = await temporaryDirectory('dsh-computer-cursor-window-id-')
    try {
      const { backend, service } = serviceHarness()
      backend.observation = backendObservation({
        window: {
          title: 'DSH Computer Use Fixture',
          frame: { x: 100, y: 200, width: 760, height: 592 },
        },
      })
      await service.initializeForTest()
      const agent = fakeAgent(workspace.path)
      const context = callContext(agent, workspace.path)

      const before = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)
      await expect(service.act({ kind: 'click', observationId: before.observationId, elementIndex: 1 }, context)).rejects.toMatchObject({
        code: 'COMPUTER_PROVIDER_FAILURE',
        message: expect.stringContaining('no stable window id'),
      })
      expect(backend.cursorActions).toHaveLength(0)
      expect(backend.actions).toHaveLength(0)
    } finally {
      await workspace.cleanup()
    }
  })

  it('activates a background pointer target before running the cursor sequence', async () => {
    const workspace = await temporaryDirectory('dsh-computer-cursor-activate-')
    try {
      const { backend, service } = serviceHarness({ interaction: { focusPolicy: 'activate' } })
      backend.observation = backendObservation({ frontmost: false })
      const activate = vi.spyOn(backend, 'activateForCursor')
      const visualize = vi.spyOn(backend, 'visualizeCursor')
      await service.initializeForTest()
      const agent = fakeAgent(workspace.path)
      const context = callContext(agent, workspace.path)

      const before = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)
      const result = await service.act({
        kind: 'click',
        observationId: before.observationId,
        x: 300,
        y: 350,
        coordinateSpace: 'window',
      }, context)

      expect(activate).toHaveBeenCalledOnce()
      expect(visualize).toHaveBeenCalled()
      expect(activate.mock.invocationCallOrder[0]).toBeLessThan(visualize.mock.invocationCallOrder[0]!)
      expect(result.activation).toBe('activated')
      expect(backend.actions[0]?.expectedStateHash).toBe(backend.cursorActivations[0])
    } finally {
      await workspace.cleanup()
    }
  })

  it('rebinds a unique target after an unrelated sibling shifts its locator', async () => {
    const workspace = await temporaryDirectory('dsh-computer-rebind-')
    try {
      const { backend, service } = serviceHarness()
      await service.initializeForTest()
      const agent = fakeAgent(workspace.path)
      const context = callContext(agent, workspace.path)
      const before = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)
      const target = before.elements.find(element => element.title === 'Apply')!
      expect(target.targetHandle).toEqual(expect.any(String))
      expect(target).not.toHaveProperty('nativeIdentifier')
      backend.observation = backendObservation({
        stateHash: 'state-reordered',
        elements: [
          backend.observation.elements[0]!,
          { index: 1, locator: [0], role: 'AXStaticText', label: 'Unrelated status', actions: [] },
          { ...backend.observation.elements[1]!, index: 2, locator: [1] },
        ],
      })

      await expect(service.act({
        kind: 'click',
        observationId: before.observationId,
        elementIndex: target.index,
        targetHandle: target.targetHandle,
        allowRebind: true,
      }, context)).resolves.toMatchObject({
        resolution: {
          mode: 'semantic-rebind',
          candidateCount: 1,
          targetChanged: true,
        },
      })
    } finally {
      await workspace.cleanup()
    }
  })

  it('prefers a provider-native identifier over semantic rebinding', async () => {
    const workspace = await temporaryDirectory('dsh-computer-native-rebind-')
    try {
      const { backend, service } = serviceHarness()
      backend.observation = backendObservation({
        elements: backend.observation.elements.map(element => element.index === 1
          ? { ...element, nativeIdentifier: 'fixture.apply' }
          : element),
      })
      await service.initializeForTest()
      const agent = fakeAgent(workspace.path)
      const context = callContext(agent, workspace.path)
      const before = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)
      const target = before.elements.find(element => element.title === 'Apply')!
      backend.observation = backendObservation({
        stateHash: 'state-native-reordered',
        elements: [
          backend.observation.elements[0]!,
          { index: 1, locator: [0], role: 'AXStaticText', label: 'Unrelated status', actions: [] },
          { ...backend.observation.elements[1]!, index: 2, locator: [1] },
        ],
      })

      await expect(service.act({
        kind: 'click',
        observationId: before.observationId,
        targetHandle: target.targetHandle,
        allowRebind: true,
      }, context)).resolves.toMatchObject({
        resolution: {
          mode: 'native-identifier',
          confidence: 1,
          candidateCount: 1,
          targetChanged: true,
        },
      })
    } finally {
      await workspace.cleanup()
    }
  })

  it('keeps an unrelated status update from invalidating an exact handle target', async () => {
    const workspace = await temporaryDirectory('dsh-computer-unrelated-update-')
    try {
      const { backend, service } = serviceHarness()
      await service.initializeForTest()
      const agent = fakeAgent(workspace.path)
      const context = callContext(agent, workspace.path)
      const before = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)
      const target = before.elements.find(element => element.title === 'Apply')!
      backend.observation = backendObservation({
        ...backend.observation,
        stateHash: 'state-timer-update',
        treeText: `${backend.observation.treeText}\n  [2] AXStaticText "Timer: 1"`,
        elements: [
          ...backend.observation.elements,
          { index: 2, locator: [1], role: 'AXStaticText', label: 'Timer', value: '1', actions: [] },
        ],
      })

      await expect(service.act({
        kind: 'click',
        observationId: before.observationId,
        targetHandle: target.targetHandle,
        allowRebind: true,
      }, context)).resolves.toMatchObject({
        resolution: {
          mode: 'exact-locator',
          confidence: 1,
          candidateCount: 1,
          targetChanged: false,
        },
      })
    } finally {
      await workspace.cleanup()
    }
  })

  it('rejects unscoped, mismatched, and index-only rebinding requests before fresh provider work', async () => {
    const workspace = await temporaryDirectory('dsh-computer-handle-scope-')
    try {
      const { backend, service } = serviceHarness()
      await service.initializeForTest()
      const agent = fakeAgent(workspace.path)
      const context = callContext(agent, workspace.path)
      const observation = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)
      const window = observation.elements[0]!
      const target = observation.elements[1]!
      const observationsBefore = backend.observations.length

      await expect(service.act({
        kind: 'click',
        observationId: observation.observationId,
        targetHandle: ComputerTargetHandle('unknown-handle'),
        allowRebind: true,
      }, context)).rejects.toMatchObject({ code: 'COMPUTER_TARGET_UNAVAILABLE' })
      await expect(service.act({
        kind: 'click',
        observationId: observation.observationId,
        elementIndex: target.index,
        targetHandle: window.targetHandle,
        allowRebind: true,
      }, context)).rejects.toMatchObject({ code: 'COMPUTER_TARGET_UNAVAILABLE' })
      await expect(service.act({
        kind: 'click',
        observationId: observation.observationId,
        elementIndex: target.index,
        allowRebind: true,
      }, context)).rejects.toMatchObject({ code: 'COMPUTER_TARGET_UNAVAILABLE' })
      expect(backend.observations).toHaveLength(observationsBefore)
      expect(backend.actions).toHaveLength(0)
    } finally {
      await workspace.cleanup()
    }
  })

  it.each([
    ['coordinate click', (observationId: ComputerObservationId) => ({
      kind: 'click' as const,
      observationId,
      x: 1,
      y: 2,
    })],
    ['coordinate fallback', (observationId: ComputerObservationId) => ({
      kind: 'click' as const,
      observationId,
      elementIndex: 0,
      allowCoordinateFallback: true,
    })],
    ['scroll', (observationId: ComputerObservationId) => ({
      kind: 'scroll' as const,
      observationId,
      x: 1,
      y: 2,
      direction: 'down' as const,
    })],
    ['drag', (observationId: ComputerObservationId) => ({
      kind: 'drag' as const,
      observationId,
      fromX: 1,
      fromY: 2,
      toX: 3,
      toY: 4,
    })],
  ])('blocks %s before control approval or confirmation consumption', async (_name, actionOf) => {
    const workspace = await temporaryDirectory('dsh-computer-pointer-policy-')
    try {
      const { backend, service, request } = serviceHarness({
        interaction: { focusPolicy: 'preserve', pointerInputPolicy: 'deny' },
        grants: [{ bundleId: FIXTURE_APP.bundleId, read: true, control: false }],
      })
      await service.initializeForTest()
      const agent = fakeAgent(workspace.path)
      const context = callContext(agent, workspace.path)
      const before = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)
      request.mockClear()
      await expect(service.act({
        ...actionOf(before.observationId),
        sensitive: true,
        confirmationToken: ComputerConfirmationToken('unconsumed-token'),
      }, context)).rejects.toMatchObject({
        code: 'COMPUTER_ACTION_BLOCKED',
      })
      expect(request).not.toHaveBeenCalled()
      expect(backend.actions).toHaveLength(0)
    } finally {
      await workspace.cleanup()
    }
  })

  it('checks pointer policy from opaque-handle evidence before attempting rebinding', async () => {
    const workspace = await temporaryDirectory('dsh-computer-handle-pointer-policy-')
    try {
      const { backend, service } = serviceHarness({
        interaction: { focusPolicy: 'preserve', pointerInputPolicy: 'deny' },
      })
      backend.observation = backendObservation({
        elements: [
          backend.observation.elements[0]!,
          { ...backend.observation.elements[1]!, actions: [] },
        ],
      })
      await service.initializeForTest()
      const agent = fakeAgent(workspace.path)
      const context = callContext(agent, workspace.path)
      const observation = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)
      const target = observation.elements[1]!
      await expect(service.act({
        kind: 'click',
        observationId: observation.observationId,
        targetHandle: target.targetHandle,
        allowRebind: true,
        allowCoordinateFallback: true,
      }, context)).rejects.toMatchObject({ code: 'COMPUTER_ACTION_BLOCKED' })
      expect(backend.observations).toHaveLength(1)
      expect(backend.actions).toHaveLength(0)
    } finally {
      await workspace.cleanup()
    }
  })

  it('keeps target-process pointer input available when the host enables it', async () => {
    const workspace = await temporaryDirectory('dsh-computer-pointer-allow-')
    try {
      const { backend, service } = serviceHarness({
        interaction: { focusPolicy: 'preserve', pointerInputPolicy: 'targeted' },
      })
      backend.actionChannel = 'coordinates'
      backend.actionActivation = 'not-requested'
      backend.actionPointerInput = true
      backend.actionPointerRouting = 'target-process'
      await service.initializeForTest()
      const agent = fakeAgent(workspace.path)
      const context = callContext(agent, workspace.path)
      const before = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)
      const result = await service.act({ kind: 'drag', observationId: before.observationId, fromX: 1, fromY: 2, toX: 3, toY: 4 }, context)
      expect(result).toMatchObject({
        channel: 'coordinates',
        activation: 'not-requested',
        pointerInput: true,
        pointerRouting: 'target-process',
      })
      expect(backend.cursorActions).toEqual([
        {
          phase: 'before',
          action: { kind: 'drag', from: { x: 101, y: 202 }, to: { x: 103, y: 204 }, targetPid: FIXTURE_APP.pid, targetWindowNumber: 7, targetWindowFrame: { x: 100, y: 200, width: 760, height: 592 } },
        },
        {
          phase: 'during',
          action: { kind: 'drag', from: { x: 101, y: 202 }, to: { x: 103, y: 204 }, targetPid: FIXTURE_APP.pid, targetWindowNumber: 7, targetWindowFrame: { x: 100, y: 200, width: 760, height: 592 } },
        },
        {
          phase: 'after',
          action: { kind: 'drag', from: { x: 101, y: 202 }, to: { x: 103, y: 204 }, targetPid: FIXTURE_APP.pid, targetWindowNumber: 7, targetWindowFrame: { x: 100, y: 200, width: 760, height: 592 } },
        },
      ])
    } finally {
      await workspace.cleanup()
    }
  })

  it('can hide the Agent cursor without changing native input behavior', async () => {
    const workspace = await temporaryDirectory('dsh-computer-cursor-hidden-')
    try {
      const { backend, service } = serviceHarness({
        interaction: {
          focusPolicy: 'preserve',
          pointerInputPolicy: 'targeted',
          cursorVisualization: 'hidden',
        },
      })
      await service.initializeForTest()
      const agent = fakeAgent(workspace.path)
      const context = callContext(agent, workspace.path)
      const before = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)
      await service.act({ kind: 'click', observationId: before.observationId, elementIndex: 1 }, context)
      expect(backend.actions).toHaveLength(1)
      expect(backend.cursorActions).toHaveLength(0)
    } finally {
      await workspace.cleanup()
    }
  })

  it('blocks AXRaise before control approval when foreground activation is not authorized', async () => {
    const workspace = await temporaryDirectory('dsh-computer-raise-policy-')
    try {
      const { backend, service, request } = serviceHarness({
        interaction: { focusPolicy: 'preserve', pointerInputPolicy: 'targeted' },
        grants: [{ bundleId: FIXTURE_APP.bundleId, read: true, control: false }],
      })
      backend.observation = backendObservation({
        elements: [{
          index: 0,
          locator: [],
          role: 'AXWindow',
          title: 'DSH Computer Use Fixture',
          actions: ['AXRaise'],
          frame: { x: 100, y: 200, width: 760, height: 592 },
        }],
      })
      await service.initializeForTest()
      const agent = fakeAgent(workspace.path)
      const context = callContext(agent, workspace.path)
      const observation = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)
      request.mockClear()
      await expect(service.act({
        kind: 'perform-action',
        observationId: observation.observationId,
        elementIndex: 0,
        action: 'AXRaise',
      }, context)).rejects.toMatchObject({ code: 'COMPUTER_ACTION_BLOCKED' })
      expect(request).not.toHaveBeenCalled()
      expect(backend.actions).toHaveLength(0)
    } finally {
      await workspace.cleanup()
    }
  })

  it('scopes observations to one Agent, expires them, and releases them on disposal', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-11T04:00:00Z'))
    const workspace = await temporaryDirectory('dsh-computer-scope-')
    try {
      const { service } = serviceHarness({ observationTtlMs: 1000 })
      const owner = fakeAgent(workspace.path, 'owner')
      const other = fakeAgent(workspace.path, 'other')
      const observation = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, callContext(owner, workspace.path))
      await expect(service.act({ kind: 'click', observationId: observation.observationId, elementIndex: 1 }, callContext(other, workspace.path)))
        .rejects.toMatchObject({ code: 'COMPUTER_STALE_OBSERVATION' })
      vi.setSystemTime(new Date('2026-08-11T04:00:02Z'))
      await expect(service.act({ kind: 'click', observationId: observation.observationId, elementIndex: 1 }, callContext(owner, workspace.path)))
        .rejects.toMatchObject({ code: 'COMPUTER_STALE_OBSERVATION' })

      vi.setSystemTime(new Date('2026-08-11T04:00:03Z'))
      const fresh = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, callContext(owner, workspace.path))
      service.releaseAgent(owner)
      await expect(service.act({ kind: 'click', observationId: fresh.observationId, elementIndex: 1 }, callContext(owner, workspace.path)))
        .rejects.toMatchObject({ code: 'COMPUTER_STALE_OBSERVATION' })
    } finally {
      await workspace.cleanup()
    }
  })

  it('keeps observations reusable when observationTtlMs is zero', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-11T04:00:00Z'))
    const workspace = await temporaryDirectory('dsh-computer-ttl-off-')
    try {
      const { service } = serviceHarness({ observationTtlMs: 0 })
      const agent = fakeAgent(workspace.path)
      const observation = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, callContext(agent, workspace.path))
      expect(observation.expiresAt).toBe('9999-12-31T23:59:59.999Z')
      vi.setSystemTime(new Date('2026-08-11T05:00:00Z'))
      await expect(service.act({ kind: 'click', observationId: observation.observationId, elementIndex: 1 }, callContext(agent, workspace.path)))
        .resolves.toMatchObject({ action: 'click' })
    } finally {
      await workspace.cleanup()
    }
  })

  it('invalidates observations when the provider generation changes', async () => {
    const workspace = await temporaryDirectory('dsh-computer-generation-')
    try {
      const { service } = serviceHarness()
      const agent = fakeAgent(workspace.path)
      const context = callContext(agent, workspace.path)
      const observation = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)
      const replacement = new FakeBackend()
      await service.reconfigureForTest(replacement, {
        settleMs: 0,
        maxSettleMs: 100,
        grants: [{ bundleId: FIXTURE_APP.bundleId, read: true, control: true }],
      })
      expect(service.status().generation).toBe(2)
      await expect(service.act({ kind: 'click', observationId: observation.observationId, elementIndex: 1 }, context))
        .rejects.toMatchObject({ code: 'COMPUTER_STALE_OBSERVATION' })
    } finally {
      await workspace.cleanup()
    }
  })

  it('persists read leases for the Session and control leases for the current turn', async () => {
    const workspace = await temporaryDirectory('dsh-computer-leases-')
    try {
      const { service, request, rows, order } = serviceHarness({ grants: [] })
      const agent = fakeAgent(workspace.path)
      const context = callContext(agent, workspace.path)
      const first = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)
      await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)
      expect(request).toHaveBeenCalledTimes(1)
      const firstAction = await service.act({ kind: 'click', observationId: first.observationId, elementIndex: 1 }, context)
      expect(request).toHaveBeenCalledTimes(2)
      await service.act({ kind: 'click', observationId: firstAction.observation.observationId, elementIndex: 1 }, context)
      expect(request).toHaveBeenCalledTimes(2)
      expect(rows.get(agent.session.id)).toEqual({
        session: { createdAt: agent.session.header.createdAt, cwd: workspace.path },
        readGrants: [FIXTURE_APP.bundleId],
        denied: [],
      })
      expect(order.slice(0, 3)).toEqual(['approval:decided', 'session:flushed', 'sidecar:durable'])
      expect(agent.session.events.some(event => event.type.startsWith('computer-use/'))).toBe(false)
    } finally {
      await workspace.cleanup()
    }
  })

  it('fails closed when an application lease is unavailable or requested outside a turn', async () => {
    const workspace = await temporaryDirectory('dsh-computer-lease-denied-')
    try {
      const denied = serviceHarness({ grants: [] }, 'unavailable')
      const agent = fakeAgent(workspace.path)
      await expect(denied.service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, callContext(agent, workspace.path)))
        .rejects.toMatchObject({ code: 'COMPUTER_PERMISSION_REQUIRED' })
      agent.session.events.push({ type: 'turn/end', data: { turn: 1 } })
      await expect(denied.service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, callContext(agent, workspace.path)))
        .rejects.toThrow(/open Agent turn/)
    } finally {
      await workspace.cleanup()
    }
  })

  it('records a rejected approval for the Session and does not ask again for the same app and scope', async () => {
    const workspace = await temporaryDirectory('dsh-computer-lease-rejected-')
    try {
      const { service, request, rows } = serviceHarness({ grants: [] }, 'rejected')
      const agent = fakeAgent(workspace.path)
      const context = callContext(agent, workspace.path)
      await expect(service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context))
        .rejects.toMatchObject({ code: 'COMPUTER_PERMISSION_REQUIRED' })
      await expect(service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context))
        .rejects.toMatchObject({ code: 'COMPUTER_PERMISSION_REQUIRED' })
      expect(request).toHaveBeenCalledTimes(1)
      expect(rows.get(agent.session.id)?.denied).toEqual([{ bundleId: FIXTURE_APP.bundleId, scope: 'read' }])
      expect(agent.session.events.some(event => event.type.startsWith('computer-use/'))).toBe(false)
    } finally {
      await workspace.cleanup()
    }
  })

  it('blocks un-granted apps without an approval ask when approval prompts are disabled', async () => {
    const workspace = await temporaryDirectory('dsh-computer-policy-never-')
    try {
      const { service, request } = serviceHarness({ grants: [] }, 'allowed-once', 'never')
      const agent = fakeAgent(workspace.path)
      const context = callContext(agent, workspace.path)
      await expect(service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context))
        .rejects.toMatchObject({
          code: 'COMPUTER_PERMISSION_REQUIRED',
          message: expect.stringContaining('approval prompts are disabled'),
        })
      await expect(service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context))
        .rejects.toMatchObject({ code: 'COMPUTER_PERMISSION_REQUIRED' })
      expect(request).not.toHaveBeenCalled()
      expect(agent.session.events.some(event => event.type.startsWith('computer-use/'))).toBe(false)
    } finally {
      await workspace.cleanup()
    }
  })

  it('keeps static grants and current-turn control approval usable without storage-domain', async () => {
    const workspace = await temporaryDirectory('dsh-computer-no-storage-control-')
    try {
      const configured = serviceHarness({}, 'allowed-once', 'ask', { storage: false })
      const configuredAgent = fakeAgent(workspace.path, 'configured-no-storage')
      await expect(configured.service.observe(
        { app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' },
        callContext(configuredAgent, workspace.path),
      )).resolves.toBeDefined()
      expect(configured.request).not.toHaveBeenCalled()

      const interactive = serviceHarness({
        grants: [{ bundleId: FIXTURE_APP.bundleId, read: true, control: false }],
      }, 'allowed-once', 'ask', { storage: false })
      const agent = fakeAgent(workspace.path, 'control-no-storage')
      const context = callContext(agent, workspace.path)
      const first = await interactive.service.observe(
        { app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' },
        context,
      )
      const result = await interactive.service.act(
        { kind: 'click', observationId: first.observationId, elementIndex: 1 },
        context,
      )
      await interactive.service.act(
        { kind: 'click', observationId: result.observation.observationId, elementIndex: 1 },
        context,
      )
      expect(interactive.request).toHaveBeenCalledTimes(1)
    } finally {
      await workspace.cleanup()
    }
  })

  it('fails clearly before asking for a Session-wide read grant without storage-domain', async () => {
    const workspace = await temporaryDirectory('dsh-computer-no-storage-read-')
    try {
      const { service, request } = serviceHarness({ grants: [] }, 'allowed-once', 'ask', { storage: false })
      const agent = fakeAgent(workspace.path)
      await expect(service.observe(
        { app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' },
        callContext(agent, workspace.path),
      )).rejects.toMatchObject({
        code: 'COMPUTER_PERMISSION_REQUIRED',
        message: expect.stringContaining('ctx.storageDomain'),
      })
      expect(request).not.toHaveBeenCalled()
    } finally {
      await workspace.cleanup()
    }
  })

  it('ignores a stale sidecar row when a Session id is reused with another header identity', async () => {
    const workspace = await temporaryDirectory('dsh-computer-sidecar-identity-')
    try {
      const { service, request, rows } = serviceHarness({ grants: [] })
      const first = fakeAgent(workspace.path, 'reused')
      await service.observe(
        { app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' },
        callContext(first, workspace.path),
      )
      const replacement = fakeAgent(workspace.path, 'reused')
      ;(replacement.session.header as { createdAt: number }).createdAt += 1
      await service.observe(
        { app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' },
        callContext(replacement, workspace.path),
      )
      expect(request).toHaveBeenCalledTimes(2)
      expect(rows.get(replacement.session.id)?.session.createdAt).toBe(replacement.session.header.createdAt)
    } finally {
      await workspace.cleanup()
    }
  })

  it('does not publish a read grant when Session persistence does not participate in flush', async () => {
    const workspace = await temporaryDirectory('dsh-computer-no-flush-')
    try {
      const { service, rows } = serviceHarness(
        { grants: [] },
        'allowed-once',
        'ask',
        { flushParticipates: false },
      )
      const agent = fakeAgent(workspace.path)
      await expect(service.observe(
        { app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' },
        callContext(agent, workspace.path),
      )).rejects.toMatchObject({
        code: 'COMPUTER_PERMISSION_REQUIRED',
        message: expect.stringContaining('no Session persistence listener participated'),
      })
      expect(rows.has(agent.session.id)).toBe(false)
    } finally {
      await workspace.cleanup()
    }
  })

  it('allows every app when allowAllApps is enabled, even with approval prompts disabled', async () => {
    const workspace = await temporaryDirectory('dsh-computer-allow-all-')
    try {
      const { service, request } = serviceHarness({ grants: [], allowAllApps: true }, 'allowed-once', 'never')
      const agent = fakeAgent(workspace.path)
      const context = callContext(agent, workspace.path)
      await expect(service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)).resolves.toBeDefined()
      expect(request).not.toHaveBeenCalled()
    } finally {
      await workspace.cleanup()
    }
  })

  it('blocks sensitive confirmation without an approval ask when approval prompts are disabled', async () => {
    const workspace = await temporaryDirectory('dsh-computer-confirm-policy-never-')
    try {
      const { service, request } = serviceHarness({}, 'allowed-once', 'never')
      const agent = fakeAgent(workspace.path)
      const context = callContext(agent, workspace.path)
      const observation = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)
      const proposed: ComputerActionRequest = {
        kind: 'click',
        observationId: observation.observationId,
        elementIndex: 1,
        sensitive: true,
      }
      await expect(service.confirm({ action: proposed, reason: 'Publish a fixture state', target: 'fixture' }, context))
        .rejects.toMatchObject({
          code: 'COMPUTER_CONFIRMATION_REQUIRED',
          message: expect.stringContaining('approval prompts are disabled'),
        })
      expect(request).not.toHaveBeenCalled()
    } finally {
      await workspace.cleanup()
    }
  })

  it('binds sensitive confirmation to one exact app, observation, and action, then consumes it once', async () => {
    const workspace = await temporaryDirectory('dsh-computer-confirm-')
    try {
      const { service, request } = serviceHarness()
      const agent = fakeAgent(workspace.path)
      const context = callContext(agent, workspace.path)
      const observation = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)
      const proposed: ComputerActionRequest = {
        kind: 'click',
        observationId: observation.observationId,
        elementIndex: 1,
        sensitive: true,
      }
      const confirmation = await service.confirm({ action: proposed, reason: 'Publish a fixture state', target: 'fixture' }, context)
      expect(request).toHaveBeenCalledTimes(1)
      await expect(service.act({ ...proposed, clickCount: 2, confirmationToken: confirmation.token }, context))
        .rejects.toMatchObject({ code: 'COMPUTER_CONFIRMATION_REQUIRED' })
      await expect(service.act({ ...proposed, confirmationToken: confirmation.token }, context))
        .rejects.toMatchObject({ code: 'COMPUTER_CONFIRMATION_REQUIRED' })

      const next = await service.confirm({ action: proposed, reason: 'Publish a fixture state', target: 'fixture' }, context)
      const result = await service.act({ ...proposed, confirmationToken: next.token }, context)
      expect(result.action).toBe('click')
      await expect(service.act({ ...proposed, confirmationToken: next.token }, context))
        .rejects.toMatchObject({ code: 'COMPUTER_CONFIRMATION_REQUIRED' })
      await expect(service.act({ ...proposed, confirmationToken: ComputerConfirmationToken('unknown') }, context))
        .rejects.toMatchObject({ code: 'COMPUTER_CONFIRMATION_REQUIRED' })
    } finally {
      await workspace.cleanup()
    }
  })

  it('invalidates one-use confirmation when a sensitive target rebinds', async () => {
    const workspace = await temporaryDirectory('dsh-computer-confirm-rebind-')
    try {
      const { backend, service } = serviceHarness()
      await service.initializeForTest()
      const agent = fakeAgent(workspace.path)
      const context = callContext(agent, workspace.path)
      const observation = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)
      const target = observation.elements.find(element => element.title === 'Apply')!
      const proposed: ComputerActionRequest = {
        kind: 'click',
        observationId: observation.observationId,
        targetHandle: target.targetHandle,
        allowRebind: true,
        sensitive: true,
      }
      const confirmation = await service.confirm({ action: proposed, reason: 'Publish a fixture state', target: 'fixture' }, context)
      const original = structuredClone(backend.observation)
      backend.observation = backendObservation({
        stateHash: 'state-sensitive-reordered',
        elements: [
          original.elements[0]!,
          { index: 1, locator: [0], role: 'AXStaticText', label: 'Unrelated status', actions: [] },
          { ...original.elements[1]!, index: 2, locator: [1] },
        ],
      })

      await expect(service.act({ ...proposed, confirmationToken: confirmation.token }, context)).rejects.toMatchObject({
        code: 'COMPUTER_TARGET_REBIND_REQUIRES_CONFIRMATION',
      })
      expect(backend.actions).toHaveLength(0)

      backend.observation = original
      await expect(service.act({ ...proposed, confirmationToken: confirmation.token }, context)).rejects.toMatchObject({
        code: 'COMPUTER_CONFIRMATION_REQUIRED',
      })
      expect(backend.actions).toHaveLength(0)
    } finally {
      await workspace.cleanup()
    }
  })

  it('waits for a bounded condition and returns the matching fresh observation', async () => {
    const workspace = await temporaryDirectory('dsh-computer-wait-')
    try {
      const { backend, service } = serviceHarness({ settleMs: 10, maxSettleMs: 300 })
      const agent = fakeAgent(workspace.path)
      const context = callContext(agent, workspace.path)
      const observation = await service.observe({ app: { bundleId: FIXTURE_APP.bundleId }, screenshot: 'none' }, context)
      setTimeout(() => {
        backend.observation = backendObservation({
          ...backend.observation,
          stateHash: 'delayed-state',
          treeText: `${backend.observation.treeText}\nStatus: delayed complete`,
          elements: [...backend.observation.elements, {
            index: backend.observation.elements.length,
            locator: [99],
            role: 'AXStaticText',
            value: 'Status: delayed complete',
            actions: [],
          }],
        })
      }, 30)
      const result = await service.act({
        kind: 'wait',
        observationId: observation.observationId,
        condition: { text: 'delayed complete' },
        timeoutMs: 200,
      }, context)
      expect(result.channel).toBe('wait')
      expect(result.effect.observedStateChanged).toBe(true)
      expect(result.observation.tree.text).toContain('delayed complete')

      const alreadySatisfied = await service.act({
        kind: 'wait',
        observationId: result.observation.observationId,
        condition: { text: 'delayed complete' },
        timeoutMs: 200,
      }, context)
      expect(alreadySatisfied.effect).toMatchObject({
        observedStateChanged: false,
        note: 'the wait condition was already satisfied by the referenced observation',
      })
    } finally {
      await workspace.cleanup()
    }
  })
})
