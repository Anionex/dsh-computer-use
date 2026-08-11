import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { allocateScreenshotPath, describeScreenshot } from '../src/artifacts.ts'
import { temporaryDirectory } from './helpers.ts'

describe('screenshot artifacts', () => {
  it('allocates and describes a regular PNG inside the workspace', async () => {
    const workspace = await temporaryDirectory('dsh-computer-artifact-')
    try {
      const path = await allocateScreenshotPath(workspace.path, '.artifacts', 'session-1' as never)
      expect(path.startsWith(await realpath(workspace.path))).toBe(true)
      await writeFile(path, Buffer.from('png'))
      const artifact = await describeScreenshot(path, 40, 30, 1024, 'computer_observe')
      expect(artifact).toMatchObject({
        path,
        mimeType: 'image/png',
        bytes: 3,
        width: 40,
        height: 30,
      })
      expect(await readFile(path, 'utf8')).toBe('png')
    } finally {
      await workspace.cleanup()
    }
  })

  it('rejects escaping roots, symlink components, oversized files, and invalid dimensions', async () => {
    const workspace = await temporaryDirectory('dsh-computer-artifact-invalid-')
    const outside = await temporaryDirectory('dsh-computer-artifact-outside-')
    try {
      await expect(allocateScreenshotPath(workspace.path, '../outside', 'session-1' as never)).rejects.toThrow(/escapes/)
      await mkdir(join(workspace.path, 'safe'))
      await symlink(outside.path, join(workspace.path, 'safe', 'link'))
      await expect(allocateScreenshotPath(workspace.path, 'safe/link', 'session-1' as never)).rejects.toThrow(/symbolic link/)
      const path = join(workspace.path, 'image.png')
      await writeFile(path, Buffer.alloc(32))
      await expect(describeScreenshot(path, 1, 1, 8, 'computer_action')).rejects.toThrow(/maxScreenshotBytes/)
      await expect(describeScreenshot(path, 0, 1, 64, 'computer_action')).rejects.toThrow(/dimensions/)
    } finally {
      await workspace.cleanup()
      await outside.cleanup()
    }
  })
})
