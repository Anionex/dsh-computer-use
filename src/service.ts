/** Provider-independent Computer Use Service: leases, observations, staleness, confirmations, and fresh post-action state. */

import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { BackendCursorAction, BackendObservation, ComputerUseBackend } from './backend.ts'
import { allocateScreenshotPath, describeScreenshot } from './artifacts.ts'
import type { ResolvedComputerUseConfig } from './config.ts'
import { ComputerConfirmationManager } from './confirmations.ts'
import { diffElements } from './diff.ts'
import { ComputerUseError, computerUseError } from './errors.ts'
import { ComputerLeaseManager } from './leases.ts'
import {
  ComputerObservationId,
  type ComputerActionRequest,
  type ComputerActionResult,
  type ComputerAppIdentity,
  type ComputerAppSummary,
  type ComputerConfirmRequest,
  type ComputerConfirmation,
  type ComputerElement,
  type ComputerObservation,
  type ComputerObserveRequest,
  type ComputerUseContext,
  type ComputerUseStatus,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    computerUse: ComputerUseService
  }
}

interface StoredObservation {
  public: ComputerObservation
  backend: BackendObservation
  generation: number
}

interface AgentState {
  observations: Map<ComputerObservationId, StoredObservation>
  latestByApp: Map<string, ComputerObservationId>
}

function publicElements(elements: BackendObservation['elements']): ComputerElement[] {
  return elements.map(({ locator: _locator, ...element }) => element)
}

function matchesWait(observation: BackendObservation, action: Extract<ComputerActionRequest, { kind: 'wait' }>): boolean {
  const condition = action.condition
  if (condition.text !== undefined && !observation.treeText.toLocaleLowerCase().includes(condition.text.toLocaleLowerCase())) return false
  if (condition.elementRole !== undefined && !observation.elements.some(element => element.role === condition.elementRole)) return false
  if (condition.elementTitle !== undefined && !observation.elements.some(element => element.title === condition.elementTitle || element.label === condition.elementTitle)) return false
  return condition.text !== undefined || condition.elementRole !== undefined || condition.elementTitle !== undefined
}

function targetIndex(action: ComputerActionRequest): number | undefined {
  switch (action.kind) {
    case 'click':
    case 'scroll': return action.elementIndex
    case 'set-value':
    case 'perform-action': return action.elementIndex
    case 'type-text':
    case 'press-key':
    case 'drag':
    case 'wait': return undefined
  }
}

function requiresPointerInput(
  action: Exclude<ComputerActionRequest, { kind: 'wait' }>,
  element: BackendObservation['elements'][number] | undefined,
): boolean {
  switch (action.kind) {
    case 'click':
      if (action.x !== undefined || action.y !== undefined) return true
      return element !== undefined
        && !element.actions.includes('AXPress')
        && action.allowCoordinateFallback === true
    case 'scroll':
    case 'drag': return true
    case 'set-value':
    case 'type-text':
    case 'press-key':
    case 'perform-action': return false
  }
}

function requiresForegroundPermission(action: Exclude<ComputerActionRequest, { kind: 'wait' }>): boolean {
  return action.kind === 'perform-action' && action.action === 'AXRaise'
}

function cursorAction(
  action: Exclude<ComputerActionRequest, { kind: 'wait' }>,
  element: BackendObservation['elements'][number] | undefined,
  window: BackendObservation['window'] | undefined,
  app: BackendObservation['app'],
): BackendCursorAction | undefined {
  if (window?.id === undefined) return undefined
  const target = {
    targetPid: app.pid,
    targetWindowNumber: window.id,
    targetWindowFrame: { ...window.frame },
  }
  const elementPoint = element?.frame === undefined
    ? undefined
    : {
        x: element.frame.x + element.frame.width / 2,
        y: element.frame.y + element.frame.height / 2,
      }
  const coordinateSpace = action.kind === 'click' || action.kind === 'scroll' || action.kind === 'drag'
    ? action.coordinateSpace
    : undefined
  const windowPoint = (x: number | undefined, y: number | undefined): { x: number; y: number } | undefined => {
    if (x === undefined || y === undefined || window === undefined) return undefined
    return coordinateSpace === 'screen' ? { x, y } : { x: window.frame.x + x, y: window.frame.y + y }
  }
  switch (action.kind) {
    case 'click':
    case 'scroll': {
      const point = elementPoint ?? windowPoint(action.x, action.y)
      return point === undefined ? undefined : { kind: action.kind, to: point, ...target }
    }
    case 'drag': {
      const from = windowPoint(action.fromX, action.fromY)
      const to = windowPoint(action.toX, action.toY)
      return from === undefined || to === undefined ? undefined : { kind: 'drag', from, to, ...target }
    }
    case 'set-value':
    case 'type-text':
    case 'press-key':
    case 'perform-action': return undefined
  }
}

