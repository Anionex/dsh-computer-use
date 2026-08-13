/** Workspace-fenced screenshot artifact allocation and validation. */
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { ComputerArtifact } from './types.ts';
/** Screenshot description that hands visual analysis to the sibling Vision Toolkit. */
export declare const COMPUTER_SCREENSHOT_DESCRIPTION: string;
/** Allocate a unique managed PNG path inside the current Session workspace. */
export declare function allocateScreenshotPath(workspace: string, artifactRoot: string, sessionId: SessionId): Promise<string>;
/** Validate a committed screenshot and return its stable model/client descriptor. */
export declare function describeScreenshot(path: string, width: number, height: number, maxBytes: number, sourceTool: ComputerArtifact['sourceTool']): Promise<ComputerArtifact>;
//# sourceMappingURL=artifacts.d.ts.map