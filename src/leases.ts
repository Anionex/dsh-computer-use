/** Session-sidecar read leases, durable denials, and per-turn control leases. */

import { z } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import { approvalPolicy } from './approval-policy.ts'
import type { ResolvedComputerUseConfig } from './config.ts'
import { ComputerUseError } from './errors.ts'
import type { ComputerAppIdentity } from './types.ts'

const nonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const leaseScopeSchema = z.union([z.literal('read'), z.literal('control')])

const sessionIdentitySchema = z.object({
  createdAt: nonNegativeSafeInteger,
  cwd: z.string().optional(),
})

/** Session fields that fence one sidecar row to one exact Session lifecycle. */
export type ComputerUseSessionIdentity = z.infer<typeof sessionIdentitySchema>

const deniedLeaseSchema = z.object({
  bundleId: z.string().min(1),
  scope: leaseScopeSchema,
})

/** One application/scope rejection that remains final for the Session lifecycle. */
export type ComputerUseDeniedLease = z.infer<typeof deniedLeaseSchema>

/** Runtime validation for the whole-Session Computer Use sidecar row. */
export const computerUseSessionStateSchema = z.object({
  session: sessionIdentitySchema,
  readGrants: z.array(z.string().min(1)),
  denied: z.array(deniedLeaseSchema),
}).superRefine((row, ctx) => {
  const readGrants = new Set<string>()
  row.readGrants.forEach((bundleId, index) => {
    if (readGrants.has(bundleId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['readGrants', index],
        message: `duplicate Computer Use read grant '${bundleId}'`,
      })
    }
    readGrants.add(bundleId)
  })

  const denials = new Set<string>()
  row.denied.forEach((denial, index) => {
    const key = `${denial.scope}\0${denial.bundleId}`
    if (denials.has(key)) {
      ctx.addIssue({
        code: 'custom',
        path: ['denied', index],
        message: `duplicate Computer Use ${denial.scope} denial '${denial.bundleId}'`,
      })
    }
    denials.add(key)
  })
})

/** Plugin-owned durable authorization state for one Session lifecycle. */
export type ComputerUseSessionState = z.infer<typeof computerUseSessionStateSchema>

/** One lifecycle-bound Computer Use sidecar record per Session id. */
export const computerUseStateDomainSpec = defineDomain({
  name: 'computer_use_state',
  version: 0,
  tables: {
    sessions: domainTable<SessionId, ComputerUseSessionState>(computerUseSessionStateSchema),
  },
})

interface StorageBinding {
  table: KvTable<SessionId, ComputerUseSessionState>
}

function currentTurn(events: readonly SessionEvent[]): number | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'turn/end') return undefined
    if (event?.type === 'turn/start') return event.data.turn
  }
  return undefined
}

function identityOf(header: SessionHeader): ComputerUseSessionIdentity {
  return Object.freeze({
    createdAt: header.createdAt,
    ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
  })
}

function sameIdentity(row: ComputerUseSessionState, header: SessionHeader): boolean {
  return row.session.createdAt === header.createdAt && row.session.cwd === header.cwd
}

function stateSnapshot(
  header: SessionHeader,
  readGrants: Iterable<string>,
  denied: Iterable<ComputerUseDeniedLease>,
): ComputerUseSessionState {
  const readGrantSnapshot = Object.freeze([...readGrants]) as unknown as string[]
  const deniedSnapshot = Object.freeze([...denied].map(item => Object.freeze({ ...item }))) as unknown as ComputerUseDeniedLease[]
  return Object.freeze({
    session: identityOf(header),
    readGrants: readGrantSnapshot,
    denied: deniedSnapshot,
  })
}

function configuredAccess(config: ResolvedComputerUseConfig, bundleId: string, scope: 'read' | 'control'): boolean {
  if (config.allowAllApps) return true
  return config.grants.find(grant => grant.bundleId === bundleId)?.[scope] === true
}

function boundedFailure(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500)
}

/** Source of the technical application lease used by an operation. */
export type ComputerLeaseSource = 'configured' | 'approved'

/** Applies configured app policy and routes missing leases through DSH approval. */
export class ComputerLeaseManager {
  private storage: StorageBinding | undefined
  private readonly storageFiber: Fiber & PromiseLike<Fiber>
  private readonly decisionTails = new Map<SessionId, Promise<void>>()
  private readonly mutationTails = new Map<SessionId, Promise<void>>()
  private readonly controlGrants = new WeakMap<Agent, Map<string, number>>()