/** Complete Service Definition plus provider-independent implementation. */
export class ComputerUseService extends Service {
  private backend: ComputerUseBackend
  private config: ResolvedComputerUseConfig
  private generation = 1
  private readonly agents = new Map<Agent, AgentState>()
  private readonly leases: ComputerLeaseManager
  private readonly confirmations: ComputerConfirmationManager
  private readonly lifecycle = new AbortController()
  private healthState: Omit<ComputerUseStatus, 'platform' | 'provider' | 'generation' | 'helperPath'> = {
    ready: false,
    accessibility: 'unavailable',
    screenRecording: 'unavailable',
  }

  /** Register `ctx.computerUse` using one validated backend and configuration generation. */
  constructor(ctx: Context, backend: ComputerUseBackend, config: ResolvedComputerUseConfig) {
    super(ctx, 'computerUse')
    this.backend = backend
    this.config = config
    this.leases = new ComputerLeaseManager(ctx, () => this.config)
    this.confirmations = new ComputerConfirmationManager(ctx, () => this.config)
    ctx.effect(() => async () => {
      this.lifecycle.abort()
      this.clearState()
      await this.backend.dispose()
    }, 'dsh-computer-use: service lifecycle')
  }

  /** Verify the active backend before consumers become injectable. */
  protected async initialize(): Promise<void> {
    try {
      await this.leases.initialize()
      const health = await this.backend.health(this.lifecycle.signal)
      this.healthState = { ready: true, ...health }
    } catch (error) {
      const failure = computerUseError(error, 'Computer Use provider initialization failed')
      this.healthState = {
        ready: false,
        accessibility: 'unavailable',
        screenRecording: 'unavailable',
        lastError: failure.message,
      }
      throw failure
    }
  }

  /** Replace the backend/config generation after a validated live Settings update. */
  protected async reconfigure(backend: ComputerUseBackend, config: ResolvedComputerUseConfig): Promise<void> {
    const health = await backend.health(this.lifecycle.signal)
    const previous = this.backend
    this.backend = backend
    this.config = config
    this.generation += 1
    this.clearState()
    this.healthState = { ready: true, ...health }
    await previous.dispose()
  }

  /** Current provider and permission diagnostics. */
  status(): ComputerUseStatus {
    return {
      platform: process.platform,
      provider: 'macos-ax',
      generation: this.generation,
      helperPath: this.backend.helperPath,
      ...this.healthState,
    }
  }

  /** Re-run non-mutating provider health checks. */
  async health(signal: AbortSignal): Promise<ComputerUseStatus> {
    try {
      const health = await this.backend.health(AbortSignal.any([signal, this.lifecycle.signal]))
      this.healthState = { ready: true, ...health }
    } catch (error) {
      const failure = computerUseError(error, 'Computer Use health check failed')
      this.healthState = { ...this.healthState, ready: false, lastError: failure.message }
      throw failure
    }
    return this.status()
  }

  /** Open the exact macOS privacy pane after an explicit Settings-page action. */
  async openPermissionSettings(kind: 'accessibility' | 'screen-recording', signal: AbortSignal): Promise<void> {
    await this.backend.openSettings(kind, AbortSignal.any([signal, this.lifecycle.signal]))
  }

  /** List bounded running applications without inspecting their UI contents. */
  async listApps(context: ComputerUseContext): Promise<ComputerAppSummary[]> {
    return await this.backend.listApps(AbortSignal.any([context.signal, this.lifecycle.signal]))
  }

  /** Obtain a fresh, scoped observation after enforcing the app read lease. */
  async observe(request: ComputerObserveRequest, context: ComputerUseContext): Promise<ComputerObservation> {
    const signal = AbortSignal.any([context.signal, this.lifecycle.signal])
    const app = await this.backend.resolveApp(request.app, signal)
    await this.leases.ensure(context.agent, app, 'read', 'computer_observe', context.callId, signal)
    return await this.capture(app, request, context, 'computer_observe')
  }

  /** Ask for a one-use token bound to an exact proposed sensitive action. */
  async confirm(request: ComputerConfirmRequest, context: ComputerUseContext): Promise<ComputerConfirmation> {
    const stored = this.requireObservation(request.action.observationId, context.agent)
    return await this.confirmations.confirm(
      context.agent,
      stored.backend.app,
      request,
      context.callId,
      AbortSignal.any([context.signal, this.lifecycle.signal]),
    )
  }

