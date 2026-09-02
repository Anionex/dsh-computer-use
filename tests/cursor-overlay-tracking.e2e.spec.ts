/**
 * Does the agent cursor actually go where it is told?
 *
 * The overlay is the visible half of the co-driving promise: the user is meant
 * to see where the agent is working. `native-fixture.e2e.spec.ts` covers the
 * other half well — the real cursor must not move and focus must not change —
 * but it never asserts that the overlay panel itself reached the requested
 * point. A cursor frozen in one place, or hidden outright, satisfies every
 * assertion that suite makes.
 *
 * Two failures live here. The first needs no window at all: `move` answers
 * ok:true whatever happens, because `CursorOverlayController.show` returns
 * void and a failed `targetWindowIsCurrent` check hides the panel and returns
 * early. The second binds a real fixture window, which is the shape a live
 * session uses, and checks the panel tracks across several points.
 *
 *     DSH_COMPUTER_USE_REQUIRE_TCC=1 npx vitest run tests/cursor-overlay-tracking.e2e.spec.ts
 */

import { spawn } from 'node:child_process'
import { access, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { afterAll, describe, expect, it } from 'vitest'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const HELPER = join(ROOT, 'native', 'macos', 'bin', 'dsh-computer-use-helper')
const INPUT_MONITOR = join(ROOT, 'native', 'macos', 'fixture', 'dsh-computer-use-input-monitor')
const FIXTURE_APP = join(ROOT, 'native', 'macos', 'fixture', 'DSHComputerUseFixture.app')
const ACTIVATION_TRIGGER = join(tmpdir(), `dsh-computer-use-activation-${process.pid}`)
const ACTIVATION_RELEASE_TRIGGER = join(tmpdir(), `dsh-computer-use-activation-release-${process.pid}`)

const REQUIRE_TCC = process.env.DSH_COMPUTER_USE_REQUIRE_TCC === '1'

interface WindowBinding {
  targetPid: number
  targetWindowNumber: number
  targetWindowFrame: { x: number; y: number; width: number; height: number }
}

/** Running fixture processes, by pid. */
async function fixturePids(): Promise<number[]> {
  const listed = await new Promise<string>((resolve) => {
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
  await delay(200)
}

/** Launch the fixture and return a usable window binding in the requested foreground state. */
async function launchBoundFixture(background = false): Promise<WindowBinding> {
  await terminateFixtures()
  await rm(ACTIVATION_TRIGGER, { force: true })
  await rm(ACTIVATION_RELEASE_TRIGGER, { force: true })
  await writeFile(ACTIVATION_TRIGGER, '')
  await new Promise<void>((resolve, reject) => {
    const args = [
      '-n', FIXTURE_APP, '--args',
      '--activation-trigger', ACTIVATION_TRIGGER,
      '--activation-release-trigger', ACTIVATION_RELEASE_TRIGGER,
    ]
    const child = spawn('open', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`fixture launch failed (${String(code)})`)))
  })
  const deadline = Date.now() + 12_000
  let lastProbe: unknown
  while (Date.now() < deadline) {
    const pids = await fixturePids()
    if (pids.length === 0) lastProbe = { pids }
    for (const pid of pids) {
      const monitored = await monitorWindows(pid, 80)
      const frame = monitored.matchingWindowFrames.at(-1)
      const windowNumber = monitored.matchingWindowNumbers.at(-1)
      lastProbe = { pid, frame, windowNumber }
      if (frame !== undefined && windowNumber !== undefined && frame.Width > 0) {
        const binding = {
          targetPid: pid,
          targetWindowNumber: windowNumber,
          targetWindowFrame: { x: frame.X, y: frame.Y, width: frame.Width, height: frame.Height },
        }
        if (background) await deactivateFixture(binding)
        else await activateFixture(binding)
        return binding
      }
    }
    await delay(100)
  }
  throw new Error(`fixture never exposed an observable window: ${JSON.stringify(lastProbe)}`)
}

async function activateFixture(binding: WindowBinding): Promise<void> {
  await writeFile(ACTIVATION_TRIGGER, '')
  const deadline = Date.now() + 5_000
  let acknowledged = false
  while (Date.now() < deadline) {
    acknowledged ||= await access(ACTIVATION_TRIGGER).then(() => false, () => true)
    if (!acknowledged) {
      await delay(20)
      continue
    }
    const monitored = await monitorWindows(binding.targetPid, 80)
    if (monitored.finalFrontmostPid === binding.targetPid
      && monitored.observedFrontmostPids.length === 1
      && monitored.observedFrontmostPids[0] === binding.targetPid) return
    await delay(50)
  }
  throw new Error('fixture did not acknowledge and hold foreground activation')
}

async function deactivateFixture(binding: WindowBinding): Promise<void> {
  await writeFile(ACTIVATION_RELEASE_TRIGGER, '')
  await delay(100)
  await new Promise<void>((resolve, reject) => {
    const child = spawn('open', ['-n', FIXTURE_APP, '--args', '--activation-only'], { stdio: ['ignore', 'ignore', 'pipe'] })
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`foreground fixture launch failed (${String(code)})`)))
  })
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const monitored = await monitorWindows(binding.targetPid, 80)
    if (monitored.finalFrontmostPid !== undefined && monitored.finalFrontmostPid !== binding.targetPid) return
    await delay(50)
  }
  throw new Error('fixture did not leave the foreground')
}

