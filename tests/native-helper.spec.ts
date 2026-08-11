import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, readFile, readdir, realpath, stat, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
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

describe.skipIf(process.platform !== 'darwin')('managed native helper', () => {
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
})
