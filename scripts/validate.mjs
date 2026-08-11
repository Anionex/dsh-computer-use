#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const results = []
const temporaryPaths = []

function parseArgs(argv) {
  const options = {
    lane: 'all',
    allowHubWarning: false,
    keepTemp: false,
    output: undefined,
  }
  const values = [...argv]
  while (values.length > 0) {
    const option = values.shift()
    if (option === '--allow-hub-warning') options.allowHubWarning = true
    else if (option === '--keep-temp') options.keepTemp = true
    else if (option === '--lane' || option === '--output') {
      const value = values.shift()
      if (value === undefined) throw new Error(`${option} needs a value`)
      if (option === '--lane') options.lane = value
      else options.output = resolve(value)
    } else throw new Error(`unknown option: ${option}`)
  }
  if (!['local', 'profile', 'all'].includes(options.lane)) {
    throw new Error(`--lane must be local, profile, or all; got ${options.lane}`)
  }
  return options
}

function tail(value, length = 6000) {
  return value.length <= length ? value : value.slice(-length)
}

async function runCommand(name, command, args, options = {}) {
  const startedAt = Date.now()
  let final
  for (let attempt = 1; attempt <= (options.retries ?? 0) + 1; attempt += 1) {
    final = await new Promise((resolveResult) => {
      const child = spawn(command, args, {
        cwd: options.cwd ?? ROOT,
        env: { ...process.env, ...options.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      child.stdout.setEncoding('utf8').on('data', value => { stdout += value })
      child.stderr.setEncoding('utf8').on('data', value => { stderr += value })
      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGKILL')
      }, options.timeoutMs ?? 120_000)
      child.once('error', (error) => {
        clearTimeout(timer)
        resolveResult({ code: -1, stdout, stderr: `${stderr}${error.message}`, timedOut, attempt })
      })
      child.once('close', (code) => {
        clearTimeout(timer)
        resolveResult({ code: code ?? -1, stdout, stderr, timedOut, attempt })
      })
    })
    if (final.code === 0 && !final.timedOut) break
  }
  const result = {
    name,
    status: final.code === 0 && !final.timedOut ? 'pass' : final.timedOut ? 'timeout' : 'fail',
    command: [command, ...args],
    attempts: final.attempt,
    durationMs: Date.now() - startedAt,
    code: final.code,
    stdout: tail(final.stdout),
    stderr: tail(final.stderr),
  }
  results.push(result)
  if (result.status !== 'pass') {
    throw new Error(`${name} ${result.status} (exit ${result.code})\n${result.stderr || result.stdout}`)
  }
  return final
}

async function executable(name) {
  for (const directory of (process.env.PATH ?? '').split(':').filter(Boolean)) {
    const candidate = join(directory, name)
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // Continue PATH lookup.
    }
  }
  throw new Error(`required executable is unavailable: ${name}`)
}

async function dshSourceRoot() {
  const dsh = await realpath(await executable('dsh'))
  const candidates = [join(dirname(dsh), '..'), join(dirname(dsh), '..', '..')]
  for (const candidate of candidates) {
    try {
      await access(join(candidate, 'apps', 'cli', 'config', 'agent-presets', 'standard'))
      return await realpath(candidate)
    } catch {
      // Continue candidate search.
    }
  }
  throw new Error(`cannot infer DSH source root from ${dsh}`)
}