interface WindowMonitorPayload {
  matchingWindowFrames: Array<{ X: number; Y: number; Width: number; Height: number }>
  matchingWindowNumbers: number[]
  finalFrontmostPid?: number
  observedFrontmostPids: number[]
}

async function monitorWindows(ownerPid: number, durationMs: number): Promise<WindowMonitorPayload> {
  const child = spawn(INPUT_MONITOR, [
    '--duration-ms', String(durationMs), '--interval-micros', '2000', '--window-owner-pid', String(ownerPid),
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', value => { stdout += value })
  child.stderr.setEncoding('utf8').on('data', value => { stderr += value })
  const code = await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', value => resolve(value ?? -1))
  })
  if (code !== 0) throw new Error(`input monitor failed (${code}): ${stderr}`)
  const lines = stdout.trim().split(/\r?\n/u)
  return JSON.parse(lines[lines.length - 1]!) as WindowMonitorPayload
}

async function overlayFrames(overlayPid: number, durationMs = 80): Promise<Array<{ x: number; y: number }>> {
  const payload = await monitorWindows(overlayPid, durationMs)
  return payload.matchingWindowFrames.map(frame => ({ x: frame.X, y: frame.Y }))
}

/** Where the overlay panel is right now, or undefined when it has no window. */
async function overlayFrame(overlayPid: number): Promise<{ x: number; y: number } | undefined> {
  const [frame] = await overlayFrames(overlayPid)
  return frame
}

/**
 * An overlay process kept alive across several commands, so the panel can be
 * sampled between them. `runOverlayProtocol` in the sibling suite sends every
 * command in one burst and cannot observe intermediate positions.
 */
