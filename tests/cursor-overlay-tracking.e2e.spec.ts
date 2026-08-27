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
  if (pid === undefined) throw new Error('cursor overlay did not expose its pid')
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', value => { stdout += value })
  child.stderr.setEncoding('utf8').on('data', value => { stderr += value })
  const closed = new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', value => resolve(value ?? -1))
  })
  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`cursor overlay never became ready: ${stdout || stderr}`)), 8_000)
    child.stdout.on('data', () => {
      if (!stdout.includes('\n')) return
      const [line] = stdout.split(/\r?\n/u)
      const ready = JSON.parse(line!) as { ok?: unknown; ready?: unknown }
      clearTimeout(deadline)
      if (ready.ok !== true || ready.ready !== true) reject(new Error(`unexpected ready frame: ${line}`))
      else resolve()
    })
    child.once('error', error => { clearTimeout(deadline); reject(error) })
  })
  return {
    pid,
    send: command => { child.stdin.write(`${JSON.stringify(command)}\n`) },
    close: async () => {
      child.stdin.end(`${JSON.stringify({ op: 'stop' })}\n`)
      const code = await closed
      if (code !== 0) throw new Error(`cursor overlay exited ${String(code)}: ${stdout || stderr}`)
      return stdout.trim().split(/\r?\n/u).map(line => JSON.parse(line) as Record<string, unknown>)
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
      // No window binding: `targetWindowIsCurrent` requires pid, window number
      // and frame, so it fails and the panel is hidden. The response does not
      // say so, which is the defect.
      overlay.send({ op: 'move', x: 420, y: 420, durationMs: 0, autoHideMs: 0 })
      await delay(400)
      panel = await overlayFrame(overlay.pid)
    } finally {
      responses = await overlay.close()
    }
    const moves = responses.filter(entry => entry.op === 'move')
    expect(moves, JSON.stringify(responses)).toHaveLength(1)

    // The command is not an error -- native input is unaffected -- but the
    // response must say the panel is not on screen, and why.
    expect(
      { visible: moves[0]!.visible, panelExists: panel !== undefined },
      `a move must report its own visibility: ${JSON.stringify(responses)}`,
    ).toEqual({ visible: false, panelExists: false })
    expect(String(moves[0]!.reason ?? ''), JSON.stringify(responses)).toContain('hidden')
  }, 40_000)

  it('moves a bound panel with the animated duration a live session uses', async () => {
    // The production path passes cursorMotionMs (180 by default), which takes
    // the animator branch in `show`. The direct branch only runs while the
    // panel is hidden, so every move after the first is animated -- and a live
    // session shows the panel landing once and never moving again.
    const binding = await launchBoundFixture()
    const overlay = await openOverlay()
    const seen: Array<{ x: number; y: number } | undefined> = []
    try {
      const { x, y, width, height } = binding.targetWindowFrame
      for (const point of [
        { x: Math.round(x + width * 0.25), y: Math.round(y + height * 0.3) },
        { x: Math.round(x + width * 0.75), y: Math.round(y + height * 0.7) },
        { x: Math.round(x + width * 0.5), y: Math.round(y + height * 0.45) },
      ]) {
        overlay.send({ op: 'move', ...point, durationMs: 180, autoHideMs: 0, ...binding })
        await delay(700)
        seen.push(await overlayFrame(overlay.pid))
      }
    } finally {
      await overlay.close()
      await terminateFixtures()
    }
    const detail = JSON.stringify(seen)
    for (const panel of seen) expect(panel, detail).toBeDefined()
    const distinct = new Set(seen.map(panel => `${panel!.x},${panel!.y}`))
    expect(distinct.size, `an animated move left the panel where it was: ${detail}`).toBe(seen.length)
  }, 60_000)

  it('moves a bound panel to each point it is told to move to', async () => {
    const binding = await launchBoundFixture()
    const overlay = await openOverlay()
    const seen: Array<{ requested: { x: number; y: number }; panel: { x: number; y: number } | undefined }> = []
    let responses: Array<Record<string, unknown>> = []
    try {
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
      await terminateFixtures()
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