  /** Execute one observation-bound action and always return a fresh post-action observation. */
  async act(action: ComputerActionRequest, context: ComputerUseContext): Promise<ComputerActionResult> {
    const signal = AbortSignal.any([context.signal, this.lifecycle.signal])
    const stored = this.requireObservation(action.observationId, context.agent)
    if (action.kind === 'wait') return await this.wait(stored, action, context, signal)
    const index = targetIndex(action)
    const element = index === undefined ? undefined : stored.backend.elements.find(candidate => candidate.index === index)
    if (index !== undefined && element === undefined) {
      throw new ComputerUseError('COMPUTER_ELEMENT_UNAVAILABLE', `element ${index} is not part of observation ${String(action.observationId)}`)
    }
    if (requiresPointerInput(action, element) && this.config.interaction.pointerInputPolicy === 'deny') {
      throw new ComputerUseError(
        'COMPUTER_ACTION_BLOCKED',
        `${action.kind} requires target-process pointer input, which interaction.pointerInputPolicy denies; use an Accessibility action or enable targeted pointer input in host Settings`,
      )
    }
    if (requiresForegroundPermission(action) && this.config.interaction.focusPolicy === 'preserve') {
      throw new ComputerUseError(
        'COMPUTER_ACTION_BLOCKED',
        'AXRaise may raise the target window, which interaction.focusPolicy preserve denies; enable explicit activation in host Settings before using this action',
      )
    }
    await this.leases.ensure(context.agent, stored.backend.app, 'control', `computer_${action.kind}`, context.callId, signal)
    this.confirmations.consume(context.agent, stored.backend.app, action)
    const visualization = cursorAction(action, element, stored.backend.window, stored.backend.app)
    let cursorStarted = false
    if (visualization !== undefined && this.config.interaction.cursorVisualization === 'visible') {
      try {
        await this.backend.visualizeCursor(visualization, 'before', signal)
        cursorStarted = true
      } catch {
        // The overlay is presentation-only; native input remains authoritative.
      }
    }
    let outcome
    try {
      outcome = await this.backend.act({
        action,
        app: stored.backend.app,
        expectedStateHash: stored.backend.stateHash,
        interaction: this.config.interaction,
        ...(element === undefined ? {} : { element }),
        ...(stored.backend.window === undefined ? {} : { window: stored.backend.window }),
      }, signal)
    } catch (error) {
      throw computerUseError(error, `Computer Use ${action.kind} failed`)
    } finally {
      if (cursorStarted && visualization !== undefined) {
        try {
          await this.backend.visualizeCursor(visualization, 'after', signal)
        } catch {
          // The overlay is presentation-only; native input remains authoritative.
        }
      }
    }
    const started = Date.now()
    let latest: BackendObservation | undefined
    do {
      if (this.config.settleMs > 0) await delay(this.config.settleMs, undefined, { signal })
      latest = await this.backend.observe(stored.backend.app, {
        screenshot: 'none',
        maxNodes: this.config.maxNodes,
        maxDepth: this.config.maxDepth,
        maxTextBytes: this.config.maxTextBytes,
      }, signal)
      if (latest.stateHash !== stored.backend.stateHash) break
    } while (Date.now() - started < this.config.maxSettleMs)
    const observation = await this.capture(
      stored.backend.app,
      { app: { bundleId: stored.backend.app.bundleId, pid: stored.backend.app.pid }, screenshot: stored.public.screenshot === undefined ? 'none' : 'optional' },
      context,
      'computer_action',
      latest,
    )
    return {
      action: action.kind,
      channel: outcome.channel,
      activation: outcome.activation,
      pointerInput: outcome.pointerInput,
      pointerRouting: outcome.pointerRouting,
      observation,
    }
  }

  /** Release all scoped observations and confirmations for one disposed Agent. */
  releaseAgent(agent: Agent): void {
    this.agents.delete(agent)
    this.leases.releaseAgent(agent)
    this.confirmations.releaseAgent(agent)
  }

  private state(agent: Agent): AgentState {
    let state = this.agents.get(agent)
    if (state === undefined) {
      state = { observations: new Map(), latestByApp: new Map() }
      this.agents.set(agent, state)
    }
    return state
  }

  private requireObservation(id: ComputerObservationId, agent: Agent): StoredObservation {
    this.prune(agent)
    const stored = this.state(agent).observations.get(id)
    if (stored === undefined || stored.generation !== this.generation) {
      throw new ComputerUseError('COMPUTER_STALE_OBSERVATION', `observation ${String(id)} is unknown, expired, or belongs to another provider generation`)
    }
    return stored
  }

  private prune(agent: Agent): void {
    const state = this.agents.get(agent)
    if (state === undefined) return
    const now = Date.now()
    for (const [id, stored] of state.observations) {
      if (Date.parse(stored.public.expiresAt) <= now || stored.generation !== this.generation) state.observations.delete(id)
    }
    for (const [app, id] of state.latestByApp) {
      if (!state.observations.has(id)) state.latestByApp.delete(app)
    }
  }

