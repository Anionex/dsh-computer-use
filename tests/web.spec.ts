import { createServer } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import { COMPUTER_USE_SETTINGS_NAMESPACE } from '../src/config.ts'
import { ComputerUseWebBackend } from '../src/web.ts'

interface RunningServer {
  baseUrl: string
  close: () => Promise<void>
}

const running: RunningServer[] = []

async function start(backend: ComputerUseWebBackend): Promise<RunningServer> {
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

function harness(options: { writable?: boolean; replace?: () => Promise<void> } = {}) {
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
  return { backend: new ComputerUseWebBackend(ctx as never), replace, health, openPermissionSettings, status }
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

    const oversized = 'x'.repeat(129 * 1024)
    expect((await post(conflictServer.baseUrl, oversized)).status).toBe(413)
  })
})
