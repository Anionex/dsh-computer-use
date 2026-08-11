import { describe, expect, it } from 'vitest'
import ComputerUseDefault, { ComputerUseBundle, installComputerUseConsumer } from '../src/index.ts'
import { COMPUTER_USE_ACTIVATE } from '../src/exposure.ts'
import { MacOSComputerUseProvider } from '../src/providers/macos.ts'

describe('Cordis registration contracts', () => {
  it('exports one aggregate class plugin with provider and consumer injections', () => {
    expect(ComputerUseDefault).toBe(ComputerUseBundle)
    expect(ComputerUseBundle.prototype).toBeInstanceOf(MacOSComputerUseProvider)
    expect(ComputerUseBundle.inject).toEqual(['subprocess', 'approval', 'settings', 'agents', 'tools', 'skills'])
    expect(ComputerUseBundle.Config).toBeDefined()
  })

  it('registers and reverses the deployment Skill plus activation controller', () => {
    const registeredTools: string[] = []
    const registeredSkills: string[] = []
    const disposed: string[] = []
    const ctx = {
      computerUse: {},
      tools: {
        register(definition: { name: string }) {
          registeredTools.push(definition.name)
          return () => { disposed.push(`tool:${definition.name}`) }
        },
      },
      skills: {
        register(skill: { name: string }) {
          registeredSkills.push(skill.name)
          return () => { disposed.push(`skill:${skill.name}`) }
        },
      },
      agents: { list: () => [] },
      on: () => () => { disposed.push('listener') },
      inject: () => {},
    }
    const dispose = installComputerUseConsumer(ctx as never)
    expect(registeredTools).toEqual([COMPUTER_USE_ACTIVATE])
    expect(registeredSkills).toEqual(['computer-use'])
    dispose()
    expect(disposed).toEqual(expect.arrayContaining([
      'skill:computer-use',
      `tool:${COMPUTER_USE_ACTIVATE}`,
      'listener',
    ]))
  })

  it('rolls back activation when Skill registration fails', () => {
    let activationDisposed = false
    const ctx = {
      computerUse: {},
      tools: { register: () => () => { activationDisposed = true } },
      skills: { register: () => { throw new Error('skill failed') } },
      agents: { list: () => [] },
      on: () => () => {},
      inject: () => {},
    }
    expect(() => installComputerUseConsumer(ctx as never)).toThrow('skill failed')
    expect(activationDisposed).toBe(true)
  })

  it('declares the provider as the complete macOS Service provider role', () => {
    expect(MacOSComputerUseProvider.inject).toEqual(['subprocess', 'approval', 'settings', 'agents'])
    expect(MacOSComputerUseProvider.Config).toBeDefined()
  })
})