  private async capture(
    app: ComputerAppIdentity,
    request: ComputerObserveRequest,
    context: ComputerUseContext,
    sourceTool: 'computer_observe' | 'computer_action',
    preObserved?: BackendObservation,
  ): Promise<ComputerObservation> {
    const signal = AbortSignal.any([context.signal, this.lifecycle.signal])
    const screenshot = request.screenshot ?? 'optional'
    const screenshotPath = screenshot === 'none'
      ? undefined
      : await allocateScreenshotPath(context.workspace, this.config.artifactRoot, context.agent.session.id)
    const backend = preObserved !== undefined && screenshot === 'none'
      ? preObserved
      : await this.backend.observe(app, {
        screenshot,
        ...(screenshotPath === undefined ? {} : { screenshotPath }),
        maxNodes: this.config.maxNodes,
        maxDepth: this.config.maxDepth,
        maxTextBytes: this.config.maxTextBytes,
      }, signal)
    if (backend.app.bundleId !== app.bundleId || backend.app.pid !== app.pid) {
      throw new ComputerUseError('COMPUTER_STALE_OBSERVATION', 'the selected application restarted or resolved to a different process')
    }
    const state = this.state(context.agent)
    this.prune(context.agent)
    const key = `${app.bundleId}:${app.pid}`
    const previousId = state.latestByApp.get(key)
    const previous = previousId === undefined ? undefined : state.observations.get(previousId)
    const elements = publicElements(backend.elements)
    const full = request.full === true || previous === undefined
    const createdAt = Date.now()
    const observationId = ComputerObservationId(randomUUID())
    const artifact = backend.screenshot === undefined
      ? undefined
      : await describeScreenshot(
        backend.screenshot.path,
        backend.screenshot.width,
        backend.screenshot.height,
        this.config.maxScreenshotBytes,
        sourceTool,
      )
    const observation: ComputerObservation = {
      observationId,
      app: backend.app,
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: this.config.observationTtlMs === 0
        ? '9999-12-31T23:59:59.999Z'
        : new Date(createdAt + this.config.observationTtlMs).toISOString(),
      frontmost: backend.frontmost,
      ...(backend.window === undefined ? {} : { window: backend.window }),
      tree: {
        mode: full ? 'full' : 'diff',
        text: full ? backend.treeText : diffElements(publicElements(previous.backend.elements), elements, this.config.maxTextBytes),
        truncated: backend.truncated,
      },
      elements,
      ...(artifact === undefined ? {} : { screenshot: artifact }),
      permissions: backend.permissions,
    }
    state.observations.set(observationId, { public: observation, backend, generation: this.generation })
    state.latestByApp.set(key, observationId)
    while (state.observations.size > 64) {
      const oldest = state.observations.keys().next().value as ComputerObservationId | undefined
      if (oldest === undefined) break
      state.observations.delete(oldest)
    }
    return observation
  }

  private async wait(
    stored: StoredObservation,
    action: Extract<ComputerActionRequest, { kind: 'wait' }>,
    context: ComputerUseContext,
    signal: AbortSignal,
  ): Promise<ComputerActionResult> {
    await this.leases.ensure(context.agent, stored.backend.app, 'read', 'computer_wait', context.callId, signal)
    const timeoutMs = action.timeoutMs ?? this.config.maxSettleMs
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > this.config.maxSettleMs) {
      throw new ComputerUseError('COMPUTER_TIMEOUT', `wait timeout must be between 100 and ${this.config.maxSettleMs} milliseconds`)
    }
    const deadline = Date.now() + timeoutMs
    let latest = stored.backend
    while (!matchesWait(latest, action)) {
      if (Date.now() >= deadline) throw new ComputerUseError('COMPUTER_TIMEOUT', 'wait condition was not met before the configured deadline')
      await delay(Math.min(this.config.settleMs || 100, Math.max(1, deadline - Date.now())), undefined, { signal })
      latest = await this.backend.observe(stored.backend.app, {
        screenshot: 'none',
        maxNodes: this.config.maxNodes,
        maxDepth: this.config.maxDepth,
        maxTextBytes: this.config.maxTextBytes,
      }, signal)
    }
    const observation = await this.capture(
      stored.backend.app,
      { app: { bundleId: stored.backend.app.bundleId, pid: stored.backend.app.pid }, screenshot: stored.public.screenshot === undefined ? 'none' : 'optional' },
      context,
      'computer_action',
      latest,
    )
    return {
      action: 'wait',
      channel: 'wait',
      activation: 'not-requested',
      pointerInput: false,
      pointerRouting: 'none',
      observation,
    }
  }

  private clearState(): void {
    this.agents.clear()
    this.confirmations.clear()
  }
}

export default ComputerUseService
