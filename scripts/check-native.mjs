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

async function helperSource() {
  const sourceRoot = join(nativeRoot, 'Sources', 'Helper')
  const names = (await readdir(sourceRoot)).filter(name => name.endsWith('.swift')).sort()
  return (await Promise.all(names.map(name => readFile(join(sourceRoot, name), 'utf8')))).join('\n')
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

const source = await helperSource()
assert(!/CGWarpMouseCursorPosition|CGAssociateMouseAndMouseCursorPosition/u.test(source), 'source contains a system-cursor warp primitive')
assert(!/\.post\s*\(\s*tap:|cghidEventTap/u.test(source), 'source contains a global HID pointer-post path')
assert(source.includes('SLEventPostToPid'), 'source does not contain the target-process SkyLight pointer route')
assert(source.includes('CGEventSetWindowLocation'), 'source does not bind pointer events to window-local coordinates')
assert(source.includes('proc_pidfdinfo'), 'source does not inspect parent-owned native transports')
assert(source.includes('getpgrp() == getpid()'), 'source does not require a managed detached process group')
assert(source.includes('parentOwnsStandardTransport()'), 'source does not validate parent ownership of the three standard transports')
const dynamicSymbols = [...source.matchAll(/Self\.resolve\s*\(\s*handle\s*,\s*"([^"]+)"/gu)].map(match => match[1]).sort()
const allowedDynamicSymbols = ['CGEventSetWindowLocation', 'SLEventPostToPid', 'SLEventSetIntegerValueField'].sort()
assert(
  JSON.stringify(dynamicSymbols) === JSON.stringify(allowedDynamicSymbols),
  `unexpected dynamic native symbols: ${dynamicSymbols.join(', ') || '(none)'}`,
)
assert((source.match(/\bdlsym\s*\(/gu) ?? []).length === 1, 'native helper must keep one audited dlsym call site')

const symbolOutput = await execFileAsync('nm', ['-u', helperPath])
const undefinedSymbols = symbolOutput.stdout.split(/\r?\n/u).map(line => line.trim().split(/\s+/u).at(-1)).filter(Boolean)
for (const forbidden of ['_CGEventPost', '_CGWarpMouseCursorPosition', '_CGAssociateMouseAndMouseCursorPosition']) {
  assert(!undefinedSymbols.includes(forbidden), `helper links forbidden global pointer symbol ${forbidden}`)
}

const stringOutput = await execFileAsync('strings', [helperPath])
const binaryStrings = stringOutput.stdout.split(/\r?\n/u)
for (const allowed of allowedDynamicSymbols) {
  assert(binaryStrings.includes(allowed), `helper binary is missing audited dynamic symbol ${allowed}`)
}
for (const forbidden of ['CGEventPost', 'CGWarpMouseCursorPosition', 'CGAssociateMouseAndMouseCursorPosition']) {
  assert(!binaryStrings.includes(forbidden), `helper contains forbidden dynamic symbol literal ${forbidden}`)
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  helper: manifest.binary.path,
  sha256: manifest.binary.sha256,
  architectures,
  minimumMacOS: manifest.binary.minimumMacOS,
  pointerRouting: 'target-process-only',
}, null, 2)}\n`)
