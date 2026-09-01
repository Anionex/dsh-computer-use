import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { COMPUTER_USE_ACTIVATE } from '../src/exposure.ts'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const HELPER = join(ROOT, 'native', 'macos', 'bin', 'dsh-computer-use-helper')
const FIXTURE_APP = join(ROOT, 'native', 'macos', 'fixture', 'DSHComputerUseFixture.app')
const BUNDLE_ID = 'io.anionex.dsh-computer-use-fixture'

interface ScriptedRequest {
  body: unknown
}

interface ScriptedFailure {
  message: string
  stack?: string
}

type ScriptedStep =
  | { kind: 'tool'; name: string; arguments: string }
  | { kind: 'text'; text: string }

type ScriptedStepFactory = ScriptedStep | ((body: unknown) => ScriptedStep)

function commandAvailable(command: string): boolean {
  return spawnSync(command, ['--version'], { stdio: 'ignore', timeout: 10000 }).status === 0
}

function externalCommand(command: string, args: readonly string[]): { command: string; args: readonly string[] } {
  // A direct Vitest-worker child leaves DSH without its internal ESM loader.
  // A login shell matches the real CLI entry and keeps profile package resolution isolated.
  return command === 'dsh' && process.platform === 'darwin'
    ? { command: '/bin/bash', args: ['-lc', 'exec dsh "$@"', 'dsh', ...args] }
    : { command, args }
}

function run(
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const invoked = externalCommand(command, args)
    const child = spawn(invoked.command, invoked.args, {
      cwd: options.cwd ?? ROOT,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', value => { stdout += value })
    child.stderr.setEncoding('utf8').on('data', value => { stderr += value })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`${command} timed out. stdout:\n${stdout}\nstderr:\n${stderr}`))
    }, options.timeoutMs ?? 120000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', code => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

async function helper<T>(request: Record<string, unknown>): Promise<T> {
  return await new Promise((resolve, reject) => {
    const child = spawn(HELPER, [], { detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('helper timeout')) }, 15000)
    child.stdout.setEncoding('utf8').on('data', value => { stdout += value })
    child.stderr.setEncoding('utf8').on('data', value => { stderr += value })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', () => {
      clearTimeout(timer)
      try {
        const envelope = JSON.parse(stdout) as { ok: boolean; value?: T; error?: { code: string; message: string } }
        if (!envelope.ok || envelope.value === undefined) reject(new Error(`${envelope.error?.code}: ${envelope.error?.message}`))
        else resolve(envelope.value)
      } catch (error) {
        reject(new Error(`invalid helper response: ${stdout || stderr}`, { cause: error }))
      }
    })
    child.stdin.end(`${JSON.stringify({ protocolVersion: 1, ...request })}\n`)
  })
}

async function fixtureApps(): Promise<Array<{ bundleId: string; pid: number; name: string }>> {
  return (await helper<Array<{ bundleId: string; pid: number; name: string }>>({ command: 'list-apps' }))
    .filter(app => app.bundleId === BUNDLE_ID)
}

async function terminateFixtures(): Promise<void> {
  for (const app of await fixtureApps()) {
    try { process.kill(app.pid, 'SIGTERM') } catch {}
  }
  const deadline = Date.now() + 5000
  while ((await fixtureApps()).length > 0 && Date.now() < deadline) await delay(50)
}

async function waitForTranscript(path: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    try { return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown> } catch { await delay(50) }
  }
  throw new Error(`fixture transcript was not written: ${path}`)
}

async function launchFixture(transcript: string): Promise<{ bundleId: string; pid: number; name: string }> {
  const launched = await run('open', ['-g', '-n', FIXTURE_APP, '--args', '--background', '--transcript', transcript], { timeoutMs: 10000 })
  if (launched.code !== 0) throw new Error(`fixture background launch failed: ${launched.stderr}`)
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const [app] = await fixtureApps()
    if (app !== undefined) return app
    await delay(50)
  }
  throw new Error('fixture did not launch')
}

