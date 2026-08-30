import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, readFile, readdir, realpath, stat, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { PassThrough, Writable } from 'node:stream'
import { promisify } from 'node:util'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it, vi } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { NativeHelperClient } from '../src/providers/native-helper.ts'
import { temporaryDirectory } from './helpers.ts'

const execFileAsync = promisify(execFile)
const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const NATIVE = join(ROOT, 'native', 'macos')
const HELPER = join(NATIVE, 'bin', 'dsh-computer-use-helper')

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function sourceHash(): Promise<string> {
  const directory = join(NATIVE, 'Sources', 'Helper')
  const names = (await readdir(directory)).filter(name => name.endsWith('.swift')).sort()
  const hash = createHash('sha256')
  for (const name of names) {
    hash.update(name)
    hash.update('\0')
    hash.update(await readFile(join(directory, name)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function reader(text: string) {
  return {
    readFrom: () => ({ text, nextOffset: Buffer.byteLength(text), lossy: false }),
  }
}

function completedHandle(stdout: string, stderr = '', exitCode: number | null = 0) {
  return {
    done: Promise.resolve({ exitCode, signal: exitCode === null ? 'SIGTERM' : null }),
    collected: { stdout: reader(stdout), stderr: reader(stderr) },
  }
}

function abortingHandle(signal: AbortSignal | undefined) {
  return {
    done: new Promise(resolve => {
      if (signal?.aborted === true) resolve({ exitCode: null, signal: 'SIGTERM' })
      else signal?.addEventListener('abort', () => { resolve({ exitCode: null, signal: 'SIGTERM' }) }, { once: true })
    }),
    collected: { stdout: reader(''), stderr: reader('') },
  }
}

function cursorHandle(options: { ready?: string; holdReady?: boolean } = {}) {
  const stdinLines: string[] = []
  const stdout = new PassThrough()
  const stderr = reader('')
  const completed = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
  let exited = false
  const exit = (outcome: { exitCode: number | null; signal: NodeJS.Signals | null }): void => {
    if (exited) return
    exited = true
    stdout.end()
    completed.resolve(outcome)
  }
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      stdinLines.push(chunk.toString())
      callback()
    },
    final(callback) {
      exit({ exitCode: 0, signal: null })
      callback()
    },
  })
  const terminate = vi.fn(() => { exit({ exitCode: null, signal: 'SIGTERM' }) })
  const waitForExit = vi.fn(async (signal?: AbortSignal) => {
    if (exited) return true
    if (signal === undefined) {
      await completed.promise
      return true
    }
    if (signal.aborted) return false
    return await new Promise<boolean>(resolve => {
      const onAbort = (): void => { cleanup(); resolve(false) }
      const cleanup = (): void => { signal.removeEventListener('abort', onAbort) }
      signal.addEventListener('abort', onAbort, { once: true })
      void completed.promise.then(() => { cleanup(); resolve(true) })
    })
  })
  const handle: SubprocessHandle = {
    pid: 7331,
    stdin,
    stdout,
    stderr: undefined,
    collected: { stderr },
    done: completed.promise,
    terminate,
    waitForExit,
  }
  if (!options.holdReady) queueMicrotask(() => { stdout.write(options.ready ?? '{"ok":true,"ready":true,"pid":7331}\n') })
  return { handle, stdinLines, terminate, exit }
}

describe.skipIf(process.platform !== 'darwin')('managed native helper', () => {
  it('contains no global pointer warp or HID-post implementation', async () => {
    const helperSource = await readFile(join(NATIVE, 'Sources', 'Helper', 'main.swift'), 'utf8')
    const pointerSource = await readFile(join(NATIVE, 'Sources', 'Helper', 'TargetedPointer.swift'), 'utf8')
    const combined = `${helperSource}\n${pointerSource}`
    expect(combined).not.toMatch(/CGWarpMouseCursorPosition|CGAssociateMouseAndMouseCursorPosition/u)
    expect(combined).not.toMatch(/\.post\s*\(\s*tap:|cghidEventTap/u)
    expect(pointerSource).toContain('SLEventPostToPid')
    expect(pointerSource).toContain('CGEventSetWindowLocation')
    expect(helperSource).toContain('proc_pidfdinfo')
    expect(helperSource).toContain('getpgrp() == getpid()')
    expect(helperSource).toContain('parentOwnsStandardTransport()')
    const dynamicSymbols = [...combined.matchAll(/Self\.resolve\s*\(\s*handle\s*,\s*"([^"]+)"/gu)]
      .map(match => match[1])
      .sort()
    expect(dynamicSymbols).toEqual(['CGEventSetWindowLocation', 'SLEventPostToPid', 'SLEventSetIntegerValueField'])
    expect(combined.match(/\bdlsym\s*\(/gu)).toHaveLength(1)

    const symbols = await execFileAsync('nm', ['-u', HELPER])
    expect(symbols.stdout).not.toMatch(/(?:^|\s)_CGEventPost$/mu)
    expect(symbols.stdout).not.toMatch(/(?:^|\s)_CGWarpMouseCursorPosition$/mu)
    expect(symbols.stdout).not.toMatch(/(?:^|\s)_CGAssociateMouseAndMouseCursorPosition$/mu)
    const strings = await execFileAsync('strings', [HELPER])
    const binaryStrings = strings.stdout.split(/\r?\n/u)
    expect(binaryStrings).toEqual(expect.arrayContaining(['CGEventSetWindowLocation', 'SLEventPostToPid', 'SLEventSetIntegerValueField']))
    expect(binaryStrings).not.toContain('CGEventPost')
    expect(binaryStrings).not.toContain('CGWarpMouseCursorPosition')
    expect(binaryStrings).not.toContain('CGAssociateMouseAndMouseCursorPosition')
  })

  it('implements a click-through nonactivating cursor overlay without cursor warping', async () => {
    const source = await readFile(join(NATIVE, 'Sources', 'Helper', 'CursorOverlay.swift'), 'utf8')
    expect(source).toContain('.nonactivatingPanel')
    expect(source).toContain('window.ignoresMouseEvents = true')
    expect(source).toContain('app.setActivationPolicy(.prohibited)')
    expect(source).toContain('targetWindowIsCurrent')
    expect(source).toContain('CGWindowListCopyWindowInfo')
    expect(source).not.toContain('.canJoinAllSpaces')
    expect(source).toContain('window.orderFrontRegardless()')
    expect(source).not.toContain('CGWarpMouseCursorPosition')
  })

  it('re-observes and validates after explicit activation before emitting input', async () => {
    const helperSource = await readFile(join(NATIVE, 'Sources', 'Helper', 'main.swift'), 'utf8')
    const inputContextStart = helperSource.indexOf('private func inputContext(')
    const actionResultStart = helperSource.indexOf('private func actionResult(', inputContextStart)
    expect(inputContextStart).toBeGreaterThanOrEqual(0)
    expect(actionResultStart).toBeGreaterThan(inputContextStart)
    const inputContextSource = helperSource.slice(inputContextStart, actionResultStart)
    const activation = inputContextSource.indexOf('try activate(app, timeoutMs: timeoutMs)')
    const observation = inputContextSource.indexOf('let refreshed = try observeSnapshot(app: app, limits: limits)')
    const elementValidation = inputContextSource.indexOf('refreshedRecord = try validateTarget(request, snapshot: refreshed)')
    const keyboardRelaxation = inputContextSource.indexOf('keyboardAction = actionKind == "type-text" || actionKind == "press-key"')
    const stateValidation = inputContextSource.indexOf('guard activationStateMatches(snapshot, current: refreshed)')
    const activatedResult = inputContextSource.indexOf('return (refreshed, refreshedRecord, "activated")')
    expect(activation).toBeGreaterThanOrEqual(0)
    expect(observation).toBeGreaterThan(activation)
    expect(elementValidation).toBeGreaterThan(observation)
    expect(keyboardRelaxation).toBeGreaterThanOrEqual(0)
    expect(stateValidation).toBeGreaterThan(observation)
    expect(activatedResult).toBeGreaterThan(Math.max(elementValidation, stateValidation))
    expect(inputContextSource).toContain('let effectiveFocusPolicy = keyboardAction && keyboardPolicy == "activate" ? "activate" : focusPolicy')
    expect(inputContextSource).toContain('typing targets')
  })

  it('resolves the target window under a screen coordinate instead of requiring a unique observed window', async () => {
    const helperSource = await readFile(join(NATIVE, 'Sources', 'Helper', 'main.swift'), 'utf8')
    const windowAtPointStart = helperSource.indexOf('private func windowAtPoint(')
    const pointerTargetStart = helperSource.indexOf('private func pointerTarget(', windowAtPointStart)
    const pointerActionStart = helperSource.indexOf('private func pointerAction(', pointerTargetStart)
    expect(windowAtPointStart).toBeGreaterThanOrEqual(0)
    expect(pointerTargetStart).toBeGreaterThan(windowAtPointStart)
    expect(pointerActionStart).toBeGreaterThan(pointerTargetStart)
    const pointerTargetSource = helperSource.slice(windowAtPointStart, pointerActionStart)
    expect(pointerTargetSource).toContain('CGWindowListCopyWindowInfo')
    expect(pointerTargetSource).toContain('windowAtPoint(app: app, point: point)')
    expect(pointerTargetSource).toContain('no on-screen window of the selected app contains the requested coordinate')
    expect(pointerTargetSource).toContain('windowFrame.contains(point)')
    expect(helperSource).toContain('let coordinateSpace = action["coordinateSpace"] as? String ?? "window"')
  })

  it('resolves a missing AX window number from evidence, never from a guess', async () => {
    // The property under test is that an ambiguous match yields nothing rather
    // than a guess. It used to be spelled as "frame and title must both
    // match", which was stricter than the property and cost real windows their
    // id: Notes reports "备忘录 – 5个备忘录" through accessibility while the
    // window server calls the same window "备忘录". Losing the id silently
    // skips the agent cursor, so the strictness had a cost and no benefit.
    const helperSource = await readFile(join(NATIVE, 'Sources', 'Helper', 'main.swift'), 'utf8')
    expect(helperSource).toContain('guard let bounds = window[kCGWindowBounds as String] as? [String: Any]')
    expect(helperSource).toContain('let candidate = CGRect(dictionaryRepresentation: bounds as CFDictionary) else { return false }')
    // One candidate is an answer; more than one needs the title to separate them.
    expect(helperSource).toContain('if candidates.count == 1 {')
    expect(helperSource).toContain('guard titled.count == 1 else { return nil }')
  })

  it('routes AXRaise through explicit foreground authorization and refreshed target validation', async () => {
    const helperSource = await readFile(join(NATIVE, 'Sources', 'Helper', 'main.swift'), 'utf8')
    expect(helperSource).toContain('action == (kAXRaiseAction as String)')
    expect(helperSource).toContain('focusPolicy != "activate"')
    expect(helperSource).toContain('the requested Accessibility action may raise the target window')
    expect(helperSource).toMatch(/requiresForegroundPermission\(actionName\)[\s\S]*?inputContext\([\s\S]*?AXUIElementPerformAction\(currentRecord\.element/u)
  })

  it('falls back from a rejected AXPress to the nearest pressable descendant before pointer fallback', async () => {
    const helperSource = await readFile(join(NATIVE, 'Sources', 'Helper', 'main.swift'), 'utf8')
    expect(helperSource).toContain('private func pressWithDescendantFallback(_ element: AXUIElement) -> Bool')
    expect(helperSource).toContain('guard axActions(element).contains(kAXPressAction as String) else { return false }')
    expect(helperSource).toContain('AXUIElementPerformAction(element, kAXPressAction as CFString) == .success')
    expect(helperSource).toContain('visited.insert(identity).inserted')
    const clickStart = helperSource.indexOf('case "click":')
    const setValueStart = helperSource.indexOf('case "set-value":', clickStart)
    expect(clickStart).toBeGreaterThanOrEqual(0)
    expect(setValueStart).toBeGreaterThan(clickStart)
    const clickSource = helperSource.slice(clickStart, setValueStart)
    expect(clickSource).toContain('pressWithDescendantFallback(record.element)')
    expect(clickSource).toContain('element does not support an actionable AXPress and coordinate fallback was not requested')
    expect(clickSource).not.toContain('Accessibility press was rejected')
  })

  it('rejects direct shell-style helper invocation without managed parent transport', async () => {
    const direct = await execFileAsync(HELPER, [], {
      input: `${JSON.stringify({ protocolVersion: 1, command: 'health' })}\n`,
    }).catch((error: NodeJS.ErrnoException & { stdout?: string }) => error)
    expect(direct).toHaveProperty('code', 2)
    expect(String((direct as { stdout?: string }).stdout)).toContain('native helper requires managed parent transport')
  })

  it('matches its source/binary manifest, universal architectures, and code signature', async () => {
    const manifest = JSON.parse(await readFile(join(NATIVE, 'manifest.json'), 'utf8')) as {
      schemaVersion: number
      sourceSha256: string
      binary: { path: string; sha256: string; architectures: string[]; minimumMacOS: string }
    }
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      binary: {
        path: 'bin/dsh-computer-use-helper',
        architectures: ['arm64', 'x86_64'],
        minimumMacOS: '14.0',
      },
    })
    expect(manifest.sourceSha256).toBe(await sourceHash())
    expect(manifest.binary.sha256).toBe(await sha256(HELPER))
    const archs = await execFileAsync('xcrun', ['lipo', '-archs', HELPER])
    expect(archs.stdout.trim().split(/\s+/u).sort()).toEqual(['arm64', 'x86_64'])
    await expect(execFileAsync('codesign', ['--verify', '--strict', HELPER])).resolves.toBeDefined()
  })

  it('prepares the managed helper and rejects an external symlink', async () => {
    const managed = new NativeHelperClient({} as never, resolveConfig())
    await expect(managed.prepare(new AbortController().signal)).resolves.toMatchObject({
      path: HELPER,
      version: '0.1.0',
      sha256: await sha256(HELPER),
    })

    const temporary = await temporaryDirectory('dsh-computer-helper-')
    try {
      const target = join(temporary.path, 'target')
      const link = join(temporary.path, 'helper')
      await writeFile(target, '#!/bin/sh\nexit 0\n')
      await chmod(target, 0o755)
      await symlink(target, link)
      const external = new NativeHelperClient({} as never, resolveConfig({ helper: { path: link } }))
      await expect(external.prepare(new AbortController().signal)).rejects.toThrow(/non-symbolic-link/)
    } finally {
      await temporary.cleanup()
    }
  })

  it('restores the packaged helper execute bit only after its manifest hash matches', async () => {
    const temporary = await temporaryDirectory('dsh-computer-packaged-helper-')
    try {
      const managedRoot = join(temporary.path, 'native', 'macos')
      const packagedHelper = join(managedRoot, 'bin', 'dsh-computer-use-helper')
      await mkdir(dirname(packagedHelper), { recursive: true })
      await copyFile(HELPER, packagedHelper)
      await copyFile(join(NATIVE, 'manifest.json'), join(managedRoot, 'manifest.json'))
      await chmod(packagedHelper, 0o644)

      const managed = new NativeHelperClient({} as never, resolveConfig(), managedRoot)
      await expect(managed.prepare(new AbortController().signal)).resolves.toMatchObject({
        path: await realpath(packagedHelper),
        version: '0.1.0',
        sha256: await sha256(HELPER),
      })
      expect((await stat(packagedHelper)).mode & 0o100).toBe(0o100)

      await chmod(packagedHelper, 0o644)
      const manifest = JSON.parse(await readFile(join(NATIVE, 'manifest.json'), 'utf8')) as {
        binary: { sha256: string }
      }
      manifest.binary.sha256 = '0'.repeat(64)
      await writeFile(join(managedRoot, 'manifest.json'), `${JSON.stringify(manifest)}\n`)
      const tampered = new NativeHelperClient({} as never, resolveConfig(), managedRoot)
      await expect(tampered.prepare(new AbortController().signal)).rejects.toThrow(/hash does not match/)
      expect((await stat(packagedHelper)).mode & 0o100).toBe(0)
    } finally {
      await temporary.cleanup()
    }
  })

  it('maps malformed envelopes, caller cancellation, and helper deadlines to stable errors', async () => {
    const temporary = await temporaryDirectory('dsh-computer-helper-protocol-')
    try {
      const executable = join(temporary.path, 'helper')
      await writeFile(executable, '#!/bin/sh\nexit 0\n')
      await chmod(executable, 0o755)

      const malformed = new NativeHelperClient({
        subprocess: { spawn: () => completedHandle('{not-json') },
      } as never, resolveConfig({ helper: { path: executable } }))
      await malformed.prepare(new AbortController().signal)
      await expect(malformed.invoke({ command: 'health' }, new AbortController().signal)).rejects.toMatchObject({
        code: 'COMPUTER_PROVIDER_FAILURE',
        message: 'COMPUTER_PROVIDER_FAILURE: native helper returned invalid JSON',
      })

      const cancelled = new NativeHelperClient({
        subprocess: { spawn: (spec: { signal?: AbortSignal }) => abortingHandle(spec.signal) },
      } as never, resolveConfig({ helper: { path: executable } }))
      await cancelled.prepare(new AbortController().signal)
      const controller = new AbortController()
      const cancellation = cancelled.invoke({ command: 'health' }, controller.signal)
      controller.abort()
      await expect(cancellation).rejects.toMatchObject({ code: 'COMPUTER_CANCELLED' })

      const timedOut = new NativeHelperClient({
        subprocess: { spawn: (spec: { signal?: AbortSignal }) => abortingHandle(spec.signal) },
      } as never, resolveConfig({ actionTimeoutMs: 1000, helper: { path: executable } }))
      await timedOut.prepare(new AbortController().signal)
      await expect(timedOut.invoke({ command: 'health' }, new AbortController().signal)).rejects.toMatchObject({
        code: 'COMPUTER_TIMEOUT',
      })
    } finally {
      await temporary.cleanup()
    }
  })

  it('waits for one persistent cursor process, reuses it, and stops it at disposal', async () => {
    const temporary = await temporaryDirectory('dsh-computer-cursor-client-')
    try {
      const executable = join(temporary.path, 'helper')
      await writeFile(executable, '#!/bin/sh\nexit 0\n')
      await chmod(executable, 0o755)
      const cursor = cursorHandle()
      const spawn = vi.fn((_spec: SubprocessSpawnSpec) => cursor.handle)
      const client = new NativeHelperClient({ subprocess: { spawn } } as never, resolveConfig({ helper: { path: executable } }))
      await client.prepare(new AbortController().signal)
      const signal = new AbortController().signal

      await client.cursorCommand({ op: 'move', x: 10, y: 20 }, signal)
      await client.cursorCommand({ op: 'press' }, signal)
      expect(spawn).toHaveBeenCalledTimes(1)
      expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
        argv: [await realpath(executable), '--cursor-overlay'],
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 64 * 1024 } },
      }))
      expect(cursor.stdinLines).toEqual([
        '{"op":"move","x":10,"y":20}\n',
        '{"op":"press"}\n',
      ])

      await client.dispose()
      expect(cursor.stdinLines.at(-1)).toBe('{"op":"stop"}\n')
      expect(cursor.terminate).not.toHaveBeenCalled()
      expect(cursor.handle.waitForExit).toHaveBeenCalled()
    } finally {
      await temporary.cleanup()
    }
  })

  it('shares concurrent cursor startup and recovers after the overlay exits', async () => {
    const temporary = await temporaryDirectory('dsh-computer-cursor-restart-')
    try {
      const executable = join(temporary.path, 'helper')
      await writeFile(executable, '#!/bin/sh\nexit 0\n')
      await chmod(executable, 0o755)
      const first = cursorHandle({ holdReady: true })
      const second = cursorHandle()
      const handles = [first, second]
      const spawn = vi.fn(() => handles.shift()!.handle)
      const client = new NativeHelperClient({ subprocess: { spawn } } as never, resolveConfig({ helper: { path: executable } }))
      await client.prepare(new AbortController().signal)
      const signal = new AbortController().signal
      const one = client.cursorCommand({ op: 'move', x: 1, y: 2 }, signal)
      const two = client.cursorCommand({ op: 'move', x: 3, y: 4 }, signal)
      expect(spawn).toHaveBeenCalledTimes(1)
      first.handle.stdout!.write('{"ok":true,"ready":true,"pid":7331}\n')
      await Promise.all([one, two])
      first.exit({ exitCode: 0, signal: null })
      await first.handle.done
      await new Promise(resolve => setTimeout(resolve, 0))

      await client.cursorCommand({ op: 'move', x: 5, y: 6 }, signal)
      expect(spawn).toHaveBeenCalledTimes(2)
      await client.dispose()
    } finally {
      await temporary.cleanup()
    }
  })

  it('fails a cursor command when the overlay does not emit its ready frame', async () => {
    const temporary = await temporaryDirectory('dsh-computer-cursor-ready-')
    vi.useFakeTimers()
    try {
      const executable = join(temporary.path, 'helper')
      await writeFile(executable, '#!/bin/sh\nexit 0\n')
      await chmod(executable, 0o755)
      const cursor = cursorHandle({ holdReady: true })
      const client = new NativeHelperClient({ subprocess: { spawn: () => cursor.handle } } as never, resolveConfig({ helper: { path: executable } }))
      await client.prepare(new AbortController().signal)
      const command = client.cursorCommand({ op: 'move', x: 1, y: 2 }, new AbortController().signal)
      await vi.advanceTimersByTimeAsync(2_001)
      await expect(command).rejects.toThrow(/failed to become ready/)
      expect(cursor.terminate).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
      await temporary.cleanup()
    }
  })
})
