/**
 * Acceptance for the whole action surface, judged by the target's own state.
 *
 * Every case here follows one rule: an action counts as working only when the
 * fixture says something changed. A return code is not evidence — the failures
 * worth catching are the ones that answer ok and do nothing, which is how a
 * live session ends up believing it dragged a window that never moved.
 *
 * The existing `native-fixture.e2e.spec.ts` proves the transport and the
 * policies. This proves the verbs, including `drag`, which had no coverage at
 * all before.
 *
 *     DSH_COMPUTER_USE_REQUIRE_TCC=1 npx vitest run tests/action-surface.e2e.spec.ts
 */

import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const HELPER = join(ROOT, 'native', 'macos', 'bin', 'dsh-computer-use-helper')
const FIXTURE_APP = join(ROOT, 'native', 'macos', 'fixture', 'DSHComputerUseFixture.app')
const FIXTURE_BUNDLE = 'io.anionex.dsh-computer-use-fixture'
const LIMITS = { maxNodes: 1000, maxDepth: 20, maxTextBytes: 128000 }
const TARGETED = { focusPolicy: 'preserve', keyboardPolicy: 'preserve', pointerInputPolicy: 'targeted' } as const

const REQUIRE_TCC = process.env.DSH_COMPUTER_USE_REQUIRE_TCC === '1'

interface Element {
  index: number
  role: string
  title?: string
  label?: string
  value?: string
  frame: { x: number; y: number; width: number; height: number }
  targetHandle?: string
}

interface Observation {
  app: { bundleId: string; pid: number; name: string }
  stateHash: string
  frontmost: boolean
  window: { id?: number; title?: string; frame: { x: number; y: number; width: number; height: number } }
  treeText: string
  elements: Element[]
}

interface Envelope<T> { ok: boolean; value?: T; error?: { code: string; message: string } }

let app: { bundleId: string; pid: number; name: string }

async function invoke<T>(request: Record<string, unknown>): Promise<Envelope<T>> {
  return await new Promise((resolve, reject) => {
    const child = spawn(HELPER, [], { detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('native helper timed out')) }, 20_000)
    child.stdout.setEncoding('utf8').on('data', value => { stdout += value })
    child.stderr.setEncoding('utf8').on('data', value => { stderr += value })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', () => {
      clearTimeout(timer)
      try { resolve(JSON.parse(stdout) as Envelope<T>) }
      catch { reject(new Error(`invalid helper JSON: ${stdout || stderr}`)) }
    })
    child.stdin.end(`${JSON.stringify({ protocolVersion: 1, ...request })}\n`)
  })
}

async function observe(): Promise<Observation> {
  const envelope = await invoke<Observation>({
    command: 'observe',
    app,
    options: { screenshot: 'none', ...LIMITS },
  })
  if (!envelope.ok || envelope.value === undefined) {
    throw new Error(`${envelope.error?.code ?? 'UNKNOWN'}: ${envelope.error?.message ?? 'observe failed'}`)
  }
  return envelope.value
}

/** Run one action against a fresh observation, returning the raw envelope. */
async function act(
  action: Record<string, unknown>,
  pick?: (observation: Observation) => Element | undefined,
): Promise<{ envelope: Envelope<Record<string, unknown>>; element?: Element }> {
  const observation = await observe()
  const element = pick?.(observation)
  const envelope = await invoke<Record<string, unknown>>({
    command: 'act',
    request: {
      action: element === undefined ? action : { ...action, elementIndex: element.index },
      app: observation.app,
      expectedStateHash: observation.stateHash,
      ...(element === undefined ? {} : { element }),
      window: observation.window,
      interaction: TARGETED,
      actionTimeoutMs: 15000,
      limits: LIMITS,
    },
  })
  return element === undefined ? { envelope } : { envelope, element }
}

/**
 * The fixture's own status line, polled until it says `expected` — the only
 * honest signal that an action landed.
 */
async function waitForStatus(expected: string, timeoutMs = 6_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    const observation = await observe()
    last = observation.treeText.split('\n').find(line => line.includes('Status:'))?.trim() ?? ''
    if (last.includes(expected)) return last
    await delay(120)
  }
  throw new Error(`fixture never reported "${expected}"; last status was "${last}"`)
}

function findByLabel(observation: Observation, needle: string): Element | undefined {
  return observation.elements.find(element =>
    [element.title, element.label, element.value].some(text => text?.includes(needle)))
}

async function fixturePids(): Promise<number[]> {
  const listed = await new Promise<string>(resolve => {
    const child = spawn('pgrep', ['-f', 'DSHComputerUseFixture'], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    child.stdout.setEncoding('utf8').on('data', value => { out += value })
    child.once('close', () => resolve(out))
    child.once('error', () => resolve(''))
  })
  return listed.trim().split(/\s+/u).filter(Boolean).map(Number).filter(Number.isInteger)
}

async function terminateFixtures(): Promise<void> {
  for (const pid of await fixturePids()) {
    try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ }
  }
  await delay(250)
}

