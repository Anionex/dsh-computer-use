/** Managed invocation and integrity checks for the fixed-command Swift helper. */

import { createHash } from 'node:crypto'
import { access, chmod, lstat, readFile, realpath, stat } from 'node:fs/promises'
import { constants, type Stats } from 'node:fs'
import type { Writable } from 'node:stream'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessOutcome, SubprocessOutputReader } from '@deepseek-ai/dsh-subprocess'
import type { ResolvedComputerUseConfig } from '../config.ts'
import { ComputerUseError, computerUseError, type ComputerUseErrorCode } from '../errors.ts'

interface NativeManifest {
  schemaVersion: 1
  helperVersion: string
  sourceSha256: string
  binary: {
    path: string
    sha256: string
    architectures: string[]
    minimumMacOS: string
  }
}

interface HelperFailure {
  ok: false
  error: {
    code: ComputerUseErrorCode
    message: string
  }
}

interface HelperSuccess<T> {
  ok: true
  value: T
}

type HelperEnvelope<T> = HelperFailure | HelperSuccess<T>

/** A silent overlay is tolerated; this only bounds how long we listen. */
// The overlay answers in well under a millisecond when it answers at all.
// This only bounds how long a silent one is waited on, and it sits on the
// action's critical path: the cursor is presentation, and presentation must
// not slow the action down. An earlier 1500ms here added up to three seconds
// per click and pushed the native fixture suite past its timeouts.
const CURSOR_RESPONSE_TIMEOUT_MS = 120

const CURSOR_READY_TIMEOUT_MS = 2_000
const CURSOR_PROTOCOL_MAX_BYTES = 64 * 1024

interface CursorProcess {
  stdin: Writable
  done: Promise<SubprocessOutcome>
  terminate: () => void
  waitForExit: SubprocessHandle['waitForExit']
  /** Next response line from the overlay, in command order. */
  nextResponse: () => Promise<Record<string, unknown>>
}

function collected(reader: SubprocessOutputReader | undefined): string {
  if (reader === undefined) return ''
  const value = reader.readFrom(0)
  if (value.lossy) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'native helper output exceeded its protocol limit')
  return value.text
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

function nativeRoot(): string {
  return fileURLToPath(new URL('../../native/macos/', import.meta.url))
}

/** Exact helper paths and integrity data for one active generation. */
export interface PreparedNativeHelper {
  path: string
  version: string
  sha256: string
}

