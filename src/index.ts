/** DSH Computer Use model-facing consumer and progressive Skill bundle. */

import { Service, type Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-tools'
import { Config, type ComputerUseConfig } from './config.ts'
import { ComputerUseExposure } from './exposure.ts'
import { MacOSComputerUseProvider } from './providers/macos.ts'
import { COMPUTER_USE_SKILL } from './skill.ts'
import { createComputerUseTools } from './tools.ts'
import { installComputerUseWeb } from './web.ts'

export { Config } from './config.ts'
export * from './errors.ts'
export * from './service.ts'
export * from './types.ts'

/** Register the portable Skill, bootstrap, Agent-scoped Tools, and optional Web diagnostics. */
export function installComputerUseConsumer(ctx: Context): () => void {
  const exposure = new ComputerUseExposure(ctx, () => createComputerUseTools(ctx.computerUse))
  let activation: (() => void) | undefined
  let skill: (() => void) | undefined
  let exposureDispose: (() => void) | undefined
  try {
    activation = ctx.tools.register(exposure.activationTool)
    skill = ctx.skills.register(COMPUTER_USE_SKILL)
    exposureDispose = exposure.install()
    installComputerUseWeb(ctx)
  } catch (error) {
    exposureDispose?.()
    skill?.()
    activation?.()
    throw error
  }
  return () => {
    exposureDispose?.()
    activation?.()
    skill?.()
  }
}

/** macOS provider plus the portable Skill, scoped Tools, and optional Web diagnostics. */
export class ComputerUseBundle extends MacOSComputerUseProvider {
  static override inject = ['subprocess', 'approval', 'settings', 'sessions', 'agents', 'tools', 'skills']
  static override Config = Config

  private consumerDispose: (() => void) | undefined

  constructor(ctx: Context, config: ComputerUseConfig = {}) {
    super(ctx, config)
    ctx.effect(() => () => {
      this.consumerDispose?.()
      this.consumerDispose = undefined
    }, 'dsh-computer-use: consumer lifecycle')
  }

  /** Publish model-facing capabilities only after provider integrity and health pass. */
  protected override async [Service.init](): Promise<void> {
    await super[Service.init]()
    this.consumerDispose = installComputerUseConsumer(this.ctx)
  }
}

export default ComputerUseBundle
