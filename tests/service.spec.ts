import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalOutcome, ApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import { resolveConfig, type ComputerUseConfig } from '../src/config.ts'
import type { ComputerUseSessionState } from '../src/leases.ts'
import { ComputerUseService } from '../src/service.ts'
import {
  ComputerObservationId,
  ComputerConfirmationToken,
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
      expect(result.observation.tree.text).toContain('delayed complete')
    } finally {
      await workspace.cleanup()
    }
  })
})
