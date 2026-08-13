/** Workspace-fenced screenshot artifact allocation and validation. */

import { randomUUID } from 'node:crypto'
import { lstat, mkdir, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { ComputerUseError } from './errors.ts'
import type { ComputerArtifact } from './types.ts'

/** Screenshot description that hands visual analysis to the sibling Vision Toolkit. */
export const COMPUTER_SCREENSHOT_DESCRIPTION = [
  'Current macOS application window observation.',
  'For OCR, visual grounding, or pixel inspection, load the vision-tools Skill and pass this exact path to vision_glance, vision_ground, vision_detect, or vision_crop;',
  'do not recreate OCR with bash, tesseract, or an ad hoc script.',
].join(' ')

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

async function rejectSymlinkComponents(root: string, target: string): Promise<void> {
  const rel = relative(root, target)
  let current = root
  for (const part of rel.split(sep).filter(Boolean)) {
    current = resolve(current, part)
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink()) {
        throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', `artifact path component must not be a symbolic link: ${part}`)
      }
    } catch (error) {
      if (error instanceof ComputerUseError) throw error
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw error
    }
  }
}

/** Allocate a unique managed PNG path inside the current Session workspace. */
export async function allocateScreenshotPath(
  workspace: string,
  artifactRoot: string,
  sessionId: SessionId,
): Promise<string> {
  const realWorkspace = await realpath(workspace)
  const directory = resolve(realWorkspace, artifactRoot, String(sessionId))
  if (!isWithin(realWorkspace, directory)) {
    throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'artifactRoot escapes the Session workspace')
  }
  await rejectSymlinkComponents(realWorkspace, directory)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const realDirectory = await realpath(directory)
  if (!isWithin(realWorkspace, realDirectory)) {
    throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'artifact directory escaped the Session workspace')
  }
  return resolve(realDirectory, `observation-${randomUUID()}.png`)
}

/** Validate a committed screenshot and return its stable model/client descriptor. */
export async function describeScreenshot(
  path: string,
  width: number,
  height: number,
  maxBytes: number,
  sourceTool: ComputerArtifact['sourceTool'],
): Promise<ComputerArtifact> {
  const link = await lstat(path).catch((error: unknown) => {
    throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'the screenshot artifact was not created', { cause: error })
  })
  if (link.isSymbolicLink() || !link.isFile()) {
    throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'the screenshot artifact must be a regular non-symbolic-link file')
  }
  const info = await stat(path)
  if (info.size > maxBytes) {
    throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', `screenshot exceeds maxScreenshotBytes (${info.size} > ${maxBytes})`)
  }
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'provider returned invalid screenshot dimensions')
  }
  return {
    path,
    filename: basename(path),
    mimeType: 'image/png',
    kind: 'image',
    description: COMPUTER_SCREENSHOT_DESCRIPTION,
    sourceTool,
    previewIntent: 'image',
    bytes: info.size,
    width,
    height,
  }
}
