import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { temporaryDirectory } from './helpers.ts'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const HELPER = join(ROOT, 'native', 'macos', 'bin', 'dsh-computer-use-helper')
const FIXTURE_APP = join(ROOT, 'native', 'macos', 'fixture', 'DSHComputerUseFixture.app')
const INPUT_MONITOR = join(ROOT, 'native', 'macos', 'fixture', 'dsh-computer-use-input-monitor')
const BUNDLE_ID = 'io.anionex.dsh-computer-use-fixture'
const LIMITS = { maxNodes: 1000, maxDepth: 20, maxTextBytes: 128000 }
const OBSERVATION_QUIET_MS = 150

interface Envelope<T> {
  ok: boolean
  value?: T
  error?: { code: string; message: string }
}

interface ElementRecord {
  index: number
  locator: number[]
  role: string
  title?: string
  label?: string
  value?: string
  focused?: boolean
  actions: string[]
  frame?: { x: number; y: number; width: number; height: number }
}

interface NativeObservation {
  app: { bundleId: string; pid: number; name: string }
  stateHash: string
  frontmost: boolean
  window: { title?: string; frame: { x: number; y: number; width: number; height: number }; id?: number }
  treeText: string
  truncated: boolean
  elements: ElementRecord[]
  screenshot?: { path: string; width: number; height: number }
  permissions: { accessibility: string; screenRecording: string }
}

interface NativeActionResult {
  channel: 'accessibility' | 'coordinates' | 'keyboard'
  activation: 'not-requested' | 'already-frontmost' | 'activated'
  pointerInput: boolean
  pointerRouting: 'none' | 'target-process'
}

interface InteractionPolicy {
  focusPolicy: 'preserve' | 'activate'
  pointerInputPolicy: 'deny' | 'targeted'
}

interface FixtureTranscript {
  activationCount: number
  pointerClickCount: number
  pointerScrollCount: number
  pointerDragCount: number
  pointerMouseDownCount: number
  pointerMouseUpCount: number
  pointerDragGestureCount: number
}

interface InputMonitorResult {
  baselineCursor: { x: number; y: number }
  finalCursor: { x: number; y: number }
  maximumCursorDistance: number
  baselineFrontmostPid: number
  observedFrontmostPids: number[]
  samples: number
}

const TARGETED_INTERACTION: InteractionPolicy = {
  focusPolicy: 'preserve',
  pointerInputPolicy: 'targeted',
}

const PRESERVE_INTERACTION: InteractionPolicy = {
  focusPolicy: 'preserve',
  pointerInputPolicy: 'deny',
}

