/** Workspace-fenced screenshot artifact allocation and validation. */
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { ComputerUseError } from "./errors.js";
function isWithin(root, candidate) {
    const rel = relative(root, candidate);
    return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}
async function rejectSymlinkComponents(root, target) {
    const rel = relative(root, target);
    let current = root;
    for (const part of rel.split(sep).filter(Boolean)) {
        current = resolve(current, part);
        try {
            const info = await lstat(current);
            if (info.isSymbolicLink()) {
                throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', `artifact path component must not be a symbolic link: ${part}`);
            }
        }
        catch (error) {
            if (error instanceof ComputerUseError)
                throw error;
            const code = error.code;
            if (code !== 'ENOENT')
                throw error;
        }
    }
}
/** Allocate a unique managed PNG path inside the current Session workspace. */
export async function allocateScreenshotPath(workspace, artifactRoot, sessionId) {
    const realWorkspace = await realpath(workspace);
    const directory = resolve(realWorkspace, artifactRoot, String(sessionId));
    if (!isWithin(realWorkspace, directory)) {
        throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'artifactRoot escapes the Session workspace');
    }
    await rejectSymlinkComponents(realWorkspace, directory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const realDirectory = await realpath(directory);
    if (!isWithin(realWorkspace, realDirectory)) {
        throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'artifact directory escaped the Session workspace');
    }
    return resolve(realDirectory, `observation-${randomUUID()}.png`);
}
/** Validate a committed screenshot and return its stable model/client descriptor. */
export async function describeScreenshot(path, width, height, maxBytes, sourceTool) {
    const link = await lstat(path).catch((error) => {
        throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'the screenshot artifact was not created', { cause: error });
    });
    if (link.isSymbolicLink() || !link.isFile()) {
        throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'the screenshot artifact must be a regular non-symbolic-link file');
    }
    const info = await stat(path);
    if (info.size > maxBytes) {
        throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', `screenshot exceeds maxScreenshotBytes (${info.size} > ${maxBytes})`);
    }
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
        throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'provider returned invalid screenshot dimensions');
    }
    return {
        path,
        filename: basename(path),
        mimeType: 'image/png',
        kind: 'image',
        description: 'Current macOS application window observation',
        sourceTool,
        previewIntent: 'image',
        bytes: info.size,
        width,
        height,
    };
}
//# sourceMappingURL=artifacts.js.map