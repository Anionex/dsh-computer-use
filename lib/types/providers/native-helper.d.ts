/** Managed invocation and integrity checks for the fixed-command Swift helper. */
import type { Context } from '@deepseek-ai/cordis';
import type { CursorVisibility } from '../backend.ts';
import type { ResolvedComputerUseConfig } from '../config.ts';
export interface PreparedNativeDrag<T> {
    readonly result: Promise<T>;
    start(): Promise<void>;
    cancel(): void;
}
/** Exact helper paths and integrity data for one active generation. */
export interface PreparedNativeHelper {
    path: string;
    version: string;
    sha256: string;
}
/** Invokes only the packaged JSON protocol through `ctx.subprocess`; no source or shell reaches the helper. */
export declare class NativeHelperClient {
    private readonly ctx;
    private readonly config;
    private readonly managedRoot;
    private prepared?;
    private cursor;
    private cursorStart;
    private cursorCommandTail;
    private disposed;
    constructor(ctx: Context, config: ResolvedComputerUseConfig, managedRoot?: string);
    /** Absolute executable path selected by explicit override or the packaged managed binary. */
    get helperPath(): string;
    /** Verify platform, file type, packaged hash, and executable mode before use. */
    prepare(signal: AbortSignal): Promise<PreparedNativeHelper>;
    /** Invoke one fixed helper command and parse its bounded JSON envelope. */
    invoke<T>(request: Record<string, unknown>, signal: AbortSignal): Promise<T>;
    /** Prepare and validate a drag, then wait for an explicit pre-mouse-down start barrier. */
    prepareDrag<T>(request: Record<string, unknown>, signal: AbortSignal, readinessTimeoutMs: number): Promise<PreparedNativeDrag<T>>;
    /** Send one serialized command to the persistent, click-through Agent cursor overlay. */
    cursorCommand(command: Record<string, unknown>, signal: AbortSignal, onWritten?: () => void | Promise<void>): Promise<CursorVisibility>;
    private executeCursorCommand;
    private discardCursor;
    /** Stop the cursor process before a provider generation is replaced or disposed. */
    dispose(): Promise<void>;
    /** Prepared integrity facts used by provider health. */
    preparedInfo(): PreparedNativeHelper;
    private buildManaged;
    private getCursor;
    private spawnCursor;
    private waitForCursorReady;
}
//# sourceMappingURL=native-helper.d.ts.map