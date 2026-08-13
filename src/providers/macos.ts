/** macOS Accessibility/CoreGraphics/ScreenCaptureKit provider for `ctx.computerUse`. */

import { setTimeout as delay } from 'node:timers/promises'
import { Service, type Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {
  BackendActionRequest,
  BackendActionResult,
  BackendCursorAction,
  BackendHealth,
  BackendObservation,
  BackendObserveOptions,
  ComputerUseBackend,
} from '../backend.ts'
import {
  Config,
  COMPUTER_USE_SETTINGS_NAMESPACE,
  resolveConfig,
  type ComputerUseConfig,
  type ResolvedComputerUseConfig,
} from '../config.ts'
import { ComputerUseError } from '../errors.ts'
import { ComputerUseService } from '../service.ts'
import type { ComputerAppIdentity, ComputerAppSelector, ComputerAppSummary } from '../types.ts'
import { NativeHelperClient } from './native-helper.ts'

interface NativeHealth {
  helperVersion: string
  accessibility: BackendHealth['accessibility']
  screenRecording: BackendHealth['screenRecording']
}

interface NativeObservation extends BackendObservation {}

/** Fixed-command native backend. */
class MacOSBackend implements ComputerUseBackend {
  readonly name = 'macos-ax' as const
  readonly client: NativeHelperClient

  constructor(ctx: Context, private readonly config: ResolvedComputerUseConfig) {
    this.client = new NativeHelperClient(ctx, config)
  }

  get helperPath(): string {
    return this.client.helperPath
  }

  async resolveApp(selector: ComputerAppSelector, signal: AbortSignal): Promise<ComputerAppIdentity> {
    return await this.client.invoke<ComputerAppIdentity>({ command: 'resolve-app', selector }, signal)
  }

  async listApps(signal: AbortSignal): Promise<ComputerAppSummary[]> {
    return await this.client.invoke<ComputerAppSummary[]>({ command: 'list-apps' }, signal)
  }

  async observe(app: ComputerAppIdentity, options: BackendObserveOptions, signal: AbortSignal): Promise<BackendObservation> {
    return await this.client.invoke<NativeObservation>({
      command: 'observe',
      app,
      options,
    }, signal)
  }

  async act(request: BackendActionRequest, signal: AbortSignal): Promise<BackendActionResult> {
    return await this.client.invoke<BackendActionResult>({
      command: 'act',
      request: {
        ...request,
        actionTimeoutMs: this.config.actionTimeoutMs,
        limits: {
          maxNodes: this.config.maxNodes,
          maxDepth: this.config.maxDepth,
          maxTextBytes: this.config.maxTextBytes,
        },
      },
    }, signal)
  }

  async visualizeCursor(action: BackendCursorAction, phase: 'before' | 'after', signal: AbortSignal): Promise<void> {
    if (this.config.interaction.cursorVisualization !== 'visible') return
    const autoHideMs = this.config.interaction.cursorAutoHideMs
    const move = async (point: { x: number; y: number }, durationMs: number): Promise<void> => {
      await this.client.cursorCommand({
        op: 'move',
        x: point.x,
        y: point.y,
        durationMs,
        autoHideMs,
        targetPid: action.targetPid,
        targetWindowNumber: action.targetWindowNumber,
        targetWindowFrame: action.targetWindowFrame,
      }, signal)
    }
    if (phase === 'after') {
      if (action.kind === 'drag') await this.client.cursorCommand({
        op: 'release',
        autoHideMs,
        targetPid: action.targetPid,
        targetWindowNumber: action.targetWindowNumber,
        targetWindowFrame: action.targetWindowFrame,
      }, signal)
      return
    }
    const start = action.kind === 'drag' ? action.from : action.to
    if (start === undefined) return
    await move(start, this.config.interaction.cursorMotionMs)
    if (this.config.interaction.cursorMotionMs > 0) {
      await delay(this.config.interaction.cursorMotionMs, undefined, { signal })
    }
    if (action.kind === 'scroll') return
    await this.client.cursorCommand({
      op: 'press',
      autoHideMs,
      targetPid: action.targetPid,
      targetWindowNumber: action.targetWindowNumber,
      targetWindowFrame: action.targetWindowFrame,
      sustainedPress: action.kind === 'drag',
    }, signal)
    if (action.kind === 'drag') {
      await move(action.to, Math.max(this.config.interaction.cursorMotionMs, 240))
    }
  }

  async dispose(): Promise<void> {
    await this.client.dispose()
  }

  async health(signal: AbortSignal): Promise<BackendHealth> {
    const prepared = await this.client.prepare(signal)
    const health = await this.client.invoke<NativeHealth>({ command: 'health' }, signal)
    return {
      helperVersion: health.helperVersion || prepared.version,
      helperSha256: prepared.sha256,
      accessibility: health.accessibility,
      screenRecording: health.screenRecording,
    }
  }

  async openSettings(kind: 'accessibility' | 'screen-recording', signal: AbortSignal): Promise<void> {
    await this.client.invoke<null>({ command: 'open-settings', kind }, signal)
  }
}

/** Cordis Service provider loaded by the Bundle before the model-facing consumer. */
export class MacOSComputerUseProvider extends ComputerUseService {
  static inject = ['subprocess', 'approval', 'settings', 'sessions', 'agents']
  static Config = Config

  private readonly settings

  constructor(ctx: Context, config: ComputerUseConfig = {}) {
    if (process.platform !== 'darwin') {
      throw new ComputerUseError('COMPUTER_UNSUPPORTED_PLATFORM', `dsh-computer-use 0.1.0 supports macOS only; current platform is ${process.platform}`)
    }
    const settings = ctx.settings.register(COMPUTER_USE_SETTINGS_NAMESPACE, Config, {
      base: config,
      applies: 'live',
      validate: (value) => { resolveConfig(value) },
    })
    const resolved = resolveConfig(settings.get())
    super(ctx, new MacOSBackend(ctx, resolved), resolved)
    this.settings = settings
    ctx.effect(() => this.settings.watch(async (next) => {
      const candidate = resolveConfig(next)
      const backend = new MacOSBackend(ctx, candidate)
      try {
        await this.reconfigure(backend, candidate)
      } catch (error) {
        await backend.dispose()
        throw error
      }
    }), 'dsh-computer-use: Settings watch')
    ctx.effect(() => ctx.on('agent/disposed', ({ agent }) => { this.releaseAgent(agent) }), 'dsh-computer-use: Agent cleanup')
  }

  /** Verify helper integrity and permissions before the service is injectable. */
  protected async [Service.init](): Promise<void> {
    await this.initialize()
  }
}

export default MacOSComputerUseProvider
