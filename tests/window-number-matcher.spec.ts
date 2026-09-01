import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { temporaryDirectory } from './helpers.ts'

const execFileAsync = promisify(execFile)
const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const MATCHER = join(ROOT, 'native', 'macos', 'Sources', 'Helper', 'WindowNumberMatcher.swift')
const CASES = join(ROOT, 'native', 'macos', 'Tests', 'WindowNumberMatcherTests.swift')

describe.skipIf(process.platform !== 'darwin')('native window-number matcher', () => {
  it('disambiguates only on one non-empty title match and otherwise fails closed', async () => {
    const temporary = await temporaryDirectory('dsh-computer-window-matcher-')
    try {
      const executable = join(temporary.path, 'window-number-matcher-tests')
      await execFileAsync('xcrun', [
        'swiftc',
        '-swift-version', '5',
        '-parse-as-library',
        MATCHER,
        CASES,
        '-o', executable,
      ], { timeout: 60_000 })
      const result = await execFileAsync(executable, [], { timeout: 10_000 })
      expect(result.stdout).toContain('PASS WindowNumberMatcherTests (5 cases)')
    } finally {
      await temporary.cleanup()
    }
  }, 80_000)
})
