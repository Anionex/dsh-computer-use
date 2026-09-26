import { createServer } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import { COMPUTER_USE_SETTINGS_NAMESPACE } from '../src/config.ts'
import { ComputerUseWebBackend, installComputerUseWeb } from '../src/web.ts'

interface RunningServer {
  baseUrl: string
  close: () => Promise<void>
}

const running: RunningServer[] = []

async function start(backend: Pick<ComputerUseWebBackend, 'handle'>): Promise<RunningServer> {
  const server = createServer((req, res) => { void backend.handle(req, res) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('test server has no TCP address')
  const value = {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    close: async () => {
      server.close()
      await once(server, 'close')
    },
  }
  running.push(value)
  return value
}

afterEach(async () => {
  while (running.length > 0) await running.pop()?.close()
})

function harness(options: {
  writable?: boolean
  replace?: () => Promise<void>
  authorizeUnmarkedPost?: (req: import('node:http').IncomingMessage) => boolean
} = {}) {
  const descriptor = {
    ns: COMPUTER_USE_SETTINGS_NAMESPACE,
    schema: {},
    value: { maxNodes: 500 },
    user: { maxNodes: 500 },
    base: {},
    revision: 4,
    applies: 'live',
  }
  const replace = vi.fn(options.replace ?? (() => Promise.resolve()))
  const health = vi.fn(() => Promise.resolve())
  const openPermissionSettings = vi.fn(() => Promise.resolve())
  const status = vi.fn(() => ({
    platform: 'darwin',
    provider: 'macos-ax',
    generation: 3,
    ready: true,
    helperPath: '/helper',
    accessibility: 'granted',
    screenRecording: 'granted',
  }))
  const ctx = {
    settings: {
      writable: options.writable ?? true,
      describe: () => [descriptor],
      replace,
    },
    computerUse: { health, openPermissionSettings, status },
    logger: { warn: vi.fn() },
  }
  return {
    ctx,
    backend: new ComputerUseWebBackend(ctx as never, options.authorizeUnmarkedPost),
    replace, health, openPermissionSettings, status,
  }
}

async function post(baseUrl: string, body: unknown, options: { origin?: string; contentType?: string } = {}): Promise<Response> {
  return await fetch(baseUrl, {
    method: 'POST',
    headers: {
      origin: options.origin ?? baseUrl,
      'content-type': options.contentType ?? 'application/json',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('Computer Use Web Settings backend', () => {
  it('serves a no-store browser-safe snapshot and applies save, health, and permission actions', async () => {
    const value = harness()
    const server = await start(value.backend)
    const get = await fetch(server.baseUrl)
    expect(get.status).toBe(200)
    expect(get.headers.get('cache-control')).toBe('no-store')
    expect(await get.json()).toMatchObject({
      ok: true,
      value: {
        schemaVersion: 1,
        writable: true,
        settings: { value: { maxNodes: 500 }, revision: 4, applies: 'live' },
        provider: { generation: 3, ready: true },
      },
    })

    expect((await post(server.baseUrl, { action: 'save', expectedRevision: 4, value: { maxNodes: 600 } })).status).toBe(200)
    expect(value.replace).toHaveBeenCalledWith(COMPUTER_USE_SETTINGS_NAMESPACE, { maxNodes: 600 }, 4)
    expect((await post(server.baseUrl, { action: 'health' })).status).toBe(200)
    expect(value.health).toHaveBeenCalledOnce()
    expect((await post(server.baseUrl, { action: 'open-settings', kind: 'accessibility' })).status).toBe(200)
    expect(value.openPermissionSettings).toHaveBeenCalledWith('accessibility', expect.any(AbortSignal))
  })

  it('rejects cross-origin, malformed, oversized, unsupported, read-only, and stale writes', async () => {
    const readOnly = harness({ writable: false })
    const readOnlyServer = await start(readOnly.backend)
    expect((await post(readOnlyServer.baseUrl, { action: 'health' }, { origin: 'https://evil.example' })).status).toBe(403)
    expect((await post(readOnlyServer.baseUrl, '{}', { contentType: 'text/plain' })).status).toBe(400)
    expect((await post(readOnlyServer.baseUrl, '{', {})).status).toBe(400)
    expect((await post(readOnlyServer.baseUrl, { action: 'save', expectedRevision: 4, value: {} })).status).toBe(400)
    expect((await fetch(readOnlyServer.baseUrl, { method: 'PUT' })).status).toBe(405)

    const conflict = harness({
      replace: () => Promise.reject(new SettingsConflictError(COMPUTER_USE_SETTINGS_NAMESPACE, 4, 5)),
    })
    const conflictServer = await start(conflict.backend)
    const response = await post(conflictServer.baseUrl, { action: 'save', expectedRevision: 4, value: {} })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'settings-conflict' } })

    // The provider throws from another module copy, so the stable machine code must decide alone.
    const foreignConflict = harness({
      replace: () => Promise.reject(Object.assign(new Error('stale revision'), { code: 'SETTINGS_CONFLICT' })),
    })
    const foreignServer = await start(foreignConflict.backend)
    const foreignResponse = await post(foreignServer.baseUrl, { action: 'save', expectedRevision: 4, value: {} })
    expect(foreignResponse.status).toBe(409)
    expect(await foreignResponse.json()).toMatchObject({ ok: false, error: { code: 'settings-conflict' } })

    const otherFailure = harness({
      replace: () => Promise.reject(Object.assign(new Error('provider is unavailable'), { code: 'SETTINGS_UNAVAILABLE' })),
    })
    const otherServer = await start(otherFailure.backend)
    const otherResponse = await post(otherServer.baseUrl, { action: 'save', expectedRevision: 4, value: {} })
    expect(otherResponse.status).toBe(400)
    expect(await otherResponse.json()).toMatchObject({ ok: false, error: { code: 'action-failed' } })

    const oversized = 'x'.repeat(129 * 1024)
    expect((await post(conflictServer.baseUrl, oversized)).status).toBe(413)
  })

  it('accepts unmarked Desktop requests only after Host Connection authenticates them', async () => {
    const authorizeUnmarkedPost = vi.fn((req: import('node:http').IncomingMessage) =>
      req.headers.cookie === 'signed-session=valid')
    const value = harness({ authorizeUnmarkedPost })
    const server = await start(value.backend)
    const request = (headers: Record<string, string>) => fetch(server.baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ action: 'health' }),
    })

    expect((await request({})).status).toBe(403)
    expect((await request({ cookie: 'signed-session=forged' })).status).toBe(403)
    expect((await request({ cookie: 'signed-session=valid' })).status).toBe(200)
    expect(value.health).toHaveBeenCalledOnce()
    expect(authorizeUnmarkedPost).toHaveBeenCalledTimes(3)

    expect((await request({ cookie: 'signed-session=valid', origin: 'https://evil.example' })).status).toBe(403)
    expect((await request({ cookie: 'signed-session=valid', 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect(authorizeUnmarkedPost).toHaveBeenCalledTimes(3)

    const oldHost = harness()
    const oldServer = await start(oldHost.backend)
    const oldResponse = await fetch(oldServer.baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'signed-session=valid' },
      body: JSON.stringify({ action: 'health' }),
    })
    expect(oldResponse.status).toBe(403)
  })

  it('uses the Host Connection rejection result for unmarked forwarded requests', async () => {
    const value = harness()
    const requestRejection = vi.fn((req: import('node:http').IncomingMessage): 401 | 403 | undefined =>
      req.headers.cookie === 'signed-session=valid' ? undefined : 401)
    const register = vi.fn()
    const ctx = {
      ...value.ctx,
      connection: { requestRejection },
      webServer: { register },
      effect: (registerRoute: () => unknown) => registerRoute(),
      inject: (_services: string[], callback: (webCtx: unknown) => void) => callback(ctx),
    }
    installComputerUseWeb(ctx as never)
    expect(register).toHaveBeenCalledOnce()
    const route = register.mock.calls[0]?.[0] as { handler: ComputerUseWebBackend['handle'] }
    const server = await start({ handle: route.handler })
    const request = (headers: Record<string, string>) => fetch(server.baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ action: 'health' }),
    })
    expect((await request({ cookie: 'signed-session=valid' })).status).toBe(200)
    expect((await request({ cookie: 'signed-session=forged' })).status).toBe(403)
    expect((await request({ cookie: 'signed-session=valid', origin: 'https://evil.example' })).status).toBe(403)
    expect(requestRejection).toHaveBeenCalledTimes(2)
  })
})