/** Invokes only the packaged JSON protocol through `ctx.subprocess`; no source or shell reaches the helper. */
export class NativeHelperClient {
  private prepared?: PreparedNativeHelper
  private cursor: CursorProcess | undefined
  private cursorStart: { promise: Promise<CursorProcess> } | undefined

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedComputerUseConfig,
    private readonly managedRoot = nativeRoot(),
  ) {}

  /** Absolute executable path selected by explicit override or the packaged managed binary. */
  get helperPath(): string {
    return this.prepared?.path ?? this.config.helper.path ?? resolve(this.managedRoot, 'bin', 'dsh-computer-use-helper')
  }

  /** Verify platform, file type, packaged hash, and executable mode before use. */
  async prepare(signal: AbortSignal): Promise<PreparedNativeHelper> {
    if (process.platform !== 'darwin') {
      throw new ComputerUseError('COMPUTER_UNSUPPORTED_PLATFORM', `macOS provider cannot run on ${process.platform}`)
    }
    const managed = this.config.helper.path === undefined
    let path = this.helperPath
    let selectedInfo: Stats
    try {
      selectedInfo = await lstat(path)
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
      if (!managed || !missing || !this.config.helper.allowSourceBuild) {
        throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', `native helper is missing or unreadable: ${path}`, { cause: error })
      }
      await this.buildManaged(signal)
      selectedInfo = await lstat(path)
    }
    if (!selectedInfo.isFile() || selectedInfo.isSymbolicLink()) {
      throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'native helper must be a regular non-symbolic-link executable')
    }
    path = await realpath(path)
    const digest = await sha256(path)
    let version = 'external'
    if (managed) {
      const manifestPath = resolve(this.managedRoot, 'manifest.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as NativeManifest
      if (manifest.schemaVersion !== 1 || manifest.binary.path !== 'bin/dsh-computer-use-helper') {
        throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'native helper manifest is malformed')
      }
      if (manifest.binary.sha256 !== digest) {
        throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'native helper hash does not match native/macos/manifest.json')
      }
      version = manifest.helperVersion
    }
    try {
      await access(path, constants.X_OK)
    } catch (error) {
      if (!managed) {
        throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', `external native helper is not executable: ${path}`, { cause: error })
      }
      try {
        // npm-compatible tarballs normalize non-bin payloads to 0644. Restore
        // only the owner's execute bit after the committed hash is verified.
        await chmod(path, (selectedInfo.mode & 0o777) | 0o100)
        await access(path, constants.X_OK)
      } catch (chmodError) {
        throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', `managed native helper cannot be marked executable: ${path}`, { cause: chmodError })
      }
    }
    this.prepared = { path, version, sha256: digest }
    return this.prepared
  }

  /** Invoke one fixed helper command and parse its bounded JSON envelope. */
  async invoke<T>(request: Record<string, unknown>, signal: AbortSignal): Promise<T> {
    const prepared = this.prepared ?? await this.prepare(signal)
    const timeout = AbortSignal.timeout(this.config.actionTimeoutMs)
    const combined = AbortSignal.any([signal, timeout])
    const handle = this.ctx.subprocess.spawn({
      argv: [prepared.path],
      cwd: dirname(prepared.path),
      stdio: {
        stdin: { data: `${JSON.stringify({ protocolVersion: 1, ...request })}\n` },
        stdout: { maxBytes: 4 * 1024 * 1024 },
        stderr: { maxBytes: 64 * 1024 },
      },
      graceMs: 1000,
      signal: combined,
      env: {
        LANG: process.env.LANG ?? 'en_US.UTF-8',
        LC_ALL: process.env.LC_ALL ?? 'en_US.UTF-8',
      },
    })
    let outcome
    try {
      outcome = await handle.done
    } catch (error) {
      throw computerUseError(error, 'native helper failed to start')
    }
    if (combined.aborted) {
      if (signal.aborted) throw new ComputerUseError('COMPUTER_CANCELLED', 'native helper call was cancelled')
      throw new ComputerUseError('COMPUTER_TIMEOUT', `native helper exceeded ${this.config.actionTimeoutMs} milliseconds`)
    }
    const stdout = collected(handle.collected.stdout)
    const stderr = collected(handle.collected.stderr)
    if (outcome.exitCode !== 0 && stdout.trim().length === 0) {
      throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', `native helper exited ${String(outcome.exitCode)}${stderr.trim().length === 0 ? '' : `: ${stderr.trim().slice(0, 1000)}`}`)
    }
    let envelope: HelperEnvelope<T>
    try {
      envelope = JSON.parse(stdout) as HelperEnvelope<T>
    } catch (error) {
      throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'native helper returned invalid JSON', { cause: error })
    }
    if (envelope.ok !== true) throw new ComputerUseError(envelope.error.code, envelope.error.message.slice(0, 1000))
    return envelope.value
  }

  /** Send one best-effort command to the persistent, click-through Agent cursor overlay. */
  async cursorCommand(command: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    const prepared = this.prepared ?? await this.prepare(signal)
    const cursor = await this.getCursor(prepared, signal)
    signal.throwIfAborted()
    try {
      await new Promise<void>((resolveWrite, rejectWrite) => {
        cursor.stdin.write(`${JSON.stringify(command)}\n`, error => {
          if (error === undefined || error === null) resolveWrite()
          else rejectWrite(error)
        })
      })
      return await cursor.nextResponse()
    } catch (error) {
      if (this.cursor === cursor) this.cursor = undefined
      cursor.terminate()
      throw computerUseError(error, 'native cursor overlay command failed')
    }
  }

  /** Stop the cursor process before a provider generation is replaced or disposed. */
  async dispose(): Promise<void> {
    const cursor = this.cursor ?? await this.cursorStart?.promise.catch(() => undefined)
    this.cursorStart = undefined
    this.cursor = undefined
    if (cursor === undefined) return
    try {
      cursor.stdin.end(`${JSON.stringify({ op: 'stop' })}\n`)
    } catch {
      // A child that already closed its pipe is handled by the tree-exit wait below.
    }
    if (await cursor.waitForExit(AbortSignal.timeout(1_000))) return
    cursor.terminate()
    await cursor.waitForExit()
  }

  /** Prepared integrity facts used by provider health. */
  preparedInfo(): PreparedNativeHelper {
    if (this.prepared === undefined) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'native helper is not prepared')
    return this.prepared
  }

  private async buildManaged(signal: AbortSignal): Promise<void> {
    const script = fileURLToPath(new URL('../../scripts/build-native.mjs', import.meta.url))
    const handle = this.ctx.subprocess.spawn({
      argv: [process.execPath, script, '--helper-only'],
      cwd: dirname(script),
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 256 * 1024 },
        stderr: { maxBytes: 256 * 1024 },
      },
      graceMs: 1000,
      signal,
      env: {},
    })
    const outcome = await handle.done
    if (outcome.exitCode !== 0) {
      const stderr = collected(handle.collected.stderr)
      throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', `explicit native source build failed: ${stderr.slice(0, 1000)}`)
    }
    const info = await stat(this.helperPath).catch(() => undefined)
    if (info?.isFile() !== true) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'native source build completed without producing the helper')
  }

  private async getCursor(prepared: PreparedNativeHelper, signal: AbortSignal): Promise<CursorProcess> {
    signal.throwIfAborted()
    if (this.cursor !== undefined) return this.cursor
    if (this.cursorStart === undefined) {
      const start: { promise: Promise<CursorProcess> } = { promise: Promise.resolve(undefined as never) }
      start.promise = this.spawnCursor(prepared).then(cursor => {
        this.cursor = cursor
        void cursor.done.catch(() => undefined).finally(() => {
          if (this.cursor === cursor) this.cursor = undefined
        })
        return cursor
      }).finally(() => {
        if (this.cursorStart === start) this.cursorStart = undefined
      })
      this.cursorStart = start
    }
    const cursor = await this.cursorStart.promise
    signal.throwIfAborted()
    return cursor
  }

  private async spawnCursor(prepared: PreparedNativeHelper): Promise<CursorProcess> {
    const cursorSignal = new AbortController()
    const handle = this.ctx.subprocess.spawn({
      argv: [prepared.path, '--cursor-overlay'],
      cwd: dirname(prepared.path),
      stdio: {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: { maxBytes: 64 * 1024 },
      },
      graceMs: 1000,
      signal: cursorSignal.signal,
      env: {
        LANG: process.env.LANG ?? 'en_US.UTF-8',
        LC_ALL: process.env.LC_ALL ?? 'en_US.UTF-8',
      },
    })
    if (handle.stdin === undefined || handle.stdout === undefined) {
      handle.terminate()
      await handle.waitForExit()
      throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'native cursor overlay protocol pipes are unavailable')
    }
    handle.stdin.on('error', () => {
      // Process outcome and the next command own recovery from a closed protocol pipe.
    })
    try {
      await this.waitForCursorReady(handle)
    } catch (error) {
      handle.terminate()
      await handle.waitForExit()
      const stderr = collected(handle.collected.stderr).trim()
      throw new ComputerUseError(
        'COMPUTER_PROVIDER_FAILURE',
        `native cursor overlay failed to become ready${stderr.length === 0 ? '' : `: ${stderr.slice(0, 1000)}`}`,
        { cause: error },
      )
    }
    // The overlay answers one line per command, in order. Discarding stdout
    // (the previous behaviour) makes every outcome invisible to the caller,
    // including the one that says the agent cursor is not on screen.
    const pending: Array<(response: Record<string, unknown>) => void> = []
    const buffered: Array<Record<string, unknown>> = []
    let residue = ''
    handle.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      residue += chunk
      while (true) {
        const newline = residue.indexOf('\n')
        if (newline < 0) break
        const line = residue.slice(0, newline).trim()
        residue = residue.slice(newline + 1)
        if (line.length === 0) continue
        let parsed: Record<string, unknown>
        try { parsed = JSON.parse(line) as Record<string, unknown> }
        catch { continue }
        const waiter = pending.shift()
        if (waiter === undefined) buffered.push(parsed)
        else waiter(parsed)
      }
    })
    return {
      stdin: handle.stdin,
      done: handle.done,
      // Reading the reply is an improvement on the previous fire-and-forget
      // write, not a new requirement: an overlay that stays silent yields an
      // empty response rather than failing the action. The cursor is
      // presentation-only, so an unanswered command must never take an
      // otherwise-good action down with it.
      nextResponse: async () => {
        const ready = buffered.shift()
        if (ready !== undefined) return ready
        return await new Promise<Record<string, unknown>>((resolveResponse) => {
          const settle = (response: Record<string, unknown>): void => {
            const index = pending.indexOf(settle)
            if (index >= 0) pending.splice(index, 1)
            clearTimeout(timer)
            resolveResponse(response)
          }
          const timer = setTimeout(() => settle({}), CURSOR_RESPONSE_TIMEOUT_MS)
          pending.push(settle)
        })
      },
      terminate: () => {
        cursorSignal.abort()
        handle.terminate()
      },
      waitForExit: signal => handle.waitForExit(signal),
    }
  }

  private async waitForCursorReady(handle: SubprocessHandle): Promise<void> {
    const stdout = handle.stdout
    if (stdout === undefined) throw new Error('cursor stdout is unavailable')
    const timeout = AbortSignal.timeout(CURSOR_READY_TIMEOUT_MS)
    await new Promise<void>((resolveReady, rejectReady) => {
      let buffer = ''
      let settled = false
      const cleanup = (): void => {
        clearListeners()
        timeout.removeEventListener('abort', onTimeout)
      }
      const succeed = (): void => {
        if (settled) return
        settled = true
        cleanup()
        resolveReady()
      }
      const fail = (error: unknown): void => {
        if (settled) return
        settled = true
        cleanup()
        rejectReady(error)
      }
      const onData = (chunk: Buffer | string): void => {
        buffer += chunk.toString()
        if (Buffer.byteLength(buffer) > CURSOR_PROTOCOL_MAX_BYTES) {
          fail(new Error('cursor ready response exceeded its protocol limit'))
          return
        }
        while (true) {
          const newline = buffer.indexOf('\n')
          if (newline < 0) return
          const line = buffer.slice(0, newline)
          buffer = buffer.slice(newline + 1)
          if (line.length === 0) continue
          let response: unknown
          try {
            response = JSON.parse(line)
          } catch (error) {
            fail(error)
            return
          }
          if (typeof response === 'object' && response !== null
            && (response as { ok?: unknown }).ok === true
            && (response as { ready?: unknown }).ready === true) {
            succeed()
            return
          }
          fail(new Error('cursor overlay returned an unexpected ready response'))
          return
        }
      }
      const onEnd = (): void => { fail(new Error('cursor overlay stdout closed before ready')) }
      const onError = (error: Error): void => { fail(error) }
      const onTimeout = (): void => { fail(new Error(`cursor overlay ready timeout after ${CURSOR_READY_TIMEOUT_MS} milliseconds`)) }
      const clearListeners = (): void => {
        stdout.removeListener('data', onData)
        stdout.removeListener('end', onEnd)
        stdout.removeListener('error', onError)
      }
      stdout.on('data', onData)
      stdout.once('end', onEnd)
      stdout.once('error', onError)
      timeout.addEventListener('abort', onTimeout, { once: true })
      void handle.done.then(
        outcome => { fail(new Error(`cursor overlay exited before ready (${String(outcome.exitCode ?? outcome.signal)})`)) },
        error => { fail(error) },
      )
    })
  }
}