async function invokeEnvelope<T>(request: Record<string, unknown>, timeoutMs = 15000): Promise<Envelope<T>> {
  return await new Promise((resolve, reject) => {
    const child = spawn(HELPER, [], { detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`native helper timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout.setEncoding('utf8').on('data', value => { stdout += value })
    child.stderr.setEncoding('utf8').on('data', value => { stderr += value })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', () => {
      clearTimeout(timer)
      try { resolve(JSON.parse(stdout) as Envelope<T>) }
      catch { reject(new Error(`invalid helper JSON: ${stdout || stderr}`)) }
    })
    child.stdin.end(`${JSON.stringify({ protocolVersion: 1, ...request })}\n`)
  })
}

async function invoke<T>(request: Record<string, unknown>, timeoutMs?: number): Promise<T> {
  const envelope = await invokeEnvelope<T>(request, timeoutMs)
  if (envelope.ok !== true || envelope.value === undefined) {
    throw new Error(`${envelope.error?.code ?? 'UNKNOWN'}: ${envelope.error?.message ?? 'native helper failed'}`)
  }
  return envelope.value
}

async function fixtureApps(): Promise<Array<{ bundleId: string; pid: number; name: string }>> {
  const apps = await invoke<Array<{ bundleId: string; pid: number; name: string }>>({ command: 'list-apps' })
  return apps.filter(app => app.bundleId === BUNDLE_ID)
}

async function terminateFixtures(): Promise<void> {
  for (const app of await fixtureApps()) {
    try { process.kill(app.pid, 'SIGTERM') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  const deadline = Date.now() + 5000
  while ((await fixtureApps()).length > 0 && Date.now() < deadline) await delay(50)
}

async function launchFixture(transcript: string): Promise<{ bundleId: string; pid: number; name: string }> {
  const launched = await new Promise<{ code: number; stderr: string }>((resolve, reject) => {
    const child = spawn('open', ['-g', '-n', FIXTURE_APP, '--args', '--background', '--transcript', transcript], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8').on('data', value => { stderr += value })
    child.once('error', reject)
    child.once('close', code => { resolve({ code: code ?? -1, stderr }) })
  })
  if (launched.code !== 0) throw new Error(`fixture background launch failed: ${launched.stderr}`)
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const [app] = await fixtureApps()
    if (app !== undefined) {
      await waitForObservation(app, current => (current.window?.frame.width ?? 0) > 0, 'fixture window to become observable')
      return app
    }
    await delay(50)
  }
  throw new Error('fixture did not become discoverable')
}

async function observeEnvelope(
  app: { bundleId: string; pid: number; name: string },
  screenshotPath?: string,
): Promise<Envelope<NativeObservation>> {
  return await invokeEnvelope<NativeObservation>({
    command: 'observe',
    app,
    options: {
      screenshot: screenshotPath === undefined ? 'none' : 'required',
      ...(screenshotPath === undefined ? {} : { screenshotPath }),
      ...LIMITS,
    },
  })
}

async function observe(app: { bundleId: string; pid: number; name: string }, screenshotPath?: string): Promise<NativeObservation> {
  const envelope = await observeEnvelope(app, screenshotPath)
  if (envelope.ok !== true || envelope.value === undefined) {
    throw new Error(`${envelope.error?.code ?? 'UNKNOWN'}: ${envelope.error?.message ?? 'native helper failed'}`)
  }
  return envelope.value
}

async function act(
  observation: NativeObservation,
  action: Record<string, unknown>,
  element?: ElementRecord,
  interaction: InteractionPolicy = TARGETED_INTERACTION,
): Promise<NativeActionResult> {
  return await invoke<NativeActionResult>({
    command: 'act',
    request: {
      action,
      app: observation.app,
      expectedStateHash: observation.stateHash,
      ...(element === undefined ? {} : { element }),
      window: observation.window,
      interaction,
      actionTimeoutMs: 15000,
      limits: LIMITS,
    },
  })
}

async function fixtureTranscript(path: string): Promise<FixtureTranscript> {
  return JSON.parse(await readFile(path, 'utf8')) as FixtureTranscript
}

async function monitorInput<T>(action: () => Promise<T>): Promise<{ action: T; monitor: InputMonitorResult }> {
  const child = spawn(INPUT_MONITOR, ['--duration-ms', '1200', '--interval-micros', '1000'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', value => { stdout += value })
  child.stderr.setEncoding('utf8').on('data', value => { stderr += value })
  const ready = new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`input monitor did not become ready: ${stderr}`)), 5000)
    const inspect = (): void => {
      if (!stdout.startsWith('READY\n')) return
      clearTimeout(deadline)
      resolve()
    }
    child.stdout.on('data', inspect)
    child.once('error', error => { clearTimeout(deadline); reject(error) })
    inspect()
  })
  await ready
  const actionResult = await action()
  const code = await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', value => { resolve(value ?? -1) })
  })
  if (code !== 0) throw new Error(`input monitor failed (${code}): ${stderr}`)
  const lines = stdout.trim().split(/\r?\n/u)
  if (lines[0] !== 'READY' || lines.length !== 2) throw new Error(`invalid input monitor output: ${stdout || stderr}`)
  return { action: actionResult, monitor: JSON.parse(lines[1]!) as InputMonitorResult }
}

function expectNoForegroundOrCursorInterference(result: InputMonitorResult, targetPid: number): void {
  expect(result.samples).toBeGreaterThan(100)
  expect(result.maximumCursorDistance, JSON.stringify(result)).toBe(0)
  expect(result.finalCursor, JSON.stringify(result)).toEqual(result.baselineCursor)
  expect(result.observedFrontmostPids, JSON.stringify(result)).toEqual([result.baselineFrontmostPid])
  expect(result.baselineFrontmostPid).not.toBe(targetPid)
}

function findElement(observation: NativeObservation, predicate: (element: ElementRecord) => boolean): ElementRecord {
  const element = observation.elements.find(predicate)
  if (element === undefined) throw new Error('expected fixture element was not observed')
  return element
}

async function waitForObservation(
  app: NativeObservation['app'],
  predicate: (observation: NativeObservation) => boolean,
  description: string,
  options: { screenshotPath?: string; timeoutMs?: number } = {},
): Promise<NativeObservation> {
  const deadline = Date.now() + (options.timeoutMs ?? 5000)
  let lastDetail = 'no observation returned'
  while (Date.now() < deadline) {
    const envelope = await observeEnvelope(app, options.screenshotPath)
    if (envelope.ok === true && envelope.value !== undefined) {
      if (predicate(envelope.value)) return envelope.value
      lastDetail = `last state hash ${envelope.value.stateHash}`
    } else {
      const code = envelope.error?.code ?? 'UNKNOWN'
      if (code !== 'COMPUTER_TARGET_UNAVAILABLE') {
        throw new Error(`${code}: ${envelope.error?.message ?? 'native helper failed'}`)
      }
      lastDetail = `${code}: ${envelope.error?.message ?? 'target unavailable'}`
    }
    await delay(50)
  }
  throw new Error(`timed out waiting for ${description}; ${lastDetail}`)
}

async function waitForText(app: NativeObservation['app'], text: string, timeoutMs = 3000): Promise<NativeObservation> {
  return await waitForObservation(app, current => current.treeText.includes(text), `fixture text ${JSON.stringify(text)}`, { timeoutMs })
}

async function stableObserve(
  app: NativeObservation['app'],
  predicate: (observation: NativeObservation) => boolean = () => true,
  description = 'fixture Accessibility state to settle',
  timeoutMs = 3000,
): Promise<NativeObservation> {
  const deadline = Date.now() + timeoutMs
  let stableHash: string | undefined
  let stableSince = 0
  while (Date.now() < deadline) {
    const current = await observe(app)
    if (!predicate(current)) {
      stableHash = undefined
      stableSince = 0
    } else if (stableHash !== current.stateHash) {
      stableHash = current.stateHash
      stableSince = Date.now()
    } else if (Date.now() - stableSince >= OBSERVATION_QUIET_MS) {
      return current
    }
    await delay(50)
  }
  throw new Error(`timed out waiting for ${description}`)
}

describe.skipIf(process.platform !== 'darwin')('real macOS Computer Use fixture', () => {
  it('operates a never-active background app through Accessibility and target-process input', async (testContext) => {
    const health = await invoke<{ accessibility: string; screenRecording: string }>({ command: 'health' })
    if (health.accessibility !== 'granted' || health.screenRecording !== 'granted') {
      if (process.env.DSH_COMPUTER_USE_REQUIRE_TCC === '1') {
        throw new Error(`release lane requires Accessibility and Screen Recording; got ${JSON.stringify(health)}`)
      }
      testContext.skip(`macOS TCC permissions unavailable: ${JSON.stringify(health)}`)
      return
    }

    const temporary = await temporaryDirectory('dsh-computer-native-')
    const transcriptPath = join(temporary.path, 'transcript.json')
    await terminateFixtures()
    let app: NativeObservation['app'] | undefined
    try {
      app = await launchFixture(transcriptPath)
      const screenshot = join(temporary.path, 'window.png')
      let current = await waitForObservation(app, observation => !observation.frontmost, 'background fixture window', { screenshotPath: screenshot })
      expect(current).toMatchObject({
        app: { bundleId: BUNDLE_ID, pid: app.pid },
        frontmost: false,
        truncated: false,
        screenshot: { path: screenshot },
        permissions: { accessibility: 'granted', screenRecording: 'granted' },
      })
      expect((await readFile(screenshot)).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      const secure = findElement(current, element => element.label === 'Secure text')
      expect(secure.value).toBe('[secure]')
      expect(current.treeText).not.toContain('fixture-secret')

      current = await stableObserve(app, observation => !observation.frontmost)
      const original = current
      const delayed = findElement(current, element => element.label === 'Delayed update')
      await expect(act(current, { kind: 'click', elementIndex: delayed.index }, delayed)).resolves.toEqual({
        channel: 'accessibility',
        activation: 'not-requested',
        pointerInput: false,
        pointerRouting: 'none',
      })
      await waitForText(app, 'Status: delayed complete')

      const checkbox = findElement(original, element => element.label === 'Enable deterministic option')
      await expect(act(original, { kind: 'click', elementIndex: checkbox.index }, checkbox)).resolves.toEqual({
        channel: 'accessibility',
        activation: 'not-requested',
        pointerInput: false,
        pointerRouting: 'none',
      })
      current = await stableObserve(
        app,
        observation => !observation.frontmost && observation.treeText.includes('Status: option enabled'),
        'background Accessibility press',
      )
      const stale = await invokeEnvelope({
        command: 'act',
        request: {
          action: { kind: 'click', elementIndex: checkbox.index },
          app: original.app,
          expectedStateHash: original.stateHash,
          element: checkbox,
          window: original.window,
          interaction: TARGETED_INTERACTION,
          actionTimeoutMs: 15000,
          limits: LIMITS,
        },
      })
      expect(stale).toMatchObject({ ok: false, error: { code: 'COMPUTER_STALE_OBSERVATION' } })

      let text = findElement(current, element => element.label === 'Editable text')
      await expect(act(current, { kind: 'set-value', elementIndex: text.index, value: '' }, text)).resolves.toEqual({
        channel: 'accessibility',
        activation: 'not-requested',
        pointerInput: false,
        pointerRouting: 'none',
      })
      current = await stableObserve(app, observation => findElement(observation, element => element.label === 'Editable text').value === '')
      await expect(act(current, { kind: 'type-text', text: 'DeepSeek 深度测试' })).resolves.toEqual({
        channel: 'accessibility',
        activation: 'not-requested',
        pointerInput: false,
        pointerRouting: 'none',
      })
      current = await stableObserve(
        app,
        observation => findElement(observation, element => element.label === 'Editable text').value?.includes('DeepSeek 深度测试') === true,
        'background Accessibility text input',
      )
      await expect(act(current, { kind: 'press-key', key: 'return', modifiers: [] })).resolves.toEqual({
        channel: 'keyboard',
        activation: 'not-requested',
        pointerInput: false,
        pointerRouting: 'none',
      })
      current = await waitForText(app, 'Status: applied DeepSeek 深度测试')

      const slider = findElement(current, element => element.label === 'Fixture slider')
      const sliderBefore = Number(slider.value)
      await expect(act(current, { kind: 'perform-action', elementIndex: slider.index, action: 'AXIncrement' }, slider)).resolves.toEqual({
        channel: 'accessibility',
        activation: 'not-requested',
        pointerInput: false,
        pointerRouting: 'none',
      })
      current = await stableObserve(
        app,
        observation => Number(findElement(observation, element => element.label === 'Fixture slider').value) > sliderBefore,
        'Accessibility slider increment',
      )

      let probe = findElement(current, element => element.label === 'Targeted pointer probe')
      const click = await monitorInput(() => act(current, { kind: 'click', elementIndex: probe.index, allowCoordinateFallback: true }, probe))
      expect(click.action).toEqual({
        channel: 'coordinates',
        activation: 'not-requested',
        pointerInput: true,
        pointerRouting: 'target-process',
      })
      expectNoForegroundOrCursorInterference(click.monitor, app.pid)
      current = await waitForText(app, 'Status: pointer click')
      expect(await fixtureTranscript(transcriptPath)).toMatchObject({
        activationCount: 0,
        pointerClickCount: 1,
        pointerMouseDownCount: 1,
        pointerMouseUpCount: 1,
        pointerDragGestureCount: 0,
      })

      probe = findElement(current, element => element.label === 'Targeted pointer probe')
      const scroll = await monitorInput(() => act(current, { kind: 'scroll', elementIndex: probe.index, direction: 'down', pages: 1 }, probe))
      expect(scroll.action).toEqual({
        channel: 'coordinates',
        activation: 'not-requested',
        pointerInput: true,
        pointerRouting: 'target-process',
      })
      expectNoForegroundOrCursorInterference(scroll.monitor, app.pid)
      current = await waitForText(app, 'Status: pointer scroll')
      expect(await fixtureTranscript(transcriptPath)).toMatchObject({ activationCount: 0, pointerScrollCount: 1 })

      probe = findElement(current, element => element.label === 'Targeted pointer probe')
      if (probe.frame === undefined) throw new Error('targeted pointer probe did not expose a frame')
      const fromX = probe.frame.x - current.window.frame.x + probe.frame.width * 0.25
      const toX = probe.frame.x - current.window.frame.x + probe.frame.width * 0.75
      const y = probe.frame.y - current.window.frame.y + probe.frame.height / 2
      const drag = await monitorInput(() => act(current, { kind: 'drag', fromX, fromY: y, toX, toY: y }))
      expect(drag.action).toEqual({
        channel: 'coordinates',
        activation: 'not-requested',
        pointerInput: true,
        pointerRouting: 'target-process',
      })
      expectNoForegroundOrCursorInterference(drag.monitor, app.pid)
      current = await waitForText(app, 'Status: pointer drag')
      const dragTranscript = await fixtureTranscript(transcriptPath)
      expect(dragTranscript).toMatchObject({
        activationCount: 0,
        pointerClickCount: 1,
        pointerMouseDownCount: 2,
        pointerMouseUpCount: 2,
        pointerDragGestureCount: 1,
      })
      expect(dragTranscript.pointerDragCount).toBeGreaterThan(0)

      expect(current.frontmost).toBe(false)

      process.kill(app.pid, 'SIGTERM')
      await delay(100)
      const afterTermination = await invokeEnvelope({ command: 'resolve-app', selector: { bundleId: app.bundleId, pid: app.pid } })
      expect(afterTermination).toMatchObject({ ok: false, error: { code: 'COMPUTER_APP_NOT_FOUND' } })
    } finally {
      if (app !== undefined) {
        try { process.kill(app.pid, 'SIGKILL') } catch {}
      }
      await terminateFixtures()
      await temporary.cleanup()
    }
  }, 30000)

  it('rejects disabled target-process pointer paths while retaining non-activating Accessibility input', async (testContext) => {
    const health = await invoke<{ accessibility: string }>({ command: 'health' })
    if (health.accessibility !== 'granted') {
      if (process.env.DSH_COMPUTER_USE_REQUIRE_TCC === '1') {
        throw new Error(`release lane requires Accessibility; got ${JSON.stringify(health)}`)
      }
      testContext.skip(`macOS Accessibility permission unavailable: ${JSON.stringify(health)}`)
      return
    }

    const temporary = await temporaryDirectory('dsh-computer-native-policy-')
    await terminateFixtures()
    const transcriptPath = join(temporary.path, 'transcript.json')
    let app: NativeObservation['app'] | undefined
    try {
      app = await launchFixture(transcriptPath)
      let current = await stableObserve(app, observation => !observation.frontmost)
      const checkbox = findElement(current, element => element.label === 'Enable deterministic option')
      await expect(act(current, { kind: 'click', elementIndex: checkbox.index }, checkbox, PRESERVE_INTERACTION)).resolves.toEqual({
        channel: 'accessibility',
        activation: 'not-requested',
        pointerInput: false,
        pointerRouting: 'none',
      })
      current = await stableObserve(app, observation => observation.treeText.includes('Status: option enabled'))
      const probe = findElement(current, element => element.label === 'Targeted pointer probe')
      if (probe.frame === undefined) throw new Error('targeted pointer probe did not expose a frame')
      const x = probe.frame.x - current.window.frame.x + probe.frame.width / 2
      const y = probe.frame.y - current.window.frame.y + probe.frame.height / 2

      await expect(act(current, { kind: 'click', elementIndex: probe.index, allowCoordinateFallback: true }, probe, PRESERVE_INTERACTION))
        .rejects.toThrow(/COMPUTER_ACTION_BLOCKED: this action needs target-process pointer input/)
      await expect(act(current, { kind: 'scroll', elementIndex: probe.index, direction: 'down', pages: 1 }, probe, PRESERVE_INTERACTION))
        .rejects.toThrow(/COMPUTER_ACTION_BLOCKED: this action needs target-process pointer input/)
      await expect(act(current, { kind: 'drag', fromX: x - 10, fromY: y, toX: x + 10, toY: y }, undefined, PRESERVE_INTERACTION))
        .rejects.toThrow(/COMPUTER_ACTION_BLOCKED: this action needs target-process pointer input/)
      expect((await observe(app)).frontmost).toBe(false)
      expect(await fixtureTranscript(transcriptPath)).toMatchObject({
        activationCount: 0,
        pointerClickCount: 0,
        pointerScrollCount: 0,
        pointerDragCount: 0,
        pointerMouseDownCount: 0,
        pointerMouseUpCount: 0,
        pointerDragGestureCount: 0,
      })
    } finally {
      if (app !== undefined) {
        try { process.kill(app.pid, 'SIGKILL') } catch {}
      }
      await terminateFixtures()
      await temporary.cleanup()
    }
  }, 30000)
})