async function openOverlay(): Promise<{
  pid: number
  send: (command: Record<string, unknown>) => void
  responses: () => Array<Record<string, unknown>>
  close: () => Promise<Array<Record<string, unknown>>>
}> {
  const child = spawn(HELPER, ['--cursor-overlay'], { detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const pid = child.pid
  if (pid === undefined) {
    child.kill('SIGKILL')
    throw new Error('cursor overlay did not expose its pid')
  }
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', value => { stdout += value })
  child.stderr.setEncoding('utf8').on('data', value => { stderr += value })
  const closed = new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', value => resolve(value ?? -1))
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(`cursor overlay never became ready: ${stdout || stderr}`)), 8_000)
      child.stdout.on('data', () => {
        if (!stdout.includes('\n')) return
        const [line] = stdout.split(/\r?\n/u)
        let ready: { ok?: unknown; ready?: unknown }
        try {
          ready = JSON.parse(line!) as { ok?: unknown; ready?: unknown }
        } catch (error) {
          clearTimeout(deadline)
          reject(error)
          return
        }
        clearTimeout(deadline)
        if (ready.ok !== true || ready.ready !== true) reject(new Error(`unexpected ready frame: ${line}`))
        else resolve()
      })
      child.once('error', error => { clearTimeout(deadline); reject(error) })
    })
  } catch (error) {
    child.kill('SIGKILL')
    await closed.catch(() => undefined)
    throw error
  }
  let closing: Promise<Array<Record<string, unknown>>> | undefined
  return {
    pid,
    send: command => { child.stdin.write(`${JSON.stringify(command)}\n`) },
    responses: () => stdout.trim().split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>),
    close: () => {
      closing ??= (async () => {
        if (!child.stdin.destroyed) child.stdin.end(`${JSON.stringify({ op: 'stop' })}\n`)
        const code = await closed
        if (code !== 0) throw new Error(`cursor overlay exited ${String(code)}: ${stdout || stderr}`)
        return stdout.trim().split(/\r?\n/u).map(line => JSON.parse(line) as Record<string, unknown>)
      })()
      return closing
    },
  }
}

