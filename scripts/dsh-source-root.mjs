import { constants } from 'node:fs'
import { access, readFile, realpath, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

async function readableFile(path) {
  if (!(await stat(path)).isFile()) return false
  await access(path, constants.R_OK)
  return true
}

async function isSourceRoot(directory) {
  try {
    const rootPackage = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    const cliPackage = JSON.parse(await readFile(join(directory, 'apps', 'cli', 'package.json'), 'utf8'))
    if (rootPackage?.name !== '@deepseek-ai/dsh-root' || cliPackage?.name !== '@deepseek-ai/dsh') return false
    const markers = ['apps/cli/src/bin.ts', 'tsconfig.json', 'tsconfig.base.json']
    return (await Promise.all(markers.map(path => readableFile(join(directory, path))))).every(Boolean)
  } catch (error) {
    if (error instanceof SyntaxError || ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error?.code)) return false
    throw error
  }
}

/** Find a source checkout from the real CLI path and verify its checker loader. */
export async function dshSourceRoot(executablePath) {
  const dsh = await realpath(executablePath)
  let candidate = dirname(dsh)
  for (let depth = 0; depth < 6; depth += 1) {
    if (await isSourceRoot(candidate)) {
      const loader = join(candidate, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs')
      try {
        if (!(await readableFile(loader))) throw new Error('tsx loader is not a file')
      } catch (error) {
        throw new Error(`DSH source checkout at ${candidate} is missing a readable tsx loader; run pnpm install --frozen-lockfile in that checkout`, { cause: error })
      }
      return await realpath(candidate)
    }
    const parent = dirname(candidate)
    if (parent === candidate) break
    candidate = parent
  }
  throw new Error(`cannot infer DSH source root from ${dsh}`)
}