function recursiveObservation(value: unknown): { observationId: string; elements: Array<{ index: number; label?: string; title?: string }> } | undefined {
  if (typeof value === 'string') {
    try { return recursiveObservation(JSON.parse(value)) } catch { return undefined }
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = recursiveObservation(entry)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (typeof record.observationId === 'string' && Array.isArray(record.elements)) {
    return record as unknown as { observationId: string; elements: Array<{ index: number; label?: string; title?: string }> }
  }
  for (const child of Object.values(record)) {
    const found = recursiveObservation(child)
    if (found !== undefined) return found
  }
  return undefined
}

function artifactDescriptions(value: unknown): string[] {
  if (typeof value === 'string') {
    try { return artifactDescriptions(JSON.parse(value)) } catch { return [] }
  }
  if (Array.isArray(value)) return value.flatMap(artifactDescriptions)
  if (value === null || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  const own = record.mimeType === 'image/png' && typeof record.description === 'string'
    ? [record.description]
    : []
  return [...own, ...Object.values(record).flatMap(artifactDescriptions)]
}

async function startScriptedServer(steps: readonly ScriptedStepFactory[]) {
  const requests: ScriptedRequest[] = []
  const failures: ScriptedFailure[] = []
  let stepIndex = 0
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end('{"error":"not found"}')
      return
    }
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
      requests.push({ body })
      const selected = steps[stepIndex++]
      let step: ScriptedStep | undefined
      try {
        step = typeof selected === 'function' ? selected(body) : selected
      } catch (error) {
        failures.push(error instanceof Error
          ? { message: error.message, ...(error.stack === undefined ? {} : { stack: error.stack }) }
          : { message: String(error) })
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: failures.at(-1)?.message } }))
        return
      }
      if (step === undefined) {
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end('{"error":{"message":"script exhausted"}}')
        return
      }
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      const send = (value: unknown): void => { response.write(`data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`) }
      if (step.kind === 'tool') {
        send({
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index: 0,
                id: `computer-call-${stepIndex}`,
                type: 'function',
                function: { name: step.name, arguments: step.arguments },
              }],
            },
            finish_reason: null,
          }],
        })
        send({ choices: [{ index: 0, delta: { content: '' }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 3, completion_tokens: 2 } })
      } else {
        send({ choices: [{ index: 0, delta: { content: step.text }, finish_reason: null }] })
        send({ choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: step.text.length } })
      }
      send('[DONE]')
      response.end()
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  return {
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    requests,
    failures,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error === undefined ? resolve() : reject(error))
      server.closeAllConnections()
    }),
  }
}

function toolNames(request: ScriptedRequest | undefined): string[] {
  const body = request?.body as { tools?: Array<{ function?: { name?: unknown } }> } | undefined
  return body?.tools?.map(tool => tool.function?.name)
    .filter((name): name is string => typeof name === 'string') ?? []
}

function latestToolResult(request: ScriptedRequest | undefined): unknown {
  const body = request?.body as { messages?: Array<{ role?: unknown; name?: unknown; content?: unknown }> } | undefined
  return body?.messages?.filter(message => message.role === 'tool').at(-1)
}

function modelRequestSummary(value: unknown): unknown {
  const body = value as { messages?: Array<{ role?: unknown; name?: unknown; content?: unknown; tool_calls?: unknown }> }
  return body.messages?.map(message => ({
    role: message.role,
    name: message.name,
    content: typeof message.content === 'string' ? message.content.slice(0, 1200) : message.content,
    tool_calls: message.tool_calls,
  }))
}

async function screenshotFiles(directory: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await screenshotFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.png')) result.push(path)
  }
  return result
}

