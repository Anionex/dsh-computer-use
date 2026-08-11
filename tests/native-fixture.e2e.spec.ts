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

async function invokeEnvelope<T>(request: Record<string, unknown>, timeoutMs = 15000): Promise<Envelope<T>> {
  return await new Promise((resolve, reject) => {
    const child = spawn(HELPER, [], { stdio: ['pipe', 'pipe', 'pipe'] })
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
  await new Promise<void>((resolve, reject) => {
    const child = spawn('open', ['-n', FIXTURE_APP, '--args', '--transcript', transcript], { stdio: 'ignore' })
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`open exited ${String(code)}`)))
  })
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
): Promise<{ channel: string }> {
  return await invoke({
    command: 'act',
    request: {
      action,
      app: observation.app,
      expectedStateHash: observation.stateHash,
      ...(element === undefined ? {} : { element }),
      window: observation.window,
      actionTimeoutMs: 15000,
      limits: LIMITS,
    },
  })
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
  it('covers discovery, AX state, screenshots, every action channel, staleness, redaction, and termination', async (testContext) => {
    const health = await invoke<{ accessibility: string; screenRecording: string }>({ command: 'health' })
    if (health.accessibility !== 'granted' || health.screenRecording !== 'granted') {
      if (process.env.DSH_COMPUTER_USE_REQUIRE_TCC === '1') {
        throw new Error(`release lane requires Accessibility and Screen Recording; got ${JSON.stringify(health)}`)
      }
      testContext.skip(`macOS TCC permissions unavailable: ${JSON.stringify(health)}`)
      return
    }

    const temporary = await temporaryDirectory('dsh-computer-native-')
    await terminateFixtures()
    let app: NativeObservation['app'] | undefined
    try {
      app = await launchFixture(join(temporary.path, 'transcript.json'))
      const screenshot = join(temporary.path, 'window.png')
      let current = await waitForObservation(app, () => true, 'fixture window to become capturable', { screenshotPath: screenshot })
      expect(current).toMatchObject({
        app: { bundleId: BUNDLE_ID, pid: app.pid },
        truncated: false,
        screenshot: { path: screenshot, width: 760, height: 592 },
        permissions: { accessibility: 'granted', screenRecording: 'granted' },
      })
      expect((await readFile(screenshot)).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      const secure = findElement(current, element => element.label === 'Secure text')
      expect(secure.value).toBe('[secure]')
      expect(current.treeText).not.toContain('fixture-secret')

      current = await stableObserve(app)

      const original = current
      const checkbox = findElement(current, element => element.label === 'Enable deterministic option')
      const transientUpdate = findElement(current, element => element.label === 'Delayed update')
      await expect(act(current, { kind: 'click', elementIndex: transientUpdate.index }, transientUpdate)).resolves.toEqual({ channel: 'accessibility' })
      await waitForText(app, 'Status: delayed complete')
      await expect(act(original, { kind: 'click', elementIndex: checkbox.index }, checkbox)).resolves.toEqual({ channel: 'accessibility' })
      current = await stableObserve(
        app,
        observation => observation.treeText.includes('Status: option enabled'),
        'enabled option state to settle',
      )
      expect(findElement(current, element => element.label === 'Enable deterministic option').value).toBe('1')
      const stale = await invokeEnvelope({
        command: 'act',
        request: {
          action: { kind: 'click', elementIndex: checkbox.index },
          app: original.app,
          expectedStateHash: original.stateHash,
          element: checkbox,
          window: original.window,
          actionTimeoutMs: 15000,
          limits: LIMITS,
        },
      })
      expect(stale).toMatchObject({ ok: false, error: { code: 'COMPUTER_STALE_OBSERVATION' } })

      let text = findElement(current, element => element.label === 'Editable text')
      await expect(act(current, { kind: 'set-value', elementIndex: text.index, value: '' }, text)).resolves.toEqual({ channel: 'accessibility' })
      current = await stableObserve(
        app,
        observation => findElement(observation, element => element.label === 'Editable text').value === '',
        'editable text to clear',
      )
      text = findElement(current, element => element.label === 'Editable text')
      await expect(act(current, { kind: 'click', elementIndex: text.index, allowCoordinateFallback: true }, text)).resolves.toEqual({ channel: 'coordinates' })
      current = await stableObserve(
        app,
        observation => findElement(observation, element => element.label === 'Editable text').focused === true,
        'editable text to receive keyboard focus',
      )
      await expect(act(current, { kind: 'type-text', text: 'DeepSeek 深度测试' })).resolves.toEqual({ channel: 'accessibility' })
      current = await stableObserve(
        app,
        observation => findElement(observation, element => element.label === 'Editable text').value?.includes('DeepSeek 深度测试') === true,
        'typed Unicode text to appear',
      )
      await expect(act(current, { kind: 'press-key', key: 'return', modifiers: [] })).resolves.toEqual({ channel: 'keyboard' })
      current = await waitForText(app, 'Status: applied DeepSeek 深度测试')

      const slider = findElement(current, element => element.label === 'Fixture slider')
      const sliderBefore = Number(slider.value)
      await expect(act(current, { kind: 'perform-action', elementIndex: slider.index, action: 'AXIncrement' }, slider)).resolves.toEqual({ channel: 'accessibility' })
      current = await stableObserve(
        app,
        observation => Number(findElement(observation, element => element.label === 'Fixture slider').value) > sliderBefore,
        'Accessibility slider increment',
      )

      const scrollArea = findElement(current, element => element.role === 'AXScrollArea')
      await expect(act(current, { kind: 'scroll', elementIndex: scrollArea.index, direction: 'down', pages: 1 }, scrollArea)).resolves.toEqual({ channel: 'coordinates' })
      current = await stableObserve(app)

      const dragSlider = findElement(current, element => element.label === 'Fixture slider')
      const dragBefore = Number(dragSlider.value)
      const dragFrame = dragSlider.frame
      if (dragFrame === undefined) throw new Error('fixture slider did not expose a frame')
      const windowFrame = current.window.frame
      const y = dragFrame.y - windowFrame.y + dragFrame.height / 2
      const fromX = dragFrame.x - windowFrame.x + dragFrame.width * 0.25
      const toX = dragFrame.x - windowFrame.x + dragFrame.width * 0.75
      await expect(act(current, { kind: 'drag', fromX, fromY: y, toX, toY: y })).resolves.toEqual({ channel: 'coordinates' })
      current = await stableObserve(
        app,
        observation => Number(findElement(observation, element => element.label === 'Fixture slider').value) > dragBefore,
        'coordinate slider drag',
      )

      const delayed = findElement(current, element => element.label === 'Delayed update')
      await act(current, { kind: 'click', elementIndex: delayed.index }, delayed)
      current = await waitForText(app, 'Status: delayed complete')
      expect(current.stateHash).not.toBe(original.stateHash)

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
})
