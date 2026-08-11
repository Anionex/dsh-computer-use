/** Agent-scoped progressive exposure for Computer Use execution Tools. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Context } from 'cordis'
import { COMPUTER_USE_SKILL_CONTENT, COMPUTER_USE_SKILL_NAME } from './skill.ts'

/** One global bootstrap retained until the current Agent loads the Skill. */
export const COMPUTER_USE_ACTIVATE = 'computer_use_activate'

interface AgentExposure {
  active: boolean
  hideActivation?: () => void
  toolDisposers: Array<() => void>
  toolNames: string[]
}

/** Activation result returned to the model. */
export interface ComputerUseActivationResult {
  activated: boolean
  tools: string[]
}

function renderJson(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isSkillArguments(value: unknown): boolean {
  return isRecord(value) && value.name === COMPUTER_USE_SKILL_NAME
}

function nativeSkillCall(raw: string): boolean {
  try { return isSkillArguments(JSON.parse(raw)) } catch { return false }
}

function containsSkillContent(blocks: readonly unknown[]): boolean {
  return blocks.some(block => isRecord(block)
    && block.type === 'text'
    && typeof block.text === 'string'
    && block.text.includes(COMPUTER_USE_SKILL_CONTENT))
}

function isSkillResult(value: unknown): boolean {
  return isRecord(value)
    && value.name === COMPUTER_USE_SKILL_NAME
    && value.content === COMPUTER_USE_SKILL_CONTENT
}

/** Whether durable Session history proves that the bundled Skill was loaded. */
export function hasLoadedComputerUseSkill(session: Session): boolean {
  const nativeCalls = new Set<string>()
  for (const event of session.events) {
    if (event.type === 'user/message') {
      const source = event.data.source
      if (source.kind === 'skill-invocation'
        && source.name === COMPUTER_USE_SKILL_NAME
        && containsSkillContent(event.data.content)) return true
      continue
    }
    if (event.type === 'tool/call') {
      if (event.data.name === 'skill' && nativeSkillCall(event.data.arguments)) nativeCalls.add(String(event.data.callId))
      continue
    }
    if (event.type === 'tool/result') {
      const [block] = event.data.message.content
      if (block?.type === 'tool-result'
        && block.isError !== true
        && nativeCalls.has(String(block.toolCallId))
        && containsSkillContent(block.content)) return true
      continue
    }
    if (event.type === 'tool/code-dispatch'
      && event.data.name === 'skill'
      && event.data.isError === false
      && isSkillArguments(event.data.arguments)
      && containsSkillContent(event.data.content)) return true
  }
  return false
}

/** Owns one progressive Tool-exposure generation. */
export class ComputerUseExposure {
  readonly activationTool: ToolDefinition
  private readonly states = new Map<Agent, AgentExposure>()
  private installed = false

  constructor(
    private readonly ctx: Context,
    private readonly createTools: () => ToolDefinition[],
  ) {
    this.activationTool = defineTool({
      name: COMPUTER_USE_ACTIVATE,
      description: `Activate the macOS Computer Use execution tools for this Agent after loading the ${COMPUTER_USE_SKILL_NAME} Skill. The Skill tool normally activates them automatically; call this only after a direct Skill invocation when the tools are still absent. This bootstrap disappears after success.`,
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            activated: { type: 'boolean', required: true },
            tools: { type: 'array', items: { type: 'string' }, required: true },
          },
        },
        render: renderJson,
      },
      execute: (_args, exec): Promise<ComputerUseActivationResult> => {
        if (exec.agent === undefined) throw new Error(`${COMPUTER_USE_ACTIVATE}: an Agent Session is required`)
        if (!hasLoadedComputerUseSkill(exec.agent.session)) {
          throw new Error(`${COMPUTER_USE_ACTIVATE}: load the ${COMPUTER_USE_SKILL_NAME} Skill first`)
        }
        return Promise.resolve(this.activate(exec.agent))
      },
      presentCall: () => ({ card: 'generic', title: 'Activate Computer Use', kind: 'execute' }),
    })
  }

  /** Install lifecycle listeners and adopt existing Agents. */
  install(): () => void {
    if (this.installed) throw new Error('dsh-computer-use: progressive exposure is already installed')
    this.installed = true
    const listeners = [
      this.ctx.on('agent/created', ({ agent }) => { this.attach(agent) }),
      this.ctx.on('agent/disposed', ({ agent }) => { this.detach(agent) }),
      this.ctx.on('tools/result', (exec, result) => {
        if (result.isError === false
          && exec.name === 'skill'
          && exec.agent !== undefined
          && isSkillArguments(exec.arguments)
          && isSkillResult(result.value)) this.activate(exec.agent)
        return undefined
      }),
    ]
    try {
      for (const agent of this.ctx.agents.list()) this.attach(agent)
    } catch (error) {
      for (const dispose of listeners.reverse()) dispose()
      this.disposeStates()
      this.installed = false
      throw error
    }
    return () => {
      if (!this.installed) return
      this.installed = false
      for (const dispose of listeners.reverse()) dispose()
      this.disposeStates()
    }
  }

  private attach(agent: Agent): void {
    if (this.states.has(agent)) return
    this.states.set(agent, { active: false, toolDisposers: [], toolNames: [] })
    if (hasLoadedComputerUseSkill(agent.session)) this.activate(agent)
  }

  private activate(agent: Agent): ComputerUseActivationResult {
    this.attach(agent)
    const state = this.states.get(agent)
    if (state === undefined) throw new Error(`dsh-computer-use: Agent ${String(agent.id)} has no exposure state`)
    if (state.active) return { activated: false, tools: [...state.toolNames] }
    const definitions = this.createTools()
    const toolDisposers: Array<() => void> = []
    let hideActivation: (() => void) | undefined
    try {
      for (const definition of definitions) toolDisposers.push(agent.ctx.tools.register(definition))
      hideActivation = agent.ctx.tools.restrict({ deny: [COMPUTER_USE_ACTIVATE] })
    } catch (error) {
      hideActivation?.()
      for (const dispose of toolDisposers.reverse()) dispose()
      throw error
    }
    state.active = true
    state.hideActivation = hideActivation
    state.toolDisposers = toolDisposers
    state.toolNames = definitions.map(definition => definition.name)
    return { activated: true, tools: [...state.toolNames] }
  }

  private detach(agent: Agent): void {
    const state = this.states.get(agent)
    if (state === undefined) return
    this.states.delete(agent)
    this.disposeState(state)
  }

  private disposeStates(): void {
    for (const state of this.states.values()) this.disposeState(state)
    this.states.clear()
  }

  private disposeState(state: AgentExposure): void {
    state.hideActivation?.()
    for (const dispose of state.toolDisposers.reverse()) dispose()
  }
}