async function startWeb(home: string) {
  const probe = createServer()
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolve)
  })
  const port = (probe.address() as AddressInfo).port
  await new Promise<void>(resolve => probe.close(() => resolve()))
  const invoked = externalCommand('dsh', ['web', '--host', '127.0.0.1', '--port', String(port)])
  const child = spawn(invoked.command, invoked.args, {
    cwd: ROOT,
    env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: 'mock-computer-key' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  let lastResponse = 'no response'
  child.stderr.setEncoding('utf8').on('data', value => { stderr += value })
  const deadline = Date.now() + 30000
  try {
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${String(port)}/_dsh/computer-use/settings`)
        const contentType = response.headers.get('content-type') ?? ''
        lastResponse = `${String(response.status)} ${contentType || '(no content type)'}`
        if (response.ok && contentType.startsWith('application/json')) return { child, response, stderr: () => stderr }
      } catch {}
      await delay(200)
    }
    throw new Error(`Web settings route did not start (${lastResponse}): ${stderr}`)
  } catch (error) {
    child.kill('SIGKILL')
    throw error
  }
}

const enabled = process.platform === 'darwin' && commandAvailable('dsh') && commandAvailable('pnpm')

describe.skipIf(!enabled)('clean Computer Use Profile installation', () => {
  const temporary: string[] = []

  afterEach(async () => {
    await terminateFixtures()
    for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true })
  })

  it('installs the tarball in Web/Headless, operates the real fixture, disables, re-enables, boots Web, and removes cleanly', async (testContext) => {
    const health = await helper<{ accessibility: string; screenRecording: string }>({ command: 'health' })
    if (health.accessibility !== 'granted' || health.screenRecording !== 'granted') {
      if (process.env.DSH_COMPUTER_USE_REQUIRE_TCC === '1') throw new Error(`release lane requires macOS TCC: ${JSON.stringify(health)}`)
      testContext.skip(`macOS TCC permissions unavailable: ${JSON.stringify(health)}`)
      return
    }

    const home = await mkdtemp(join(tmpdir(), 'dsh-computer-profile-'))
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-computer-workspace-'))
    const packing = await mkdtemp(join(tmpdir(), 'dsh-computer-pack-'))
    temporary.push(home, workspace, packing)
    const packed = await run('pnpm', ['pack', '--pack-destination', packing], { timeoutMs: 300000 })
    expect(packed.code, packed.stderr).toBe(0)
    const tarballs = (await readdir(packing)).filter(file => file.endsWith('.tgz'))
    expect(tarballs).toHaveLength(1)
    const tarball = join(packing, tarballs[0]!)

    for (const profile of ['headless', 'web']) {
      const add = await run('dsh', ['plugin', '--profile', profile, 'add', tarball], { env: { DSH_HOME: home }, timeoutMs: 180000 })
      expect(add.code, add.stderr).toBe(0)
      const dump = await run('dsh', ['--profile', profile, '--dump-config'], { env: { DSH_HOME: home } })
      expect(dump.code, dump.stderr).toBe(0)
      expect(dump.stdout).toContain('- id: computer-use')
      expect(dump.stdout).toContain("name: '@anionex/dsh-computer-use'")
      expect(dump.stdout).toContain('focusPolicy: preserve')
      expect(dump.stdout).toContain('keyboardPolicy: activate')
      expect(dump.stdout).toContain('pointerInputPolicy: targeted')
      expect(dump.stdout).toContain('cursorVisualization: visible')
    }

    await terminateFixtures()
    const transcript = join(workspace, 'fixture-transcript.json')
    const app = await launchFixture(transcript)
    await waitForTranscript(transcript)
    const patch = join(home, 'computer-use.patch.yml')
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

    const server = await startScriptedServer([
      { kind: 'tool', name: 'skill', arguments: JSON.stringify({ name: 'computer-use' }) },
      {
        kind: 'tool',
        name: 'computer_observe',
        arguments: JSON.stringify({ app: { bundleId: app.bundleId, pid: app.pid }, screenshot: 'required', full: true }),
      },
      body => {
        const observation = recursiveObservation(body)
        if (observation === undefined) {
          throw new Error(`model request did not contain the computer_observe result: ${JSON.stringify(modelRequestSummary(body))}`)
        }
        const descriptions = artifactDescriptions(body)
        if (!descriptions.some(description => description.includes('load the vision-tools Skill')
          && description.includes('do not recreate OCR with bash, tesseract, or an ad hoc script'))) {
          throw new Error(`model request did not contain the Vision Toolkit screenshot handoff: ${JSON.stringify(descriptions)}`)
        }
        const probe = observation.elements.find(element => element.label === 'Targeted pointer probe' || element.title === 'Targeted pointer probe')
        if (probe === undefined) throw new Error('fixture pointer probe was absent from model-visible observation')
        return {
          kind: 'tool',
          name: 'computer_click',
          arguments: JSON.stringify({
            observationId: observation.observationId,
            elementIndex: probe.index,
            allowCoordinateFallback: true,
          }),
        }
      },
      { kind: 'text', text: 'computer-use profile e2e passed' },
    ])
    try {
      const result = await run('dsh', [
        '--profile', 'headless', '--patch', patch,
        '/computer-use enable the deterministic fixture option using fresh Accessibility state',
      ], {
        cwd: workspace,
        env: {
          DSH_HOME: home,
          DSH_TELEMETRY_DISABLED: '1',
          DSH_PERMISSION_MODE: 'workspace-write',
          DEEPSEEK_API_KEY: 'mock-computer-key',
          DEEPSEEK_BASE_URL: server.baseURL,
        },
        timeoutMs: 180000,
      })
      expect(server.failures, `scripted server failures:\n${JSON.stringify(server.failures, null, 2)}\ndsh stderr:\n${result.stderr}`).toEqual([])
      expect(result.code, result.stderr).toBe(0)
      expect(result.stdout.trim()).toBe('computer-use profile e2e passed')
      expect(server.requests).toHaveLength(4)
      const initialRequest = JSON.stringify(server.requests[0]?.body)
      expect(initialRequest).toContain('Current DSH file policy: workspace-write.')
      expect(toolNames(server.requests[0])).toContain(COMPUTER_USE_ACTIVATE)
      expect(toolNames(server.requests[0])).not.toContain('computer_observe')
      const skillLoadedRequest = JSON.stringify(server.requests[1]?.body)
      expect(skillLoadedRequest).toContain('load the vision-tools')
      expect(skillLoadedRequest).toContain('Do not check for OCR executables, invoke tesseract')
      expect(toolNames(server.requests[1])).toContain('computer_observe')
      expect(toolNames(server.requests[1])).not.toContain(COMPUTER_USE_ACTIVATE)
      expect(toolNames(server.requests[2])).toContain('computer_click')
      const actionToolResult = latestToolResult(server.requests[3]) as { content?: unknown } | undefined
      const actionContent = JSON.parse(String(actionToolResult?.content)) as { activation?: unknown; pointerInput?: unknown; pointerRouting?: unknown }
      expect(actionContent).toMatchObject({ activation: 'not-requested', pointerInput: true, pointerRouting: 'target-process' })
      expect(
        JSON.parse(await readFile(transcript, 'utf8')),
        `model-visible action result:\n${JSON.stringify(latestToolResult(server.requests[3]), null, 2)}`,
      ).toMatchObject({ pointerClickCount: 1, status: 'Status: pointer click' })
      expect((await screenshotFiles(join(workspace, '.dsh-computer-use', 'artifacts'))).length).toBeGreaterThan(0)
    } finally {
      await server.close()
    }

    const disablePatch = join(home, 'disable.patch.yml')
    await writeFile(disablePatch, '- id: computer-use\n  disabled: true\n')
    const disabledServer = await startScriptedServer([{ kind: 'text', text: 'computer-use disabled' }])
    try {
      const disabled = await run('dsh', [
        '--profile', 'headless', '--patch', patch, '--patch', disablePatch, 'say computer-use disabled',
      ], {
        cwd: workspace,
        env: {
          DSH_HOME: home,
          DSH_TELEMETRY_DISABLED: '1',
          DSH_PERMISSION_MODE: 'workspace-write',
          DEEPSEEK_API_KEY: 'mock-computer-key',
          DEEPSEEK_BASE_URL: disabledServer.baseURL,
        },
      })
      expect(disabled.code, disabled.stderr).toBe(0)
      expect(toolNames(disabledServer.requests[0])).not.toContain(COMPUTER_USE_ACTIVATE)
      expect(JSON.stringify(disabledServer.requests[0]?.body)).not.toContain('Accessibility-first macOS application observation')
    } finally {
      await disabledServer.close()
    }

    const reenabledServer = await startScriptedServer([
      { kind: 'tool', name: 'skill', arguments: JSON.stringify({ name: 'computer-use' }) },
      { kind: 'tool', name: 'computer_list_apps', arguments: '{}' },
      { kind: 'text', text: 'computer-use re-enabled' },
    ])
    try {
      const reenabled = await run('dsh', [
        '--profile', 'headless', '--patch', patch, '/computer-use list the running applications',
      ], {
        cwd: workspace,
        env: {
          DSH_HOME: home,
          DSH_TELEMETRY_DISABLED: '1',
          DSH_PERMISSION_MODE: 'workspace-write',
          DEEPSEEK_API_KEY: 'mock-computer-key',
          DEEPSEEK_BASE_URL: reenabledServer.baseURL,
        },
      })
      expect(reenabled.code, reenabled.stderr).toBe(0)
      expect(reenabled.stdout.trim()).toBe('computer-use re-enabled')
      expect(toolNames(reenabledServer.requests[1])).toContain('computer_list_apps')
    } finally {
      await reenabledServer.close()
    }

    const web = await startWeb(home)
    try {
      const snapshot = await web.response.json() as { ok: boolean; value?: { provider?: { ready?: boolean } } }
      expect(snapshot).toMatchObject({ ok: true, value: { provider: { ready: true } } })
    } finally {
      web.child.kill('SIGTERM')
      await new Promise(resolve => web.child.once('close', resolve))
      expect(web.stderr()).not.toMatch(/\b(?:uncaught|unhandled)\b/i)
    }

    for (const profile of ['headless', 'web']) {
      const remove = await run('dsh', ['plugin', '--profile', profile, 'remove', '@anionex/dsh-computer-use'], { env: { DSH_HOME: home } })
      expect(remove.code, remove.stderr).toBe(0)
      const dump = await run('dsh', ['--profile', profile, '--dump-config'], { env: { DSH_HOME: home } })
      expect(dump.stdout).not.toContain('@anionex/dsh-computer-use')
    }

    await access(tarball)
  }, 360000)
})
