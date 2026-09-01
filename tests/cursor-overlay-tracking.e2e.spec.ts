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
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { afterAll, describe, expect, it } from 'vitest'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const HELPER = join(ROOT, 'native', 'macos', 'bin', 'dsh-computer-use-helper')
const INPUT_MONITOR = join(ROOT, 'native', 'macos', 'fixture', 'dsh-computer-use-input-monitor')
const FIXTURE_APP = join(ROOT, 'native', 'macos', 'fixture', 'DSHComputerUseFixture.app')
const FIXTURE_BUNDLE = 'io.anionex.dsh-computer-use-fixture'
const LIMITS = { maxNodes: 1000, maxDepth: 20, maxTextBytes: 128000 }

const REQUIRE_TCC = process.env.DSH_COMPUTER_USE_REQUIRE_TCC === '1'

interface WindowBinding {
  targetPid: number
  targetWindowNumber: number
  targetWindowFrame: { x: number; y: number; width: number; height: number }
}

/** One request/response round trip with the native helper. */
async function invokeHelper<T>(request: Record<string, unknown>): Promise<{ ok: boolean; value?: T; error?: { code: string; message: string } }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(HELPER, [], { detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('native helper timed out')) }, 15_000)
    child.stdout.setEncoding('utf8').on('data', value => { stdout += value })
    child.stderr.setEncoding('utf8').on('data', value => { stderr += value })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', () => {
      clearTimeout(timer)
      try { resolve(JSON.parse(stdout)) }
      catch { reject(new Error(`invalid helper JSON: ${stdout || stderr}`)) }
    })
    child.stdin.end(`${JSON.stringify({ protocolVersion: 1, ...request })}\n`)
  })
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

/** Launch the fixture in the background and return a usable window binding. */
async function launchBoundFixture(): Promise<WindowBinding> {
  await terminateFixtures()
  await new Promise<void>((resolve, reject) => {
    const child = spawn('open', ['-g', '-n', FIXTURE_APP, '--args', '--background'], { stdio: ['ignore', 'ignore', 'pipe'] })
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`fixture launch failed (${String(code)})`)))
  })
  const deadline = Date.now() + 12_000
  while (Date.now() < deadline) {
    for (const pid of await fixturePids()) {
      const observed = await invokeHelper<{ window?: { id?: number; frame: { x: number; y: number; width: number; height: number } } }>({
        command: 'observe',
        app: { bundleId: FIXTURE_BUNDLE, pid, name: 'DSHComputerUseFixture' },
        options: { screenshot: 'none', ...LIMITS },
      })
      const window = observed.value?.window
      if (observed.ok && window?.id !== undefined && window.frame.width > 0) {
        return { targetPid: pid, targetWindowNumber: window.id, targetWindowFrame: { ...window.frame } }
      }
    }
    await delay(100)
  }
  throw new Error('fixture never exposed an observable window')
}

/** Where the overlay panel is right now, or undefined when it has no window. */
async function overlayFrame(overlayPid: number): Promise<{ x: number; y: number } | undefined> {
  const child = spawn(INPUT_MONITOR, [
    '--duration-ms', '260', '--interval-micros', '2000', '--window-owner-pid', String(overlayPid),
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
  const payload = JSON.parse(lines[lines.length - 1]!) as { matchingWindowFrames: Array<Record<string, number>> }
  const [frame] = payload.matchingWindowFrames
  return frame === undefined ? undefined : { x: frame.X!, y: frame.Y! }
}

/**
 * An overlay process kept alive across several commands, so the panel can be
 * sampled between them. `runOverlayProtocol` in the sibling suite sends every
 * command in one burst and cannot observe intermediate positions.
 */
async function openOverlay(): Promise<{
  pid: number
  send: (command: Record<string, unknown>) => void
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
  afterAll(async () => { await terminateFixtures() })

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

  it('moves through intermediate frames and completes at the production duration', async () => {
    let overlay: Awaited<ReturnType<typeof openOverlay>> | undefined
    const seen: Array<{ x: number; y: number } | undefined> = []
    try {
      const binding = await launchBoundFixture()
      overlay = await openOverlay()
      const { x, y, width, height } = binding.targetWindowFrame
      const start = { x: Math.round(x + width * 0.2), y: Math.round(y + height * 0.25) }
      const longTarget = { x: Math.round(x + width * 0.8), y: Math.round(y + height * 0.75) }
      const productionTarget = { x: Math.round(x + width * 0.45), y: Math.round(y + height * 0.35) }

      overlay.send({ op: 'move', ...start, durationMs: 0, autoHideMs: 0, ...binding })
      await delay(200)
      seen.push(await overlayFrame(overlay.pid))

      // A one-second glide gives a deterministic intermediate sample. A jump
      // implementation lands at the target immediately and fails this check.
      overlay.send({ op: 'move', ...longTarget, durationMs: 1_000, autoHideMs: 0, ...binding })
      await delay(120)
      seen.push(await overlayFrame(overlay.pid))
      await delay(1_050)
      seen.push(await overlayFrame(overlay.pid))

      // The default live-session duration must also reach a distinct final point.
      overlay.send({ op: 'move', ...productionTarget, durationMs: 180, autoHideMs: 0, ...binding })
      await delay(350)
      seen.push(await overlayFrame(overlay.pid))
    } finally {
      try {
        if (overlay !== undefined) await overlay.close()
      } finally {
        await terminateFixtures()
      }
    }
    const [start, intermediate, longEnd, productionEnd] = seen
    const detail = JSON.stringify(seen)
    for (const panel of seen) expect(panel, detail).toBeDefined()
    const strictlyBetween = (value: number, first: number, second: number): boolean =>
      value > Math.min(first, second) && value < Math.max(first, second)
    expect(strictlyBetween(intermediate!.x, start!.x, longEnd!.x), detail).toBe(true)
    expect(strictlyBetween(intermediate!.y, start!.y, longEnd!.y), detail).toBe(true)
    expect(`${productionEnd!.x},${productionEnd!.y}`, detail).not.toBe(`${longEnd!.x},${longEnd!.y}`)
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
