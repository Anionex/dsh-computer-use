import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import {
  COMPUTER_USE_ACTIVATE,
  ComputerUseExposure,
  hasLoadedComputerUseSkill,
} from '../src/exposure.ts'
import { COMPUTER_USE_SKILL_CONTENT, COMPUTER_USE_SKILL_NAME } from '../src/skill.ts'

function loadedSession(): { events: unknown[] } {
  return {
    events: [{
      type: 'user/message',
      data: {
        source: { kind: 'skill-invocation', name: COMPUTER_USE_SKILL_NAME },
        content: [{ type: 'text', text: COMPUTER_USE_SKILL_CONTENT }],
      },
    }],
  }
}

describe('progressive Computer Use exposure', () => {
  it('recognizes only durable evidence containing the bundled Skill', () => {
    expect(COMPUTER_USE_SKILL_CONTENT).toContain('does not require danger-full-access')
    expect(hasLoadedComputerUseSkill(loadedSession() as never)).toBe(true)
    expect(hasLoadedComputerUseSkill({ events: [] } as never)).toBe(false)
    expect(hasLoadedComputerUseSkill({
      events: [{
        type: 'user/message',
        data: { source: { kind: 'skill-invocation', name: COMPUTER_USE_SKILL_NAME }, content: [{ type: 'text', text: '# Different' }] },
      }],
    } as never)).toBe(false)
    expect(hasLoadedComputerUseSkill({
      events: [{
        type: 'tool/call',
        data: { name: 'skill', callId: 'call-1', arguments: JSON.stringify({ name: COMPUTER_USE_SKILL_NAME }) },
      }, {
        type: 'tool/result',
        data: {
          message: {
            content: [{
              type: 'tool-result',
              toolCallId: 'call-1',
              isError: false,
              content: [{ type: 'text', text: COMPUTER_USE_SKILL_CONTENT }],
            }],
          },
        },
      }],
    } as never)).toBe(true)
  })

  it('activates tools only for an Agent that loaded the Skill and disposes its scope', async () => {
    const listeners = new Map<string, (...args: never[]) => unknown>()
    const registered: string[] = []
    const disposed: string[] = []
    let restrictionDisposed = false
    const agent = {
      id: 'agent-1',
      session: loadedSession(),
      ctx: {
        tools: {
          register(definition: ToolDefinition) {
            registered.push(definition.name)
            return () => { disposed.push(definition.name) }
          },
          restrict(value: unknown) {
            expect(value).toEqual({ deny: [COMPUTER_USE_ACTIVATE] })
            return () => { restrictionDisposed = true }
          },
        },
      },
    }
    const ctx = {
      on(name: string, listener: (...args: never[]) => unknown) {
        listeners.set(name, listener)
        return () => { listeners.delete(name) }
      },
      agents: { list: () => [agent] },
    }
    const definitions = [{ name: 'computer_observe' }, { name: 'computer_click' }] as ToolDefinition[]
    const exposure = new ComputerUseExposure(ctx as never, () => definitions)
    const dispose = exposure.install()
    expect(registered).toEqual(['computer_observe', 'computer_click'])
    await expect(exposure.activationTool.execute({}, { agent } as never)).resolves.toEqual({
      activated: false,
      tools: ['computer_observe', 'computer_click'],
    })
    dispose()
    expect(restrictionDisposed).toBe(true)
    expect(disposed).toEqual(['computer_click', 'computer_observe'])
    expect(listeners.size).toBe(0)
  })

  it('fails activation before durable Skill evidence and activates on a successful Skill result', async () => {
    const listeners = new Map<string, (...args: never[]) => unknown>()
    const registered: string[] = []
    const agent = {
      id: 'agent-2',
      session: { events: [] },
      ctx: {
        tools: {
          register(definition: ToolDefinition) { registered.push(definition.name); return () => {} },
          restrict: () => () => {},
        },
      },
    }
    const ctx = {
      on(name: string, listener: (...args: never[]) => unknown) { listeners.set(name, listener); return () => {} },
      agents: { list: () => [agent] },
    }
    const exposure = new ComputerUseExposure(ctx as never, () => [{ name: 'computer_observe' }] as ToolDefinition[])
    exposure.install()
    await expect(exposure.activationTool.execute({}, { agent } as never)).rejects.toThrow(/load the computer-use Skill first/)
    const listener = listeners.get('tools/result')
    expect(listener).toBeDefined()
    listener?.(
      { name: 'skill', agent, arguments: { name: COMPUTER_USE_SKILL_NAME } },
      { isError: false, value: { name: COMPUTER_USE_SKILL_NAME, content: COMPUTER_USE_SKILL_CONTENT } },
    )
    expect(registered).toEqual(['computer_observe'])
  })

  it('rolls back a partially registered generation', () => {
    const disposed: string[] = []
    let count = 0
    const agent = {
      id: 'agent-3',
      session: loadedSession(),
      ctx: {
        tools: {
          register(definition: ToolDefinition) {
            count += 1
            if (count === 2) throw new Error('registration failed')
            return () => { disposed.push(definition.name) }
          },
          restrict: () => () => {},
        },
      },
    }
    const ctx = {
      on: () => () => {},
      agents: { list: () => [agent] },
    }
    const exposure = new ComputerUseExposure(ctx as never, () => [
      { name: 'computer_observe' },
      { name: 'computer_click' },
    ] as ToolDefinition[])
    expect(() => exposure.install()).toThrow('registration failed')
    expect(disposed).toEqual(['computer_observe'])
  })
})
