import { afterEach, describe, expect, it, vi } from 'vitest'
import { Service } from '@deepseek-ai/cordis'
import ComputerUseBundle from '../src/index.ts'
import { MacOSComputerUseProvider } from '../src/providers/macos.ts'

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
if (platformDescriptor === undefined) throw new Error('process.platform descriptor is missing')

function mockPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

function restorePlatform(): void {
  Object.defineProperty(process, 'platform', platformDescriptor)
}

function harness() {
  const registeredTools: string[] = []
  const registeredSkills: string[] = []
  const ctx = {
    settings: {
      register: () => ({
        get: () => ({}),
        watch: () => () => {},
      }),
    },
    tools: {
      register: (definition: { name: string }) => {
        registeredTools.push(definition.name)
        return () => {}
      },
      guard: () => () => {},
      get: () => undefined,
    },
    skills: {
      register: (skill: { name: string }) => {
        registeredSkills.push(skill.name)
        return () => {}
      },
    },
    agents: { list: () => [] },
    on: () => () => {},
    inject: () => ({ dispose: () => {} }),
    get: () => undefined,
    reflect: { provide: () => {} },
    logger: { warn: vi.fn() },
    effect: () => () => {},
  }
  return { ctx, registeredTools, registeredSkills }
}

class TestUnsupportedProvider extends MacOSComputerUseProvider {
  initializeForTest(): Promise<void> {
    return this.initialize()
  }
}

class TestUnsupportedBundle extends ComputerUseBundle {
  serviceInitForTest(): Promise<void> {
    return this[Service.init]()
  }
}

afterEach(() => {
  restorePlatform()
})

describe('non-macOS graceful degradation', () => {
  it('constructs and initializes as unavailable instead of throwing on Windows', async () => {
    mockPlatform('win32')
    const { ctx } = harness()
    const provider = new TestUnsupportedProvider(ctx as never)
    await provider.initializeForTest()
    expect(provider.status()).toMatchObject({
      platform: 'win32',
      provider: 'unsupported',
      ready: false,
      helperPath: '',
      accessibility: 'unavailable',
      screenRecording: 'unavailable',
    })
    expect(provider.status().lastError).toContain('supports macOS only')
  })

  it('fails every Computer Use call closed with COMPUTER_UNSUPPORTED_PLATFORM', async () => {
    mockPlatform('linux')
    const { ctx } = harness()
    const provider = new TestUnsupportedProvider(ctx as never)
    const context = {
      agent: {},
      workspace: '/tmp',
      signal: new AbortController().signal,
    }
    await expect(provider.listApps(context as never)).rejects.toMatchObject({ code: 'COMPUTER_UNSUPPORTED_PLATFORM' })
    await expect(provider.openPermissionSettings('accessibility', new AbortController().signal))
      .rejects.toMatchObject({ code: 'COMPUTER_UNSUPPORTED_PLATFORM' })
  })

  it('keeps the Bundle starting while the Skill and Computer Use Tools stay unregistered', async () => {
    mockPlatform('win32')
    const { ctx, registeredTools, registeredSkills } = harness()
    const bundle = new TestUnsupportedBundle(ctx as never)
    await bundle.serviceInitForTest()
    expect(bundle.status()).toMatchObject({ platform: 'win32', provider: 'unsupported', ready: false })
    expect(registeredTools).toEqual([])
    expect(registeredSkills).toEqual([])
  })
})