async function pluginCheck(options) {
  const sourceRoot = await dshSourceRoot()
  const checkout = await mkdtemp(join(tmpdir(), 'dsh-computer-plugin-check-'))
  temporaryPaths.push(checkout)
  await runCommand(
    'clone dsh-plugin-check',
    'gh',
    ['repo', 'clone', 'dsh-external/dsh-plugin-check', checkout, '--', '--depth=1'],
    { timeoutMs: 60_000, retries: 1 },
  )
  const code = [
    `const { checkRepo } = await import(${JSON.stringify(pathToFileURL(join(checkout, 'src', 'index.ts')).href)});`,
    `const report = await checkRepo(${JSON.stringify(ROOT)}, false);`,
    'console.log(JSON.stringify(report));',
  ].join(' ')
  const checked = await runCommand(
    'dsh-plugin-check',
    process.execPath,
    ['--import', join(sourceRoot, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs'), '--input-type=module', '-e', code],
    { env: { TSX_TSCONFIG_PATH: join(sourceRoot, 'tsconfig.json') }, timeoutMs: 30_000 },
  )
  const report = JSON.parse(checked.stdout.trim())
  const warnings = report.warnings ?? []
  const allowed = options.allowHubWarning && warnings.every(warning => warning.code === 'not-in-hub')
  if (report.errors?.length > 0 || (warnings.length > 0 && !allowed)) {
    throw new Error(`dsh-plugin-check did not pass cleanly: ${JSON.stringify(report, null, 2)}`)
  }
  results.push({
    name: 'dsh-plugin-check assertion',
    status: 'pass',
    verdict: report.verdict,
    allowedWarnings: allowed ? warnings : [],
    checks: report.checks,
  })
}

async function javascriptFiles(directory) {
  const paths = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) paths.push(...await javascriptFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.js')) paths.push(path)
  }
  return paths
}

async function portableAssertions() {
  const startedAt = Date.now()
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('package is missing dsh.bundle.patch')
  if (pkg.dsh?.client?.platform !== 'web' || pkg.dshClient !== undefined) throw new Error('package must use dsh.client and omit dshClient')
  for (const group of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, spec] of Object.entries(pkg[group] ?? {})) {
      if (typeof spec !== 'string' || /^(?:file:|link:|workspace:|\/|[A-Za-z]:[\\/])/u.test(spec) || spec.includes('/Users/')) {
        throw new Error(`${group}.${name} is machine-local: ${String(spec)}`)
      }
    }
  }
  for (const path of await javascriptFiles(join(ROOT, 'lib'))) {
    const source = await readFile(path, 'utf8')
    if (/from ['"]\.\.?\/[^'"]+\.ts['"]/u.test(source)) throw new Error(`built JavaScript imports TypeScript: ${path}`)
  }
  const client = await readFile(join(ROOT, 'lib', 'client.js'), 'utf8')
  if (!client.includes('window.__ModuleLoader__.load')) throw new Error('lib/client.js is not loader-compatible')
  const manifest = JSON.parse(await readFile(join(ROOT, 'native', 'macos', 'manifest.json'), 'utf8'))
  const helper = await readFile(join(ROOT, 'native', 'macos', manifest.binary.path))
  const digest = createHash('sha256').update(helper).digest('hex')
  if (digest !== manifest.binary.sha256) throw new Error('native helper hash does not match manifest')
  if (JSON.stringify(manifest.binary.architectures) !== JSON.stringify(['arm64', 'x86_64'])) {
    throw new Error(`native helper architectures are not universal: ${JSON.stringify(manifest.binary.architectures)}`)
  }
  results.push({
    name: 'portable artifact assertions',
    status: 'pass',
    durationMs: Date.now() - startedAt,
    helperSha256: digest,
    architectures: manifest.binary.architectures,
    minimumMacOS: manifest.binary.minimumMacOS,
  })
}

async function localLane(options) {
  await runCommand('build', 'pnpm', ['run', 'build'], { timeoutMs: 300_000 })
  await runCommand(
    'unit and native fixture tests',
    'pnpm',
    ['exec', 'vitest', 'run', 'tests', '--exclude', 'tests/profile-install.e2e.spec.ts'],
    { env: { DSH_COMPUTER_USE_REQUIRE_TCC: '1' }, timeoutMs: 600_000 },
  )
  await portableAssertions()
  await runCommand('pack dry run', 'pnpm', ['pack', '--dry-run'], { timeoutMs: 300_000 })
  await pluginCheck(options)
}

async function profileLane() {
  await runCommand(
    'clean Web/Headless Profile fixture E2E',
    'pnpm',
    ['exec', 'vitest', 'run', 'tests/profile-install.e2e.spec.ts'],
    { env: { DSH_COMPUTER_USE_REQUIRE_TCC: '1' }, timeoutMs: 420_000 },
  )
}

async function writeOutput(options, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`
  if (options.output !== undefined) {
    await mkdir(dirname(options.output), { recursive: true })
    await writeFile(options.output, text)
  }
  process.stdout.write(text)
}

let options
let failure
try {
  options = parseArgs(process.argv.slice(2))
  if (options.lane === 'local' || options.lane === 'all') await localLane(options)
  if (options.lane === 'profile' || options.lane === 'all') await profileLane()
} catch (error) {
  failure = error instanceof Error ? error.message : String(error)
} finally {
  if (options?.keepTemp !== true) {
    for (const path of temporaryPaths.reverse()) await rm(path, { recursive: true, force: true })
  }
}

const report = {
  schemaVersion: 1,
  project: '@dsh-external/dsh-computer-use',
  lane: options?.lane ?? null,
  ok: failure === undefined,
  failure: failure ?? null,
  cleanup: options?.keepTemp === true ? 'kept' : 'complete',
  results,
}
await writeOutput(options ?? {}, report)
if (failure !== undefined) process.exitCode = 1
