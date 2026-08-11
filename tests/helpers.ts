import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  BackendActionRequest,
  BackendActionResult,
  BackendHealth,
  BackendObservation,
  BackendObserveOptions,
  ComputerUseBackend,
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
  observation = backendObservation()
  healthValue: BackendHealth = {
    helperVersion: '0.1.0-test',
    helperSha256: 'fixture-sha256',
    accessibility: 'granted',
    screenRecording: 'granted',
  }
  actionChannel: BackendActionResult['channel'] = 'accessibility'

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
    return structuredClone({
      ...this.observation,
      ...(screenshot === undefined ? {} : { screenshot }),
    })
  }

  act(request: BackendActionRequest): Promise<BackendActionResult> {
    if (request.expectedStateHash !== this.observation.stateHash) {
      throw new ComputerUseError('COMPUTER_STALE_OBSERVATION', 'fake UI changed')
    }
    this.actions.push(structuredClone(request))
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
    return Promise.resolve({ channel: this.actionChannel })
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
  const session = {
    id: `session-${id}`,
    header: { cwd: workspace },
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