  constructor(
    private readonly ctx: Context,
    private readonly config: () => ResolvedComputerUseConfig,
  ) {
    this.storageFiber = ctx.inject(['storageDomain'], async (storageCtx: Context) => {
      const domain = await storageCtx.storageDomain.open(computerUseStateDomainSpec)
      const binding: StorageBinding = { table: domain.table('sessions') }
      this.storage = binding
      return async () => {
        if (this.storage === binding) this.storage = undefined
        await Promise.all(this.mutationTails.values())
        await domain.close()
      }
    })
    ctx.effect(() => () => this.storageFiber.dispose(), 'dsh-computer-use: optional lease sidecar')
  }

  /** Wait for an already-composed storage-domain service to finish opening. */
  async initialize(): Promise<void> {
    await this.prepareStorage()
  }

  /** Ensure one Agent may read or control one exact running application. */
  async ensure(
    agent: Agent,
    app: ComputerAppIdentity,
    scope: 'read' | 'control',
    toolName: string,
    callId: CallId | undefined,
    signal: AbortSignal,
  ): Promise<ComputerLeaseSource> {
    if (configuredAccess(this.config(), app.bundleId, scope)) return 'configured'
    return await this.enqueueDecision(agent.session.id, async () => {
      if (configuredAccess(this.config(), app.bundleId, scope)) return 'configured'
      return await this.ensureInteractive(agent, app, scope, toolName, callId, signal)
    })
  }

  /** Forget process-local control grants when their Agent is disposed. */
  releaseAgent(agent: Agent): void {
    this.controlGrants.delete(agent)
  }

  private async ensureInteractive(
    agent: Agent,
    app: ComputerAppIdentity,
    scope: 'read' | 'control',
    toolName: string,
    callId: CallId | undefined,
    signal: AbortSignal,
  ): Promise<ComputerLeaseSource> {
    await this.prepareStorage()
    const turn = currentTurn(agent.session.events)
    if (turn === undefined) {
      throw new ComputerUseError('COMPUTER_PERMISSION_REQUIRED', `${scope} access for ${app.name} must be requested inside an open Agent turn`)
    }

    if (scope === 'control' && this.controlGrants.get(agent)?.get(app.bundleId) === turn) {
      return 'approved'
    }

    const stored = this.currentState(agent)
    if (scope === 'read' && stored?.readGrants.includes(app.bundleId) === true) {
      return 'approved'
    }
    if (stored?.denied.some(denial => denial.bundleId === app.bundleId && denial.scope === scope) === true) {
      throw new ComputerUseError(
        'COMPUTER_PERMISSION_REQUIRED',
        `${scope} access for ${app.name} was rejected earlier in this Session; do not retry without new user instructions`,
      )
    }

    if (approvalPolicy(this.ctx, agent) === 'never') {
      throw new ComputerUseError(
        'COMPUTER_PERMISSION_REQUIRED',
        `${scope} access for ${app.name} is blocked because approval prompts are disabled in this Session (approval/policy: never, e.g. the danger-full-access preset); add "${app.bundleId}" to the computer-use grants in Settings, or switch the permission preset to one with approval ask`,
      )
    }

    if (scope === 'read' && this.storage === undefined) {
      throw this.storageRequired(app, scope, 'a Session-wide interactive read grant')
    }

    const outcome = await this.ctx.approval.request({
      agent,
      toolName,
      ...(callId === undefined ? {} : { callId }),
      reason: scope === 'read'
        ? `Allow this Agent to inspect the Accessibility state and requested screenshot of ${app.name} (${app.bundleId}) for this Session.`
        : `Allow this Agent to send UI input to ${app.name} (${app.bundleId}) for the current turn.`,
      signal,
    })
    if (outcome === 'cancelled') {
      throw new ComputerUseError('COMPUTER_CANCELLED', `${scope} access request for ${app.name} was cancelled`)
    }
    if (outcome === 'rejected') {
      if (this.storage === undefined) {
        throw this.storageRequired(app, scope, 'the rejected interactive decision')
      }
      await this.persist(agent, app, { kind: 'denied', scope })
      throw new ComputerUseError('COMPUTER_PERMISSION_REQUIRED', `${scope} access for ${app.name} was not granted (rejected); do not retry in this Session without new user instructions`)
    }
    if (outcome !== 'allowed-once') {
      throw new ComputerUseError('COMPUTER_PERMISSION_REQUIRED', `${scope} access for ${app.name} was not granted (${outcome})`)
    }

    if (scope === 'control') {
      let grants = this.controlGrants.get(agent)
      if (grants === undefined) {
        grants = new Map()
        this.controlGrants.set(agent, grants)
      }
      grants.set(app.bundleId, turn)
      return 'approved'
    }

    await this.persist(agent, app, { kind: 'read-granted' })
    return 'approved'
  }