describe.skipIf(!REQUIRE_TCC)('agent cursor overlay tracking', () => {
  afterAll(async () => {
    await terminateFixtures()
    await rm(ACTIVATION_TRIGGER, { force: true })
    await rm(ACTIVATION_RELEASE_TRIGGER, { force: true })
  })

  it('does not report success for a move that shows nothing', async () => {
    const overlay = await openOverlay()
    let responses: Array<Record<string, unknown>>
    let panel: { x: number; y: number } | undefined
    try {
      // A fresh process has no visible panel, and validation without a stable
      // binding must also report invisible rather than optimistic success.
      overlay.send({ op: 'ping' })
      overlay.send({ op: 'validate' })
      // No window binding: `targetWindowIsCurrent` requires pid, window number
      // and frame, so the move fails closed and leaves the panel hidden.
      overlay.send({ op: 'move', x: 420, y: 420, durationMs: 0, autoHideMs: 0 })
      await delay(400)
      panel = await overlayFrame(overlay.pid)
    } finally {
      responses = await overlay.close()
    }
    const pings = responses.filter(entry => entry.op === 'ping')
    const validations = responses.filter(entry => entry.op === 'validate')
    const moves = responses.filter(entry => entry.op === 'move')
    expect(pings, JSON.stringify(responses)).toHaveLength(1)
    expect(pings[0]!.visible, JSON.stringify(responses)).toBe(false)
    expect(validations, JSON.stringify(responses)).toHaveLength(1)
    expect(validations[0]!.visible, JSON.stringify(responses)).toBe(false)
    expect(moves, JSON.stringify(responses)).toHaveLength(1)

    // The command is not an error -- native input is unaffected -- but the
    // response must say the panel is not on screen, and why.
    expect(
      { visible: moves[0]!.visible, panelExists: panel !== undefined },
      `a move must report its own visibility: ${JSON.stringify(responses)}`,
    ).toEqual({ visible: false, panelExists: false })
    expect(String(moves[0]!.reason ?? ''), JSON.stringify(responses)).toContain('hidden')
  }, 40_000)

  it('keeps the cursor hidden when the bound application is not frontmost', async () => {
    const binding = await launchBoundFixture(true)
    const overlay = await openOverlay()
    let responses: Array<Record<string, unknown>>
    let panel: { x: number; y: number } | undefined
    try {
      const { x, y, width, height } = binding.targetWindowFrame
      overlay.send({
        op: 'move',
        x: Math.round(x + width * 0.5),
        y: Math.round(y + height * 0.5),
        durationMs: 0,
        autoHideMs: 0,
        ...binding,
      })
      await delay(400)
      panel = await overlayFrame(overlay.pid)
    } finally {
      responses = await overlay.close()
      await terminateFixtures()
    }
    const [move] = responses.filter(entry => entry.op === 'move')
    expect({ visible: move?.visible, panelExists: panel !== undefined }, JSON.stringify(responses))
      .toEqual({ visible: false, panelExists: false })
    expect(String(move?.reason ?? '')).toContain('not frontmost')
    expect(move?.reasonCode).toBe('target-not-frontmost')
  }, 40_000)

  it('hides immediately when a visible target leaves the foreground mid-glide', async () => {
    const binding = await launchBoundFixture()
    const overlay = await openOverlay()
    let visibleDuringGlide: { x: number; y: number } | undefined
    let hiddenAfterFocusLoss: { x: number; y: number } | undefined
    let responses: Array<Record<string, unknown>> = []
    try {
      // Opening the overlay gives the host time to restore its prior app. Reassert
      // the target immediately before the move so this case starts visibly.
      await activateFixture(binding)
      const { x, y, width, height } = binding.targetWindowFrame
      overlay.send({
        op: 'move',
        x: Math.round(x + width * 0.8),
        y: Math.round(y + height * 0.75),
        durationMs: 1_000,
        autoHideMs: 0,
        ...binding,
      })
      await delay(120)
      visibleDuringGlide = await overlayFrame(overlay.pid)
      await deactivateFixture(binding)
      await delay(100)
      hiddenAfterFocusLoss = await overlayFrame(overlay.pid)
    } finally {
      responses = await overlay.close()
      await terminateFixtures()
    }
    expect(visibleDuringGlide, JSON.stringify(responses)).toBeDefined()
    expect(hiddenAfterFocusLoss, JSON.stringify(responses)).toBeUndefined()
    expect(responses.filter(entry => entry.op === 'move')).toEqual([
      expect.objectContaining({ visible: false, reasonCode: 'target-not-frontmost' }),
    ])
  }, 40_000)

  it('keeps burst move and press commands FIFO through native arrival', async () => {
    const binding = await launchBoundFixture()
    const overlay = await openOverlay()
    let responses: Array<Record<string, unknown>> = []
    let panel: { x: number; y: number } | undefined
    try {
      await activateFixture(binding)
      const { x, y, width, height } = binding.targetWindowFrame
      const first = { x: Math.round(x + width * 0.25), y: Math.round(y + height * 0.3) }
      const second = { x: Math.round(x + width * 0.75), y: Math.round(y + height * 0.7) }
      overlay.send({ op: 'move', ...first, durationMs: 300, autoHideMs: 0, ...binding })
      overlay.send({ op: 'press', autoHideMs: 0, ...binding })
      overlay.send({ op: 'move', ...second, durationMs: 300, autoHideMs: 0, ...binding })
      await delay(180)
      expect(overlay.responses().filter(entry => entry.op !== undefined)).toHaveLength(0)
      await delay(650)
      panel = await overlayFrame(overlay.pid)
      responses = overlay.responses()
      expect(responses.filter(entry => entry.op !== undefined).map(entry => entry.op)).toEqual(['move', 'press', 'move'])
      expect(responses.filter(entry => entry.op === 'move'), JSON.stringify(responses)).toEqual([
        expect.objectContaining({ visible: true }),
        expect.objectContaining({ visible: true }),
      ])
      expect(panel?.x).toBeCloseTo(second.x, 0)
      expect(panel?.y).toBeCloseTo(second.y, 0)
    } finally {
      responses = await overlay.close()
      await terminateFixtures()
    }
    expect(responses.filter(entry => entry.op === 'move')).toEqual([
      expect.objectContaining({ visible: true }),
      expect.objectContaining({ visible: true }),
    ])
  }, 40_000)

  it('keeps multiple visible frames at maximum efficiency settings', async () => {
    const binding = await launchBoundFixture()
    const overlay = await openOverlay()
    let frames: Array<{ x: number; y: number }> = []
    let responses: Array<Record<string, unknown>> = []
    let expectedEnd: { x: number; y: number } | undefined
    try {
      await activateFixture(binding)
      const { x, y, width, height } = binding.targetWindowFrame
      const start = { x: Math.round(x + width * 0.1), y: Math.round(y + height * 0.2) }
      const end = { x: Math.round(x + width * 0.9), y: Math.round(y + height * 0.8) }
      expectedEnd = end
      overlay.send({ op: 'move', ...start, durationMs: 0, autoHideMs: 0, ...binding })
      await delay(100)

      const captured = overlayFrames(overlay.pid, 160)
      await delay(10)
      overlay.send({
        op: 'move',
        ...end,
        speedPxPerSecond: 50000,
        accelerationPxPerSecondSquared: 500000,
        autoHideMs: 0,
        ...binding,
      })
      frames = await captured
      await delay(100)
      responses = overlay.responses()
      expect(responses.filter(entry => entry.op === 'move')).toHaveLength(2)
    } finally {
      responses = await overlay.close()
      await terminateFixtures()
    }
    const distinct = [...new Map(frames.map(frame => [`${frame.x},${frame.y}`, frame])).values()]
    const detail = JSON.stringify({ frames: distinct, responses })
    expect(distinct.length, detail).toBeGreaterThanOrEqual(3)
    const first = distinct[0]!
    const last = distinct[distinct.length - 1]!
    expect(distinct.slice(1, -1).some(frame => frame.x !== first.x && frame.x !== last.x), detail).toBe(true)
    expect(last.x, detail).toBeCloseTo(expectedEnd!.x, 0)
    expect(last.y, detail).toBeCloseTo(expectedEnd!.y, 0)
    expect(responses.filter(entry => entry.op === 'move').at(-1), detail).toMatchObject({ visible: true })
  }, 40_000)

  it('moves through intermediate frames and completes at the production duration', async () => {
    let overlay: Awaited<ReturnType<typeof openOverlay>> | undefined
    const seen: Array<{ x: number; y: number } | undefined> = []
    let responses: Array<Record<string, unknown>> = []
    let expectedProduction: { x: number; y: number } | undefined
    try {
      const binding = await launchBoundFixture()
      overlay = await openOverlay()
      const { x, y, width, height } = binding.targetWindowFrame
      const start = { x: Math.round(x + width * 0.2), y: Math.round(y + height * 0.25) }
      const longTarget = { x: Math.round(x + width * 0.8), y: Math.round(y + height * 0.75) }
      const productionTarget = { x: Math.round(x + width * 0.45), y: Math.round(y + height * 0.35) }
      expectedProduction = productionTarget

      overlay.send({ op: 'move', ...start, durationMs: 0, autoHideMs: 0, ...binding })
      await delay(200)
      seen.push(await overlayFrame(overlay.pid))
      expect(overlay.responses().filter(entry => entry.op === 'move')).toHaveLength(1)

      await activateFixture(binding)
      // A half-second glide gives a deterministic intermediate sample. A jump
      // implementation lands at the target immediately and fails this check.
      overlay.send({ op: 'move', ...longTarget, durationMs: 500, autoHideMs: 0, ...binding })
      await delay(200)
      expect(overlay.responses().filter(entry => entry.op === 'move')).toHaveLength(1)
      seen.push(await overlayFrame(overlay.pid))
      await delay(350)
      expect(overlay.responses().filter(entry => entry.op === 'move')).toHaveLength(2)
      seen.push(await overlayFrame(overlay.pid))

      // The default physical profile must also reach a distinct final point.
      await activateFixture(binding)
      overlay.send({
        op: 'move',
        ...productionTarget,
        speedPxPerSecond: 1600,
        accelerationPxPerSecondSquared: 6000,
        autoHideMs: 0,
        ...binding,
      })
      await delay(650)
      const moveResponses = overlay.responses().filter(entry => entry.op === 'move')
      expect(moveResponses, JSON.stringify(overlay.responses())).toHaveLength(3)
      expect(moveResponses.at(-1), JSON.stringify(overlay.responses())).toMatchObject({ visible: true })
      seen.push(await overlayFrame(overlay.pid))
    } finally {
      try {
        if (overlay !== undefined) responses = await overlay.close()
      } finally {
        await terminateFixtures()
      }
    }
    const [start, intermediate, longEnd, productionEnd] = seen
    const detail = JSON.stringify({ seen, responses })
    for (const panel of seen) expect(panel, detail).toBeDefined()
    const strictlyBetween = (value: number, first: number, second: number): boolean =>
      value > Math.min(first, second) && value < Math.max(first, second)
    expect(strictlyBetween(intermediate!.x, start!.x, longEnd!.x), detail).toBe(true)
    expect(strictlyBetween(intermediate!.y, start!.y, longEnd!.y), detail).toBe(true)
    const lineCrossProduct = Math.abs(
      (intermediate!.x - start!.x) * (longEnd!.y - start!.y)
      - (intermediate!.y - start!.y) * (longEnd!.x - start!.x),
    )
    const lineLength = Math.hypot(longEnd!.x - start!.x, longEnd!.y - start!.y)
    expect(lineCrossProduct / lineLength, `cursor path was visually straight: ${detail}`).toBeGreaterThan(2)
    expect(productionEnd!.x, detail).toBeCloseTo(expectedProduction!.x, 0)
    expect(productionEnd!.y, detail).toBeCloseTo(expectedProduction!.y, 0)
  }, 60_000)

  it('moves a bound panel to each point it is told to move to', async () => {
    let binding: WindowBinding | undefined
    let overlay: Awaited<ReturnType<typeof openOverlay>> | undefined
    const seen: Array<{ requested: { x: number; y: number }; panel: { x: number; y: number } | undefined }> = []
    let responses: Array<Record<string, unknown>> = []
    try {
      binding = await launchBoundFixture()
      overlay = await openOverlay()
      // Three separated points inside the bound window: a panel that tracks
      // lands somewhere new each time, a frozen one repeats its frame.
      const { x, y, width, height } = binding.targetWindowFrame
      for (const point of [
        { x: Math.round(x + width * 0.25), y: Math.round(y + height * 0.25) },
        { x: Math.round(x + width * 0.75), y: Math.round(y + height * 0.75) },
        { x: Math.round(x + width * 0.5), y: Math.round(y + height * 0.25) },
      ]) {
        await activateFixture(binding)
        overlay.send({ op: 'move', ...point, durationMs: 0, autoHideMs: 0, ...binding })
        await delay(400)
        seen.push({ requested: point, panel: await overlayFrame(overlay.pid) })
      }
      responses = await overlay.close()
    } finally {
      try {
        if (overlay !== undefined) await overlay.close()
      } finally {
        await terminateFixtures()
      }
    }

    // A bound move reports itself visible, matching what the panel does.
    for (const entry of responses.filter(item => item.op === 'move')) {
      expect(entry.visible, JSON.stringify(responses)).toBe(true)
    }

    const detail = JSON.stringify({ binding, seen })
    for (const { panel } of seen) expect(panel, detail).toBeDefined()

    // The panel is anchored around the point rather than at it, so compare by
    // displacement: it must travel the way the requests did.
    const requestedShift = {
      x: seen[1]!.requested.x - seen[0]!.requested.x,
      y: seen[1]!.requested.y - seen[0]!.requested.y,
    }
    const panelShift = {
      x: seen[1]!.panel!.x - seen[0]!.panel!.x,
      y: seen[1]!.panel!.y - seen[0]!.panel!.y,
    }
    expect(panelShift.x, `panel did not follow horizontally: ${detail}`).toBeCloseTo(requestedShift.x, -1)
    expect(panelShift.y, `panel did not follow vertically: ${detail}`).toBeCloseTo(requestedShift.y, -1)

    const distinct = new Set(seen.map(entry => `${entry.panel!.x},${entry.panel!.y}`))
    expect(distinct.size, `panel repeated a position across distinct targets: ${detail}`).toBe(seen.length)
  }, 60_000)
})
