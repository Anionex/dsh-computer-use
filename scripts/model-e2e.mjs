#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const HELPER = join(ROOT, 'native', 'macos', 'bin', 'dsh-computer-use-helper')
const FIXTURE_APP = join(ROOT, 'native', 'macos', 'fixture', 'DSHComputerUseFixture.app')
const BUNDLE_ID = 'io.anionex.dsh-computer-use-fixture'
const RESULTS = []
const TEMPORARY = []

function parseArgs(argv) {
  const options = { keepTemp: false, output: undefined }
  const values = [...argv]
  while (values.length > 0) {
    const option = values.shift()
    if (option === '--keep-temp') options.keepTemp = true
    else if (option === '--output') {
      const value = values.shift()
      if (value === undefined) throw new Error('--output needs a value')
      options.output = resolve(value)
    } else throw new Error(`unknown option: ${option}`)
  }
  return options
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for the real-model lane`)
  return value
}

function tail(value, length = 8000) {
  return value.length <= length ? value : value.slice(-length)
}

async function runCommand(name, command, args, options = {}) {
  const startedAt = Date.now()
  const result = await new Promise((resolveResult) => {
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
    }, options.timeoutMs ?? 600_000)
    child.once('error', error => {
      clearTimeout(timer)
      resolveResult({ code: -1, stdout, stderr: `${stderr}${error.message}`, timedOut })
    })
    child.once('close', code => {
      clearTimeout(timer)
      resolveResult({ code: code ?? -1, stdout, stderr, timedOut })
    })
  })
  const evidence = {
    name,
    status: result.code === 0 && !result.timedOut ? 'pass' : result.timedOut ? 'timeout' : 'fail',
    command: [command, ...args],
    durationMs: Date.now() - startedAt,
    code: result.code,
    stdout: tail(result.stdout),
    stderr: tail(result.stderr),
  }
  RESULTS.push(evidence)
  if (evidence.status !== 'pass') {
    throw new Error(`${name} ${evidence.status} (exit ${result.code})\n${evidence.stderr || evidence.stdout}`)
  }
  return result
}

async function helper(request) {
  return await new Promise((resolveResult, reject) => {
    const child = spawn(HELPER, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('native helper timed out'))
    }, 15_000)
    child.stdout.setEncoding('utf8').on('data', value => { stdout += value })
    child.stderr.setEncoding('utf8').on('data', value => { stderr += value })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', () => {
      clearTimeout(timer)
      try {
        const envelope = JSON.parse(stdout)
        if (!envelope.ok || envelope.value === undefined) {
          reject(new Error(`${envelope.error?.code}: ${envelope.error?.message}`))
        } else resolveResult(envelope.value)
      } catch (error) {
        reject(new Error(`invalid helper response: ${stdout || stderr}`, { cause: error }))
      }
    })
    child.stdin.end(`${JSON.stringify({ protocolVersion: 1, ...request })}\n`)
  })
}

async function fixtureApps() {
  const apps = await helper({ command: 'list-apps' })
  return apps.filter(app => app.bundleId === BUNDLE_ID)
}

async function terminateFixtures() {
  for (const app of await fixtureApps()) {
    try { process.kill(app.pid, 'SIGTERM') } catch {}
  }
  const deadline = Date.now() + 5000
  while ((await fixtureApps()).length > 0 && Date.now() < deadline) await delay(50)
  if ((await fixtureApps()).length > 0) throw new Error('fixture processes did not terminate')
}

async function launchFixture(transcript) {
  const opened = await runCommand(
    'launch deterministic macOS fixture',
    'open',
    ['-n', FIXTURE_APP, '--args', '--transcript', transcript],
    { timeoutMs: 10_000 },
  )
  if (opened.code !== 0) throw new Error(opened.stderr)
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const [app] = await fixtureApps()
    if (app !== undefined) return app
    await delay(50)
  }
  throw new Error('fixture did not launch')
}

async function screenshotFiles(directory) {
  try {
    const files = await readdir(directory, { recursive: true })
    return files.filter(file => file.endsWith('.png'))
  } catch {
    return []
  }
}

async function findTarball(directory) {
  const files = (await readdir(directory)).filter(file => file.endsWith('.tgz'))
  if (files.length !== 1) throw new Error(`expected one tarball in ${directory}, found ${files.length}`)
  return join(directory, files[0])
}

async function realModelWorkflow() {
  const packing = await mkdtemp(join(tmpdir(), 'dsh-computer-model-pack-'))
  const home = await mkdtemp(join(tmpdir(), 'dsh-computer-model-home-'))
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-computer-model-workspace-'))
  const privateState = await mkdtemp(join(tmpdir(), 'dsh-computer-model-state-'))
  TEMPORARY.push(packing, home, workspace, privateState)

  await runCommand('pack dsh-computer-use', 'pnpm', ['pack', '--pack-destination', packing], { timeoutMs: 300_000 })
  await access(HELPER, constants.X_OK)
  await access(join(FIXTURE_APP, 'Contents', 'MacOS', 'DSHComputerUseFixture'), constants.X_OK)
  const health = await helper({ command: 'health' })
  if (health.accessibility !== 'granted' || health.screenRecording !== 'granted') {
    throw new Error(`real-model lane requires macOS TCC grants: ${JSON.stringify(health)}`)
  }

  const tarball = await findTarball(packing)
  await runCommand(
    'install dsh-computer-use tarball',
    'dsh',
    ['plugin', '--profile', 'headless', 'add', tarball],
    { env: { DSH_HOME: home }, timeoutMs: 180_000 },
  )
  const dump = await runCommand(
    'dump real-model Profile',
    'dsh',
    ['--profile', 'headless', '--dump-config'],
    { env: { DSH_HOME: home }, timeoutMs: 60_000 },
  )
  if (!dump.stdout.includes("name: '@dsh-external/dsh-computer-use'")) {
    throw new Error('real-model Profile does not mount dsh-computer-use')
  }

  await terminateFixtures()
  const transcript = join(privateState, 'fixture-transcript.json')
  const app = await launchFixture(transcript)
  const patch = join(home, 'computer-use-model.patch.yml')
  await writeFile(patch, [
    '- id: computer-use',
    '  config:',
    '    settleMs: 50',
    '    maxSettleMs: 3000',
    '    grants:',
    `      - bundleId: ${BUNDLE_ID}`,
    '        read: true',
    '        control: true',
    '- id: session-title-llm',
    '  disabled: true',
    '',
  ].join('\n'))

  const prompt = `/computer-use\n\nUse the dsh-computer-use capability to operate the running deterministic macOS fixture whose bundle id is ${BUNDLE_ID}. Load the Skill, list running applications, select the exact fixture process, observe it with a required screenshot and full Accessibility state, locate the checkbox labelled "Enable deterministic option", click that current element using its observation id and element index, and confirm from the fresh post-action observation that the status reads "Status: option enabled". Use only the focused computer-use Tools for UI observation and input; do not use shell, AppleScript, JXA, direct file edits, or coordinate guessing. Finish immediately after confirming the enabled state.`
  const result = await runCommand(
    'DeepSeek V4 computer-use fixture workflow',
    'dsh',
    ['run', '--profile', 'headless', '--patch', patch, prompt],
    {
      cwd: workspace,
      env: {
        DSH_HOME: home,
        DSH_TELEMETRY_DISABLED: '1',
        DSH_PERMISSION_MODE: 'workspace-write',
        DEEPSEEK_API_KEY: requiredEnvironment('DEEPSEEK_API_KEY'),
        DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com/v1',
      },
      timeoutMs: 600_000,
    },
  )

  const state = JSON.parse(await readFile(transcript, 'utf8'))
  if (state.checked !== true || state.status !== 'Status: option enabled') {
    throw new Error(`fixture state did not prove the requested action: ${JSON.stringify(state)}`)
  }
  const screenshots = await screenshotFiles(join(workspace, '.dsh-computer-use', 'artifacts'))
  if (screenshots.length === 0) throw new Error('computer_observe produced no screenshot Artifact')
  RESULTS.push({
    name: 'DeepSeek V4 computer-use assertions',
    status: 'pass',
    bundleId: app.bundleId,
    pid: app.pid,
    fixtureState: state,
    screenshotArtifacts: screenshots,
    finalResponse: tail(result.stdout.trim(), 2000),
  })
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
let cleanupFailure
try {
  options = parseArgs(process.argv.slice(2))
  requiredEnvironment('DEEPSEEK_API_KEY')
  await realModelWorkflow()
} catch (error) {
  failure = error instanceof Error ? error.message : String(error)
} finally {
  try {
    if (await access(HELPER, constants.X_OK).then(() => true, () => false)) await terminateFixtures()
    if (options?.keepTemp !== true) {
      for (const path of TEMPORARY.reverse()) await rm(path, { recursive: true, force: true })
    }
  } catch (error) {
    cleanupFailure = error instanceof Error ? error.message : String(error)
  }
}

const report = {
  schemaVersion: 1,
  project: '@dsh-external/dsh-computer-use',
  lane: 'real-model',
  ok: failure === undefined && cleanupFailure === undefined,
  failure: failure ?? null,
  cleanup: cleanupFailure === undefined ? options?.keepTemp === true ? 'kept' : 'complete' : 'failed',
  cleanupFailure: cleanupFailure ?? null,
  results: RESULTS,
}
await writeOutput(options ?? {}, report)
if (!report.ok) process.exitCode = 1
