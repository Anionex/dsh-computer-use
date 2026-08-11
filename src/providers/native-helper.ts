/** Managed invocation and integrity checks for the fixed-command Swift helper. */

import { createHash } from 'node:crypto'
import { access, chmod, lstat, readFile, realpath, stat } from 'node:fs/promises'
import { constants, type Stats } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from 'cordis'
import type { SubprocessOutputReader } from '@deepseek-ai/dsh-subprocess'
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
}
