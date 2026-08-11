/** Managed invocation and integrity checks for the fixed-command Swift helper. */
import type { Context } from 'cordis';
import type { ResolvedComputerUseConfig } from '../config.ts';
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
    constructor(ctx: Context, config: ResolvedComputerUseConfig, managedRoot?: string);
    /** Absolute executable path selected by explicit override or the packaged managed binary. */
    get helperPath(): string;
    /** Verify platform, file type, packaged hash, and executable mode before use. */
    prepare(signal: AbortSignal): Promise<PreparedNativeHelper>;
    /** Invoke one fixed helper command and parse its bounded JSON envelope. */
    invoke<T>(request: Record<string, unknown>, signal: AbortSignal): Promise<T>;
    /** Prepared integrity facts used by provider health. */
    preparedInfo(): PreparedNativeHelper;
    private buildManaged;
}
//# sourceMappingURL=native-helper.d.ts.map