describe.skipIf(!REQUIRE_TCC)('action surface, verified by the target', () => {
  beforeAll(async () => {
    await terminateFixtures()
    await new Promise<void>((resolve, reject) => {
      const child = spawn('open', ['-g', '-n', FIXTURE_APP, '--args', '--background'], { stdio: ['ignore', 'ignore', 'pipe'] })
      child.once('error', reject)
      child.once('close', code => code === 0 ? resolve() : reject(new Error(`fixture launch failed (${String(code)})`)))
    })
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      for (const pid of await fixturePids()) {
        app = { bundleId: FIXTURE_BUNDLE, pid, name: 'DSHComputerUseFixture' }
        try {
          const observation = await observe()
          if (observation.window.frame.width > 0) return
        } catch { /* not observable yet */ }
      }
      await delay(150)
    }
    throw new Error('fixture never became observable')
  }, 40_000)

  afterAll(async () => { await terminateFixtures() })

  it('drag moves the pointer through the target, not just the API', async () => {
    // The verb with no coverage before this, and the one that failed silently
    // in a live session: the window never moved while the call answered ok.
    const observation = await observe()
    const { frame } = observation.window
    const from = { x: Math.round(frame.x + frame.width * 0.3), y: Math.round(frame.y + frame.height * 0.55) }
    const to = { x: Math.round(frame.x + frame.width * 0.7), y: Math.round(frame.y + frame.height * 0.75) }

    const { envelope } = await act({
      kind: 'drag',
      fromX: from.x, fromY: from.y, toX: to.x, toY: to.y,
      coordinateSpace: 'screen',
    })
    expect(envelope, JSON.stringify(envelope)).toMatchObject({ ok: true })

    // The fixture distinguishes a click from a drag, so this cannot pass on a
    // press alone.
    const status = await waitForStatus('pointer drag')
    expect(status).toContain('pointer drag')
  }, 40_000)

  it('scroll reaches the target', async () => {
    const observation = await observe()
    const { frame } = observation.window
    const { envelope } = await act({
      kind: 'scroll',
      x: Math.round(frame.x + frame.width * 0.5),
      y: Math.round(frame.y + frame.height * 0.55),
      direction: 'down',
      pages: 1,
      coordinateSpace: 'screen',
    })
    expect(envelope, JSON.stringify(envelope)).toMatchObject({ ok: true })
    expect(await waitForStatus('pointer scroll')).toContain('pointer scroll')
  }, 40_000)

  it('a coordinate click registers as a click, not a drag', async () => {
    const observation = await observe()
    const { frame } = observation.window
    const { envelope } = await act({
      kind: 'click',
      x: Math.round(frame.x + frame.width * 0.5),
      y: Math.round(frame.y + frame.height * 0.55),
      coordinateSpace: 'screen',
    })
    expect(envelope, JSON.stringify(envelope)).toMatchObject({ ok: true })
    expect(await waitForStatus('pointer click')).toContain('pointer click')
  }, 40_000)

  it('set-value puts text where the target can read it back', async () => {
    const stamp = `acceptance-${String(Date.now() % 100000)}`
    const { envelope } = await act(
      { kind: 'set-value', value: stamp },
      observation => observation.elements.find(element => element.role === 'AXTextField'),
    )
    expect(envelope, JSON.stringify(envelope)).toMatchObject({ ok: true })

    const applied = await act(
      { kind: 'click' },
      observation => findByLabel(observation, 'Apply'),
    )
    expect(applied.envelope, JSON.stringify(applied.envelope)).toMatchObject({ ok: true })
    expect(await waitForStatus(`applied ${stamp}`)).toContain(stamp)
  }, 40_000)

  it('an accessibility press toggles the target checkbox', async () => {
    const before = await observe()
    const enabled = before.treeText.includes('Status: option enabled')
    const { envelope } = await act(
      { kind: 'click' },
      observation => observation.elements.find(element => element.role === 'AXCheckBox'),
    )
    expect(envelope, JSON.stringify(envelope)).toMatchObject({ ok: true })
    expect(await waitForStatus(enabled ? 'option disabled' : 'option enabled')).toContain('option')
  }, 40_000)

  it('refuses a stale observation instead of acting on a guess', async () => {
    // The safety property that makes everything above trustworthy: an action
    // bound to an observation that no longer holds must not be retargeted.
    const stale = await observe()
    await act({ kind: 'click' }, observation => observation.elements.find(element => element.role === 'AXCheckBox'))
    await delay(400)
    const envelope = await invoke({
      command: 'act',
      request: {
        action: { kind: 'click', elementIndex: 0 },
        app: stale.app,
        expectedStateHash: stale.stateHash,
        element: stale.elements.find(element => element.role === 'AXCheckBox'),
        window: stale.window,
        interaction: TARGETED,
        actionTimeoutMs: 15000,
        limits: LIMITS,
      },
    })
    expect(envelope).toMatchObject({ ok: false, error: { code: 'COMPUTER_STALE_OBSERVATION' } })
  }, 40_000)

  it('never activates the target while doing any of this', async () => {
    // Everything above is worthless if it steals the user's foreground.
    const observation = await observe()
    expect(observation.frontmost, 'the fixture must still be a background app').toBe(false)
  }, 20_000)
})
