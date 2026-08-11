import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const PACKAGE = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as {
  name: string
  main: string
  types: string
  exports: Record<string, unknown>
  files: string[]
  scripts: Record<string, string>
  dsh?: { bundle?: { patch?: string }; client?: { platform?: string; inject?: string[] } }
  dshClient?: unknown
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

async function javascriptFiles(directory: string): Promise<string[]> {
  const paths: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) paths.push(...await javascriptFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.js')) paths.push(path)
  }
  return paths
}

describe('published package layout', () => {
  it('declares a portable DSH Bundle, Web client, and built entry points', async () => {
    expect(PACKAGE.name).toBe('@dsh-external/dsh-computer-use')
    expect(PACKAGE.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(PACKAGE.dsh?.client).toMatchObject({ platform: 'web' })
    expect(PACKAGE.dshClient).toBeUndefined()
    expect(PACKAGE.main).toBe('lib/index.js')
    expect(PACKAGE.types).toBe('lib/types/index.d.ts')
    expect(PACKAGE.exports['.']).toEqual({ types: './lib/types/index.d.ts', default: './lib/index.js' })
    expect(PACKAGE.exports['./provider-macos']).toEqual({
      types: './lib/types/providers/macos.d.ts',
      default: './lib/providers/macos.js',
    })
    expect(PACKAGE.exports['./client']).toEqual({
      types: './lib/types/client/index.d.ts',
      default: './lib/client.js',
    })
    for (const path of [
      'cordis.patch.yml',
      'lib/index.js',
      'lib/types/index.d.ts',
      'lib/providers/macos.js',
      'lib/types/providers/macos.d.ts',
      'lib/client.js',
      'native/macos/bin/dsh-computer-use-helper',
      'native/macos/manifest.json',
      'scripts/validate.mjs',
      'scripts/model-e2e.mjs',
    ]) await expect(stat(join(ROOT, path))).resolves.toBeDefined()
  })

  it('ships runtime, source, native inputs, validation, docs, and license', () => {
    for (const required of [
      'lib',
      'src',
      'native/macos/Sources',
      'native/macos/bin',
      'native/macos/manifest.json',
      'scripts',
      'cordis.patch.yml',
      'README.md',
      'README.zh.md',
      'LICENSE',
    ]) expect(PACKAGE.files).toContain(required)
  })

  it('has build, prepack, tests, and one-command validation', () => {
    expect(PACKAGE.scripts.build).toContain('native:build')
    expect(PACKAGE.scripts.build).toContain('tsc -p tsconfig.json')
    expect(PACKAGE.scripts.prepack).toContain('build')
    expect(PACKAGE.scripts.test).toContain('vitest')
    expect(PACKAGE.scripts.validate).toContain('validate.mjs')
    expect(PACKAGE.scripts['test:model']).toContain('model-e2e.mjs')
    expect(PACKAGE.scripts['validate:model']).toContain('model-e2e.mjs')
    expect(PACKAGE.scripts['validate:release']).toContain('validate:model')
  })

  it('keeps dependency specifiers portable', () => {
    expect(PACKAGE.peerDependencies).toHaveProperty('@deepseek-ai/dsh-tools')
    for (const section of [PACKAGE.dependencies ?? {}, PACKAGE.peerDependencies ?? {}, PACKAGE.devDependencies ?? {}]) {
      for (const [name, spec] of Object.entries(section)) {
        expect(spec, name).not.toMatch(/^\/|^[A-Za-z]:\\|^file:|^link:|^workspace:/)
      }
    }
  })

  it('keeps the local npm credential file out of Git', async () => {
    expect((await readFile(join(ROOT, '.gitignore'), 'utf8')).split(/\r?\n/u)).toContain('.npmrc')
  })

  it('emits loader-compatible client code and no raw TypeScript relative imports', async () => {
    expect(await readFile(join(ROOT, 'lib', 'client.js'), 'utf8')).toContain('window.__ModuleLoader__.load')
    for (const file of await javascriptFiles(join(ROOT, 'lib'))) {
      const source = await readFile(file, 'utf8')
      expect(source, file).not.toMatch(/from ['"]\.\.?\/[^'"]+\.ts['"]/)
    }
  })

  it('runs the real-model release lane under workspace-write', async () => {
    const source = await readFile(join(ROOT, 'scripts', 'model-e2e.mjs'), 'utf8')
    expect(source).toContain("DSH_PERMISSION_MODE: 'workspace-write'")
    expect(source).not.toContain("DSH_PERMISSION_MODE: 'danger-full-access'")
  })
})
