import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { dshSourceRoot } from '../scripts/dsh-source-root.mjs'

const temporary: string[] = []
const loaderPath = 'node_modules/tsx/dist/esm/index.mjs'

async function write(root: string, path: string, text = ''): Promise<string> {
  const target = join(root, path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, text)
  return target
}

async function checkout(version = '0.2.0-rc.2'): Promise<{ root: string; cli: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-source-root-test-'))
  temporary.push(root)
  await write(root, 'package.json', JSON.stringify({ name: '@deepseek-ai/dsh-root', version }))
  await write(root, 'apps/cli/package.json', JSON.stringify({ name: '@deepseek-ai/dsh', version }))
  await write(root, 'apps/cli/src/bin.ts', '// source CLI entry\n')
  await write(root, 'tsconfig.json', '{ "extends": "./tsconfig.base.json" }\n')
  await write(root, 'tsconfig.base.json', '{}\n')
  await write(root, loaderPath, '// installed tsx loader\n')
  return { root, cli: await write(root, 'apps/cli/lib/bin.js', '#!/usr/bin/env node\n') }
}

afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true })
})

describe('DSH source checkout discovery', () => {
  it.each(['0.2.0-rc.2', '0.1.7-rc.2', '1.0.0'])('accepts the current source layout without a version pin (%s)', async version => {
    const { root, cli } = await checkout(version)
    await expect(dshSourceRoot(cli)).resolves.toBe(await realpath(root))
  })

  it('follows a CLI symlink before walking source ancestors', async () => {
    const { root, cli } = await checkout()
    const directory = await mkdtemp(join(tmpdir(), 'dsh-source-bin-test-'))
    temporary.push(directory)
    const command = join(directory, 'dsh')
    await symlink(cli, command, 'file')
    await expect(dshSourceRoot(command)).resolves.toBe(await realpath(root))
  })

  it.each([
    ['package.json', '@other/source-root'],
    ['apps/cli/package.json', '@other/cli'],
  ])('rejects an unrelated package identity in %s', async (path, name) => {
    const { root, cli } = await checkout()
    await write(root, path, JSON.stringify({ name }))
    await expect(dshSourceRoot(cli)).rejects.toThrow('cannot infer DSH source root')
  })

  it.each(['apps/cli/src/bin.ts', 'tsconfig.json', 'tsconfig.base.json'])('requires the readable source marker %s', async path => {
    const { root, cli } = await checkout()
    await rm(join(root, path))
    await expect(dshSourceRoot(cli)).rejects.toThrow('cannot infer DSH source root')
  })

  it.each(['apps/cli/src/bin.ts', 'tsconfig.json', 'tsconfig.base.json'])('rejects a directory in place of source marker %s', async path => {
    const { root, cli } = await checkout()
    await rm(join(root, path))
    await mkdir(join(root, path))
    await expect(dshSourceRoot(cli)).rejects.toThrow('cannot infer DSH source root')
  })

  it('rejects an npm-only CLI installation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-npm-only-test-'))
    temporary.push(root)
    await write(root, 'package.json', JSON.stringify({ name: '@deepseek-ai/dsh' }))
    const cli = await write(root, 'lib/bin.js', '#!/usr/bin/env node\n')
    await expect(dshSourceRoot(cli)).rejects.toThrow('cannot infer DSH source root')
  })

  it.each(['package.json', 'apps/cli/package.json'])('rejects malformed JSON in source identity %s', async path => {
    const { root, cli } = await checkout()
    await write(root, path, '{ invalid JSON')
    await expect(dshSourceRoot(cli)).rejects.toThrow('cannot infer DSH source root')
  })

  it('rejects a null source identity without crashing property access', async () => {
    const { root, cli } = await checkout()
    await write(root, 'package.json', 'null')
    await expect(dshSourceRoot(cli)).rejects.toThrow('cannot infer DSH source root')
  })

  it('continues past malformed JSON in a nearer non-root candidate', async () => {
    const { root, cli } = await checkout()
    await write(root, 'apps/cli/lib/package.json', '{ invalid JSON')
    await expect(dshSourceRoot(cli)).resolves.toBe(await realpath(root))
  })

  it('accepts the sixth ancestor candidate', async () => {
    const { root } = await checkout()
    const cli = await write(root, 'a/b/c/d/e/dsh')
    await expect(dshSourceRoot(cli)).resolves.toBe(await realpath(root))
  })

  it('does not search beyond six ancestor candidates', async () => {
    const { root } = await checkout()
    const cli = await write(root, 'a/b/c/d/e/f/dsh')
    await expect(dshSourceRoot(cli)).rejects.toThrow('cannot infer DSH source root')
  })

  it('reports missing tsx dependencies separately from missing source', async () => {
    const { root, cli } = await checkout()
    await rm(join(root, loaderPath))
    await expect(dshSourceRoot(cli)).rejects.toThrow('missing a readable tsx loader; run pnpm install --frozen-lockfile')
  })

  it('rejects a directory in place of the tsx loader', async () => {
    const { root, cli } = await checkout()
    await rm(join(root, loaderPath))
    await mkdir(join(root, loaderPath))
    await expect(dshSourceRoot(cli)).rejects.toThrow('missing a readable tsx loader')
  })

  it('does not create or repair missing dependencies', async () => {
    const { root, cli } = await checkout()
    await rm(join(root, 'node_modules'), { recursive: true })
    await expect(dshSourceRoot(cli)).rejects.toThrow('missing a readable tsx loader')
    await expect(readFile(join(root, loaderPath))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
