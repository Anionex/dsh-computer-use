import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { temporaryDirectory } from './helpers.ts'

const execFileAsync = promisify(execFile)
const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))

describe.skipIf(process.platform !== 'darwin')('native click routing without desktop access', () => {
  it('delivers at most one successful input and preserves non-Electron AX routes', async () => {
    const temporary = await temporaryDirectory('dsh-click-routing-')
    try {
      const executable = join(temporary.path, 'click-routing-tests')
      await execFileAsync('xcrun', ['swiftc', '-swift-version', '5', '-parse-as-library',
        join(ROOT, 'native/macos/Sources/Helper/ElementClickRouting.swift'),
        join(ROOT, 'native/macos/Tests/ElementClickRoutingTests.swift'), '-o', executable,
      ], { timeout: 60_000 })
      const result = await execFileAsync(executable, [], { timeout: 10_000 })
      expect(result.stdout).toContain('PASS ElementClickRoutingTests (9 cases; no desktop access)')
    } finally {
      await temporary.cleanup()
    }
  }, 80_000)
})