  private currentState(agent: Agent): ComputerUseSessionState | undefined {
    const row = this.storage?.table.get(agent.session.id)
    return row !== undefined && sameIdentity(row, agent.session.header) ? row : undefined
  }

  private async prepareStorage(): Promise<StorageBinding | undefined> {
    if (this.storage !== undefined) return this.storage
    if (this.ctx.get('storageDomain') === undefined) return undefined
    await this.storageFiber
    return this.storage
  }

  private async persist(
    agent: Agent,
    app: ComputerAppIdentity,
    decision: { kind: 'read-granted' } | { kind: 'denied'; scope: 'read' | 'control' },
  ): Promise<void> {
    const purpose = decision.kind === 'read-granted'
      ? 'the Session-wide read grant'
      : `the Session-wide ${decision.scope} denial`
    try {
      const participated = await this.ctx.sessions.flush(agent.session)
      if (!participated) {
        throw new Error('no Session persistence listener participated in ctx.sessions.flush')
      }
      await this.enqueueMutation(agent.session.id, async () => {
        const binding = this.storage
        if (binding === undefined) throw this.storageRequired(app, decision.kind === 'read-granted' ? 'read' : decision.scope, purpose)
        const current = binding.table.get(agent.session.id)
        const row = current !== undefined && sameIdentity(current, agent.session.header)
          ? current
          : stateSnapshot(agent.session.header, [], [])
        const readGrants = new Set(row.readGrants)
        const denied = [...row.denied]
        if (decision.kind === 'read-granted') {
          readGrants.add(app.bundleId)
        } else if (!denied.some(item => item.bundleId === app.bundleId && item.scope === decision.scope)) {
          denied.push({ bundleId: app.bundleId, scope: decision.scope })
        }
        await binding.table.put(agent.session.id, stateSnapshot(agent.session.header, readGrants, denied))
      })
    } catch (error) {
      if (error instanceof ComputerUseError) throw error
      throw new ComputerUseError(
        'COMPUTER_PERMISSION_REQUIRED',
        `${purpose} for ${app.name} could not be persisted after the approval audit: ${boundedFailure(error)}; configure working Session persistence and @deepseek-ai/dsh-storage-domain before retrying`,
        { cause: error },
      )
    }
  }

  private storageRequired(
    app: ComputerAppIdentity,
    scope: 'read' | 'control',
    purpose: string,
  ): ComputerUseError {
    return new ComputerUseError(
      'COMPUTER_PERMISSION_REQUIRED',
      `${scope} access for ${app.name} requires ctx.storageDomain to persist ${purpose}; compose @deepseek-ai/dsh-storage-domain or add an exact static grant for "${app.bundleId}" before retrying`,
    )
  }

  private enqueueDecision<T>(sessionId: SessionId, operation: () => Promise<T>): Promise<T> {
    const previous = this.decisionTails.get(sessionId) ?? Promise.resolve()
    const result = previous.then(operation)
    const tail = result.then(() => undefined, () => undefined)
    this.decisionTails.set(sessionId, tail)
    return result.finally(() => {
      if (this.decisionTails.get(sessionId) === tail) this.decisionTails.delete(sessionId)
    })
  }

  private enqueueMutation<T>(sessionId: SessionId, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTails.get(sessionId) ?? Promise.resolve()
    const result = previous.then(operation)
    const tail = result.then(() => undefined, () => undefined)
    this.mutationTails.set(sessionId, tail)
    return result.finally(() => {
      if (this.mutationTails.get(sessionId) === tail) this.mutationTails.delete(sessionId)
    })
  }
}
