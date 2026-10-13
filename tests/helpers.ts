import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  BackendActionRequest,
  BackendActionResult,
  BackendCursorActivation,
  BackendTrackedDragResult,
  BackendCursorAction,
  BackendHealth,
  BackendObservation,
  BackendObserveOptions,
  BackendVisualSignature,
  ComputerUseBackend,
  CursorVisibility,
} from '../src/backend.ts'
import { ComputerUseError } from '../src/errors.ts'
import type { ComputerAppIdentity, ComputerAppSelector, ComputerAppSummary } from '../src/types.ts'

export async function temporaryDirectory(prefix: string): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), prefix))
  return { path, cleanup: async () => await rm(path, { recursive: true, force: true }) }
}

export const FIXTURE_APP: ComputerAppIdentity = {
  bundleId: 'io.anionex.dsh-computer-use-fixture',
  pid: 4242,
  name: 'DSH Computer Use Fixture',
}

/**
 * Uniform luminance grid standing in for one provider pixel sample set.
 *
 * The four-by-four side keeps a single moved cell at 6.25% of the grid, so a
 * test can move exactly one cell and still cross the reporting threshold.
 */
export function visualSignatureGrid(fill: number, side = 4): BackendVisualSignature {
  return {
    side,
    bytes: Buffer.from(Array.from({ length: side * side }, () => fill)).toString('base64'),
  }
}

export function backendObservation(overrides: Partial<BackendObservation> = {}): BackendObservation {
  return {
    app: FIXTURE_APP,
    stateHash: 'state-1',
    frontmost: true,
    window: {
      title: 'DSH Computer Use Fixture',
      id: 7,
      frame: { x: 100, y: 200, width: 760, height: 592 },
    },
    treeText: '[0] AXWindow "DSH Computer Use Fixture"\n  [1] AXButton "Apply"',
    truncated: false,
    elements: [{
      index: 0,
      locator: [],
      role: 'AXWindow',
      title: 'DSH Computer Use Fixture',
      actions: [],
      frame: { x: 100, y: 200, width: 760, height: 592 },
    }, {
      index: 1,
      locator: [0],
      role: 'AXButton',
      title: 'Apply',
      enabled: true,
      actions: ['AXPress'],
      frame: { x: 220, y: 320, width: 80, height: 28 },
    }],
    permissions: { accessibility: 'granted', screenRecording: 'granted' },
    ...overrides,
  }
}

export class FakeBackend implements ComputerUseBackend {
  readonly name = 'macos-ax' as const
  readonly helperPath = '/fixture/dsh-computer-use-helper'
  readonly actions: BackendActionRequest[] = []
  readonly observations: BackendObserveOptions[] = []
  readonly openedSettings: Array<'accessibility' | 'screen-recording'> = []
  readonly cursorActions: Array<{ action: BackendCursorAction; phase: 'before' | 'during' | 'after' }> = []
  readonly cursorSignals: AbortSignal[] = []
  readonly cursorActivations: string[] = []
  disposed = false
  observation = backendObservation()
  healthValue: BackendHealth = {
    helperVersion: '0.1.0-test',
    helperSha256: 'fixture-sha256',
    accessibility: 'granted',
    screenRecording: 'granted',
  }
  actionChannel: BackendActionResult['channel'] = 'accessibility'
  actionActivation: BackendActionResult['activation'] = 'not-requested'
  actionPointerInput = false
  actionPointerRouting: BackendActionResult['pointerRouting'] = 'none'

  resolveApp(selector: ComputerAppSelector): Promise<ComputerAppIdentity> {
    const matches = selector.bundleId === undefined || selector.bundleId === this.observation.app.bundleId
    const matchesPid = selector.pid === undefined || selector.pid === this.observation.app.pid
    const matchesName = selector.name === undefined || selector.name === this.observation.app.name
    if (!matches || !matchesPid || !matchesName) {
      throw new ComputerUseError('COMPUTER_APP_NOT_FOUND', 'fake app selector did not match')
    }
    return Promise.resolve(this.observation.app)
  }

  listApps(): Promise<ComputerAppSummary[]> {
    return Promise.resolve([{
      ...this.observation.app,
      frontmost: this.observation.frontmost,
      accessibility: this.observation.permissions.accessibility,
      screenRecording: this.observation.permissions.screenRecording,
    }])
  }

  async observe(_app: ComputerAppIdentity, options: BackendObserveOptions): Promise<BackendObservation> {
    this.observations.push(structuredClone(options))
    let screenshot: BackendObservation['screenshot']
    if (options.screenshot !== 'none') {
      if (options.screenshotPath === undefined) throw new Error('fake screenshot needs screenshotPath')
      await writeFile(options.screenshotPath, Buffer.from('fake-png'))
      screenshot = { path: options.screenshotPath, width: 760, height: 592 }
    }
    const observation: BackendObservation = { ...this.observation }
    // The fake provider reports luminance only when the caller asks for it, so a
    // test can prove that a plain observation stays pixel-free.
    delete observation.visualSignature
    if (options.visualSignature === true && this.visualSignature !== undefined) {
      observation.visualSignature = this.visualSignature
    }
    if (screenshot !== undefined) observation.screenshot = screenshot
    return structuredClone(observation)
  }

