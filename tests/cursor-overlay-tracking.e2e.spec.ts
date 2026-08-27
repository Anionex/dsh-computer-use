/**
 * Does the agent cursor actually go where it is told?
 *
 * The overlay is the visible half of the co-driving promise: the user is meant
 * to see where the agent is working. `native-fixture.e2e.spec.ts` covers the
 * other half well — the real cursor must not move and focus must not change —
 * but it never asserts that the overlay panel itself reached the requested
 * point. A cursor frozen in one spot satisfies every existing assertion while
 * telling the user nothing.
 *
 * This suite closes that gap by reading the overlay window's own frame between
 * moves, using the same input monitor the other suite uses for its window
 * observations.
 *
 * Run like the other native lanes:
 *     DSH_COMPUTER_USE_REQUIRE_TCC=1 npx vitest run tests/cursor-overlay-tracking.e2e.spec.ts
 */

import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const HELPER = join(ROOT, 'native', 'macos', 'bin', 'dsh-computer-use-helper')
const INPUT_MONITOR = join(ROOT, 'native', 'macos', 'fixture', 'dsh-computer-use-input-monitor')

const REQUIRE_TCC = process.env.DSH_COMPUTER_USE_REQUIRE_TCC === '1'

/** Where the overlay panel is right now, or undefined when it has no window. */
async function overlayFrame(overlayPid: number): Promise<{ x: number; y: number } | undefined> {
  const child = spawn(INPUT_MONITOR, [
    '--duration-ms', '260',
    '--interval-micros', '2000',
    '--window-owner-pid', String(overlayPid),
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
 * command in one burst, which cannot observe intermediate positions.
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
    const inspect = (): void => {
      if (!stdout.includes('\n')) return
      const [line] = stdout.split(/\r?\n/u)
      const ready = JSON.parse(line!) as { ok?: unknown; ready?: unknown }
      clearTimeout(deadline)
      if (ready.ok !== true || ready.ready !== true) reject(new Error(`unexpected ready frame: ${line}`))
      else resolve()
    }
    child.stdout.on('data', inspect)
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

/** A move command aimed at the main display, with no window binding required. */
function move(x: number, y: number): Record<string, unknown> {
  return { op: 'move', x, y, durationMs: 0, autoHideMs: 0 }
}

describe.skipIf(!REQUIRE_TCC)('agent cursor overlay tracking', () => {
  it('does not report success for a move that shows nothing', async () => {
    // `move` answers ok:true from handleCursorCommand regardless of outcome,
    // because CursorOverlayController.show returns void. Inside show, a failed
    // targetWindowIsCurrent check hides the panel and returns early — so a
    // caller is told the cursor moved while the user sees it vanish or freeze.
    //
    // This is the visible half of the co-driving promise failing silently:
    // native input still lands, so the action "works", and nothing anywhere
    // reports that the user lost sight of where the agent is acting.
    const overlay = await openOverlay()
    let responses: Array<Record<string, unknown>>
    let panel: { x: number; y: number } | undefined
    try {
      overlay.send(move(420, 420))
      await delay(400)
      panel = await overlayFrame(overlay.pid)
    } finally {
      responses = await overlay.close()
    }
    const moves = responses.filter(entry => entry.op === 'move')
    expect(moves, JSON.stringify(responses)).toHaveLength(1)

    const reportedSuccess = moves[0]!.ok === true
    const panelExists = panel !== undefined
    expect(
      { reportedSuccess, panelExists },
      `a move reported ok=${String(reportedSuccess)} while the panel ${panelExists ? 'exists' : 'does not exist'}`,
    ).toEqual({ reportedSuccess: true, panelExists: true })
  }, 40_000)

  it('moves the panel to each point it is told to move to', async () => {
    const overlay = await openOverlay()
    const seen: Array<{ requested: { x: number; y: number }; panel: { x: number; y: number } | undefined }> = []
    try {
      // Three widely separated points: a panel that tracks lands somewhere new
      // each time, a frozen one repeats the same frame.
      for (const point of [{ x: 300, y: 300 }, { x: 900, y: 620 }, { x: 500, y: 200 }]) {
        overlay.send(move(point.x, point.y))
        await delay(400)
        seen.push({ requested: point, panel: await overlayFrame(overlay.pid) })
      }
    } finally {
      await overlay.close()
    }

    const detail = JSON.stringify(seen)
    for (const { panel } of seen) expect(panel, detail).toBeDefined()

    // The panel is drawn around the point rather than at it, so compare by
    // displacement: the panel must travel the same way the requests did.
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
  }, 40_000)
})
