/** Optional Web Settings and provider-health route. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { SettingsConflictError, type SettingsDescriptor } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  COMPUTER_USE_SETTINGS_NAMESPACE,
  type ComputerUseConfig,
} from './config.ts'
import type { ComputerUseStatus } from './types.ts'

/** Exact same-origin Settings endpoint. */
export const COMPUTER_USE_SETTINGS_ROUTE = '/_dsh/computer-use/settings'

/** Browser-safe Settings snapshot. */
export interface ComputerUseSettingsSnapshot {
  schemaVersion: 1
  writable: boolean
  settings: {
    value: ComputerUseConfig
    user?: unknown
    base?: unknown
    revision: number
    applies: 'live'
  }
  provider: ComputerUseStatus
}

type SettingsRequest =
  | { action: 'save'; expectedRevision: number; value: ComputerUseConfig }
  | { action: 'health' }
  | { action: 'open-settings'; kind: 'accessibility' | 'screen-recording' }

type JsonResponse<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function descriptorOf(ctx: Context): SettingsDescriptor {
  const descriptor = ctx.settings.describe().find(row => row.ns === COMPUTER_USE_SETTINGS_NAMESPACE)
  if (descriptor === undefined) throw new Error('computer-use Settings namespace is not registered')
  return descriptor
}

function responseJson<T>(res: ServerResponse, status: number, body: JsonResponse<T>): void {
  const bytes = Buffer.from(JSON.stringify(body))
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', String(bytes.length))
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
  res.writeHead(status)
  res.end(bytes)
}

function requestError(res: ServerResponse, status: number, code: string, message: string): void {
  responseJson(res, status, { ok: false, error: { code, message } })
}

function sameOriginPost(req: IncomingMessage): boolean {
  const fetchSite = req.headers['sec-fetch-site']
  if (fetchSite === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return fetchSite === 'same-origin' || fetchSite === 'same-site' || fetchSite === 'none'
  const host = req.headers.host
  if (host === undefined) return false
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host
  } catch {
    return false
  }
}

async function readJson(req: IncomingMessage, maxBytes = 128 * 1024): Promise<unknown> {
  const contentType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') throw new TypeError('Content-Type must be application/json')
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += part.length
    if (bytes > maxBytes) throw new RangeError(`request body exceeds ${maxBytes} bytes`)
    chunks.push(part)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function parseRequest(value: unknown): SettingsRequest {
  if (!isRecord(value) || typeof value.action !== 'string') throw new TypeError('request needs an action')
  if (value.action === 'health') return { action: 'health' }
  if (value.action === 'open-settings') {
    if (value.kind !== 'accessibility' && value.kind !== 'screen-recording') throw new TypeError('open-settings needs a valid kind')
    return { action: 'open-settings', kind: value.kind }
  }
  if (value.action === 'save') {
    if (!Number.isInteger(value.expectedRevision) || !isRecord(value.value)) throw new TypeError('save needs expectedRevision and value')
    return { action: 'save', expectedRevision: value.expectedRevision as number, value: value.value as ComputerUseConfig }
  }
  throw new TypeError(`unknown action: ${value.action}`)
}

function publicMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000)
}

/** Same-origin backend used by the optional client Settings section. */
export class ComputerUseWebBackend {
  constructor(private readonly ctx: Context) {}

  /** Current browser-safe Settings and health state. */
  snapshot(): ComputerUseSettingsSnapshot {
    const descriptor = descriptorOf(this.ctx)
    return {
      schemaVersion: 1,
      writable: this.ctx.settings.writable,
      settings: {
        value: descriptor.value as ComputerUseConfig,
        ...(descriptor.user === undefined ? {} : { user: descriptor.user }),
        ...(descriptor.base === undefined ? {} : { base: descriptor.base }),
        revision: descriptor.revision,
        applies: 'live',
      },
      provider: this.ctx.computerUse.status(),
    }
  }

  /** Handle one Settings request. */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'GET') {
      try { responseJson(res, 200, { ok: true, value: this.snapshot() }) }
      catch (error) { requestError(res, 503, 'settings-unavailable', publicMessage(error)) }
      return
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST')
      requestError(res, 405, 'method-not-allowed', 'Use GET or POST')
      return
    }
    if (!sameOriginPost(req)) {
      requestError(res, 403, 'origin-rejected', 'The request must originate from this DSH Web application')
      return
    }
    let parsed: SettingsRequest
    try { parsed = parseRequest(await readJson(req)) }
    catch (error) {
      requestError(res, error instanceof RangeError ? 413 : 400, 'invalid-request', publicMessage(error))
      return
    }
    try {
      if (parsed.action === 'save') {
        if (!this.ctx.settings.writable) throw new Error('settings provider is read-only')
        await this.ctx.settings.replace(COMPUTER_USE_SETTINGS_NAMESPACE, parsed.value as object, parsed.expectedRevision)
      } else if (parsed.action === 'health') {
        await this.ctx.computerUse.health(AbortSignal.timeout(30000))
      } else {
        await this.ctx.computerUse.openPermissionSettings(parsed.kind, AbortSignal.timeout(10000))
      }
      responseJson(res, 200, { ok: true, value: this.snapshot() })
    } catch (error) {
      const conflict = error instanceof SettingsConflictError
      this.ctx.logger.warn('dsh-computer-use Web action=%s failed: %s', parsed.action, publicMessage(error))
      requestError(res, conflict ? 409 : 400, conflict ? 'settings-conflict' : 'action-failed', publicMessage(error))
    }
  }
}

/** Attach the optional route when a Web host is present. */
export function installComputerUseWeb(ctx: Context): void {
  const backend = new ComputerUseWebBackend(ctx)
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: COMPUTER_USE_SETTINGS_ROUTE,
      handler: (req, res) => backend.handle(req, res),
    }), 'dsh-computer-use: Web Settings route')
  })
}
