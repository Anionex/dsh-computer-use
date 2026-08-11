/** Durable per-Session read leases and per-turn control leases. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Context } from 'cordis'
import type { ResolvedComputerUseConfig } from './config.ts'
import { ComputerUseError } from './errors.ts'
import type { ComputerAppIdentity } from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** A granted Computer Use application lease; read lasts the Session and control the named turn. */
    'computer-use/lease': {
      bundleId: string
      scope: 'read' | 'control'
      turn?: number
      source: 'approval'
    }
    /** A rejected Computer Use application approval; the same scope is not asked again in this Session. */
    'computer-use/denied': {
      bundleId: string
      scope: 'read' | 'control'
    }
  }
}

function currentTurn(events: readonly SessionEvent[]): number | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'turn/end') return undefined
    if (event?.type === 'turn/start') return event.data.turn
  }
  return undefined
}

/** Source of the technical application lease used by an operation. */
export type ComputerLeaseSource = 'configured' | 'approved'

/** Applies configured app policy and routes missing leases through DSH approval. */
export class ComputerLeaseManager {
  constructor(
    private readonly ctx: Context,
    private readonly config: () => ResolvedComputerUseConfig,
  ) {}

  /** Ensure one Agent may read or control one exact running application. */
  async ensure(
    agent: Agent,
    app: ComputerAppIdentity,
    scope: 'read' | 'control',
    toolName: string,
    callId: CallId | undefined,
    signal: AbortSignal,
  ): Promise<ComputerLeaseSource> {
    const configured = this.config().grants.find(grant => grant.bundleId === app.bundleId)
    if (configured?.[scope] === true) return 'configured'
    const turn = currentTurn(agent.session.events)
    if (turn === undefined) {
      throw new ComputerUseError('COMPUTER_PERMISSION_REQUIRED', `${scope} access for ${app.name} must be requested inside an open Agent turn`)
    }
    const existing = agent.session.events.some((event) => {
      if (event.type !== 'computer-use/lease') return false
      if (event.data.bundleId !== app.bundleId || event.data.scope !== scope) return false
      return scope === 'read' || event.data.turn === turn
    })
    if (existing) return 'approved'
    const denied = agent.session.events.some((event) => {
      if (event.type !== 'computer-use/denied') return false
      return event.data.bundleId === app.bundleId && event.data.scope === scope
    })
    if (denied) {
      throw new ComputerUseError('COMPUTER_PERMISSION_REQUIRED', `${scope} access for ${app.name} was rejected earlier in this Session; do not retry without new user instructions`)
    }
    const outcome = await this.ctx.approval.request({
      agent,
      toolName,
      ...(callId === undefined ? {} : { callId }),
      reason: scope === 'read'
        ? `Allow this Agent to inspect the Accessibility state${scope === 'read' ? ' and requested screenshot' : ''} of ${app.name} (${app.bundleId}) for this Session.`
        : `Allow this Agent to send UI input to ${app.name} (${app.bundleId}) for the current turn.`,
      signal,
    })
    if (outcome === 'cancelled') {
      throw new ComputerUseError('COMPUTER_CANCELLED', `${scope} access request for ${app.name} was cancelled`)
    }
    if (outcome === 'rejected') {
      agent.session.append('computer-use/denied', { bundleId: app.bundleId, scope })
      throw new ComputerUseError('COMPUTER_PERMISSION_REQUIRED', `${scope} access for ${app.name} was not granted (rejected); do not retry in this Session without new user instructions`)
    }
    if (outcome !== 'allowed-once') {
      throw new ComputerUseError('COMPUTER_PERMISSION_REQUIRED', `${scope} access for ${app.name} was not granted (${outcome})`)
    }
    agent.session.append('computer-use/lease', {
      bundleId: app.bundleId,
      scope,
      ...(scope === 'control' ? { turn } : {}),
      source: 'approval',
    })
    return 'approved'
  }
}