  activateForCursor(_app: ComputerAppIdentity, expectedStateHash: string): Promise<BackendCursorActivation> {
    if (expectedStateHash !== this.observation.stateHash) {
      throw new ComputerUseError('COMPUTER_STALE_OBSERVATION', 'fake UI changed before activation')
    }
    this.cursorActivations.push(expectedStateHash)
    const activation = this.observation.frontmost ? 'already-frontmost' : 'activated'
    this.observation = backendObservation({ ...this.observation, frontmost: true })
    return Promise.resolve({ observation: structuredClone(this.observation), activation })
  }

  /**
   * When true the action is accepted and the observation is left untouched,
   * standing in for a target that received the input and did nothing with it —
   * a drag onto a title bar, a click on inert canvas.
   */
  inert = false

  /** Luminance grid the fake provider reports when a caller asks for one. */
  visualSignature: BackendVisualSignature | undefined

  /**
   * Luminance grid the fake provider reports after an inert action, standing in
   * for a target that received the input and repainted without moving its
   * Accessibility tree.
   */
  inertVisualSignature: BackendVisualSignature | undefined

  act(request: BackendActionRequest): Promise<BackendActionResult> {
    if (request.expectedStateHash !== this.observation.stateHash) {
      throw new ComputerUseError('COMPUTER_STALE_OBSERVATION', 'fake UI changed')
    }
    this.actions.push(structuredClone(request))
    if (this.inert) {
      if (this.inertVisualSignature !== undefined) this.visualSignature = this.inertVisualSignature
      return Promise.resolve({
        channel: 'coordinates',
        activation: 'not-requested',
        pointerInput: true,
        pointerRouting: 'target-process',
      })
    }
    const sequence = this.actions.length + 1
    this.observation = backendObservation({
      ...this.observation,
      stateHash: `state-${sequence}`,
      treeText: `${this.observation.treeText}\n  [2] AXStaticText "Action ${sequence - 1}"`,
      elements: [...this.observation.elements, {
        index: this.observation.elements.length,
        locator: [sequence],
        role: 'AXStaticText',
        value: `Action ${sequence - 1}`,
        actions: [],
      }],
    })
    return Promise.resolve({
      channel: this.actionChannel,
      activation: this.actionActivation,
      pointerInput: this.actionPointerInput,
      pointerRouting: this.actionPointerRouting,
    })
  }

  async actDragWithCursor(
    request: BackendActionRequest,
    cursor: BackendCursorAction & { kind: 'drag' },
    signal: AbortSignal,
  ): Promise<BackendTrackedDragResult> {
    const [action, cursorResult] = await Promise.all([
      this.act(request),
      this.visualizeCursor(cursor, 'during', signal),
    ])
    return { action, cursor: cursorResult }
  }

  /** Overridable so a test can make the agent cursor fail to show. */
  cursorVisibility: CursorVisibility = { visible: true }

  visualizeCursor(action: BackendCursorAction, phase: 'before' | 'during' | 'after', signal: AbortSignal): Promise<CursorVisibility> {
    this.cursorActions.push({ action: structuredClone(action), phase })
    this.cursorSignals.push(signal)
    return Promise.resolve(this.cursorVisibility)
  }

  dispose(): Promise<void> {
    this.disposed = true
    return Promise.resolve()
  }

  health(): Promise<BackendHealth> {
    return Promise.resolve(structuredClone(this.healthValue))
  }

  openSettings(kind: 'accessibility' | 'screen-recording'): Promise<void> {
    this.openedSettings.push(kind)
    return Promise.resolve()
  }
}

interface FakeSessionEvent {
  type: string
  data: Record<string, unknown>
}

export function fakeAgent(workspace: string, id = 'agent-1'): Agent & { session: Agent['session'] & { events: FakeSessionEvent[] } } {
  const events: FakeSessionEvent[] = [{ type: 'turn/start', data: { turn: 1 } }]
  const sessionId = `session-${id}`
  const session = {
    id: sessionId,
    header: { version: 0, id: sessionId, createdAt: 1_700_000_000_000, cwd: workspace },
    events,
    append(type: string, data: Record<string, unknown>) {
      events.push({ type, data })
    },
  }
  return {
    id,
    session,
    ctx: {},
  } as unknown as Agent & { session: Agent['session'] & { events: FakeSessionEvent[] } }
}
