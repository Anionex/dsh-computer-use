#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const nativeRoot = join(root, 'native', 'macos')
const helperPath = join(nativeRoot, 'bin', 'dsh-computer-use-helper')
const manifest = JSON.parse(await readFile(join(nativeRoot, 'manifest.json'), 'utf8'))

function assert(condition, message) {
  if (!condition) throw new Error(`native integrity: ${message}`)
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function sourceSha256() {
  const sourceRoot = join(nativeRoot, 'Sources', 'Helper')
  const names = (await readdir(sourceRoot)).filter(name => name.endsWith('.swift')).sort()
  const hash = createHash('sha256')
  for (const name of names) {
    hash.update(name)
    hash.update('\0')
    hash.update(await readFile(join(sourceRoot, name)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

assert(manifest.schemaVersion === 1, 'unsupported manifest schema')
assert(manifest.binary?.path === 'bin/dsh-computer-use-helper', 'unexpected helper path')
assert(manifest.binary?.minimumMacOS === '14.0', 'unexpected minimum macOS version')
assert(manifest.sourceSha256 === await sourceSha256(), 'Swift source digest does not match manifest')
assert(manifest.binary.sha256 === await sha256(helperPath), 'helper SHA-256 does not match manifest')

const architectureOutput = await execFileAsync('xcrun', ['lipo', '-archs', helperPath])
const architectures = architectureOutput.stdout.trim().split(/\s+/u).sort()
assert(JSON.stringify(architectures) === JSON.stringify(['arm64', 'x86_64']), `unexpected architectures: ${architectures.join(', ')}`)
await execFileAsync('codesign', ['--verify', '--strict', helperPath])

process.stdout.write(`${JSON.stringify({
  ok: true,
  helper: manifest.binary.path,
  sha256: manifest.binary.sha256,
  architectures,
  minimumMacOS: manifest.binary.minimumMacOS,
}, null, 2)}\n`)
