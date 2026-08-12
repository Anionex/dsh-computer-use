#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { chmod, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { arch } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const NATIVE = join(ROOT, 'native', 'macos')
const BUILD = join(NATIVE, 'build')
const HELPER_SOURCE = join(NATIVE, 'Sources', 'Helper')
const FIXTURE_SOURCE = join(NATIVE, 'Sources', 'Fixture', 'main.swift')
const MONITOR_SOURCE = join(NATIVE, 'Sources', 'Monitor', 'main.swift')
const HELPER_OUTPUT = join(NATIVE, 'bin', 'dsh-computer-use-helper')
const FIXTURE_APP = join(NATIVE, 'fixture', 'DSHComputerUseFixture.app')
const MONITOR_OUTPUT = join(NATIVE, 'fixture', 'dsh-computer-use-input-monitor')
const args = new Set(process.argv.slice(2))
const helperOnly = args.has('--helper-only')
const fixtureOnly = args.has('--fixture-only')
if ([...args].some(value => !['--helper-only', '--fixture-only'].includes(value)) || (helperOnly && fixtureOnly)) {
  throw new Error('usage: build-native.mjs [--helper-only | --fixture-only]')
}

async function run(command, commandArgs, timeoutMs = 180000) {
  const result = await new Promise((resolveResult) => {
    const child = spawn(command, commandArgs, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', value => { stdout += value })
    child.stderr.setEncoding('utf8').on('data', value => { stderr += value })
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.once('error', error => {
      clearTimeout(timer)
      resolveResult({ code: -1, stdout, stderr: `${stderr}${error.message}` })
    })
    child.once('close', code => {
      clearTimeout(timer)
      resolveResult({ code: code ?? -1, stdout, stderr })
    })
  })
  if (result.code !== 0) throw new Error(`${command} failed (${result.code})\n${result.stderr || result.stdout}`)
  return result.stdout.trim()
}

async function hashFile(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function hashDirectory(directory) {
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

async function buildHelper() {
  await mkdir(BUILD, { recursive: true })
  await mkdir(dirname(HELPER_OUTPUT), { recursive: true })
  const sources = (await readdir(HELPER_SOURCE)).filter(name => name.endsWith('.swift')).sort().map(name => join(HELPER_SOURCE, name))
  const outputs = []
  for (const architecture of ['arm64', 'x86_64']) {
    const output = join(BUILD, `dsh-computer-use-helper-${architecture}`)
    await run('xcrun', [
      'swiftc', '-swift-version', '5', '-parse-as-library', '-O',
      '-target', `${architecture}-apple-macos14.0`,
      '-framework', 'AppKit',
      '-framework', 'ApplicationServices',
      '-framework', 'CoreGraphics',
      '-framework', 'QuartzCore',
      '-framework', 'ScreenCaptureKit',
      '-lproc',
      ...sources,
      '-o', output,
    ], 300000)
    outputs.push(output)
  }
  await run('xcrun', ['lipo', '-create', ...outputs, '-output', HELPER_OUTPUT])
  await chmod(HELPER_OUTPUT, 0o755)
  await run('codesign', ['--force', '--sign', '-', '--timestamp=none', HELPER_OUTPUT])
  const architectures = (await run('xcrun', ['lipo', '-archs', HELPER_OUTPUT])).split(/\s+/u).filter(Boolean).sort()
  if (architectures.join(',') !== 'arm64,x86_64') throw new Error(`helper is not universal: ${architectures.join(', ')}`)
  const manifest = {
    schemaVersion: 1,
    helperVersion: '0.1.0',
    sourceSha256: await hashDirectory(HELPER_SOURCE),
    binary: {
      path: 'bin/dsh-computer-use-helper',
      sha256: await hashFile(HELPER_OUTPUT),
      architectures,
      minimumMacOS: '14.0',
    },
  }
  await writeFile(join(NATIVE, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return { path: HELPER_OUTPUT, ...manifest.binary }
}

async function buildFixture() {
  const contents = join(FIXTURE_APP, 'Contents')
  const executable = join(contents, 'MacOS', 'DSHComputerUseFixture')
  await rm(FIXTURE_APP, { recursive: true, force: true })
  await mkdir(dirname(executable), { recursive: true })
  await mkdir(join(contents, 'Resources'), { recursive: true })
  const targetArch = arch() === 'x64' ? 'x86_64' : 'arm64'
  await run('xcrun', [
    'swiftc', '-swift-version', '5', '-O',
    '-target', `${targetArch}-apple-macos14.0`,
    '-framework', 'AppKit',
    FIXTURE_SOURCE,
    '-o', executable,
  ], 180000)
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleDevelopmentRegion</key><string>en</string>
<key>CFBundleExecutable</key><string>DSHComputerUseFixture</string>
<key>CFBundleIdentifier</key><string>io.anionex.dsh-computer-use-fixture</string>
<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
<key>CFBundleName</key><string>DSH Computer Use Fixture</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
`
  await writeFile(join(contents, 'Info.plist'), plist)
  await run('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', FIXTURE_APP])
  await run('xcrun', [
    'swiftc', '-swift-version', '5', '-O',
    '-target', `${targetArch}-apple-macos14.0`,
    '-framework', 'AppKit',
    '-framework', 'CoreGraphics',
    MONITOR_SOURCE,
    '-o', MONITOR_OUTPUT,
  ], 180000)
  await chmod(MONITOR_OUTPUT, 0o755)
  await run('codesign', ['--force', '--sign', '-', '--timestamp=none', MONITOR_OUTPUT])
  return {
    path: FIXTURE_APP,
    bundleId: 'io.anionex.dsh-computer-use-fixture',
    executable: basename(executable),
    monitor: MONITOR_OUTPUT,
  }
}

await mkdir(BUILD, { recursive: true })
const result = {}
if (!fixtureOnly) result.helper = await buildHelper()
if (!helperOnly) result.fixture = await buildFixture()
await rm(BUILD, { recursive: true, force: true })
process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`)
