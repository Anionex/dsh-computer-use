/** Validated provider, observation, settlement, artifact, and app-policy configuration. */
import type Schema from '@deepseek-ai/schemastery';
/** Settings document namespace owned by this package. */
export declare const COMPUTER_USE_SETTINGS_NAMESPACE: import("@deepseek-ai/dsh-settings").SettingsNamespace;
/** One persisted application grant. Wildcards are intentionally unsupported. */
export interface ComputerUseAppGrant {
    bundleId: string;
    read?: boolean;
    control?: boolean;
}
/** Host-owned policy for foreground activation, keyboard routing, target-process input, and the visible Agent cursor. */
export interface ComputerUseInteractionConfig {
    focusPolicy?: 'preserve' | 'activate';
    keyboardPolicy?: 'preserve' | 'activate';
    pointerInputPolicy?: 'deny' | 'targeted';
    cursorVisualization?: 'hidden' | 'visible';
    /** @deprecated Accepted for 0.2.x settings compatibility; physical motion replaces fixed duration. */
    cursorMotionMs?: number;
    cursorSpeedPxPerSecond?: number;
    cursorAccelerationPxPerSecondSquared?: number;
    cursorClickDelayMs?: number;
    cursorAutoHideMs?: number;
}
/** User-facing configuration; schema defaults are repeated by {@link resolveConfig}. `observationTtlMs: 0` disables observation expiry. */
export interface ComputerUseConfig {
    observationTtlMs?: number;
    confirmationTtlMs?: number;
    actionTimeoutMs?: number;
    settleMs?: number;
    maxSettleMs?: number;
    maxNodes?: number;
    maxDepth?: number;
    maxTextBytes?: number;
    maxScreenshotBytes?: number;
    artifactRoot?: string;
    helper?: {
        path?: string;
        allowSourceBuild?: boolean;
    };
    interaction?: ComputerUseInteractionConfig;
    allowAllApps?: boolean;
    grants?: ComputerUseAppGrant[];
}
/** Configuration schema used by Cordis and the Settings provider. */
export declare const Config: Schema<ComputerUseConfig>;
/** Fully defaulted configuration consumed at runtime. */
export interface ResolvedComputerUseConfig {
    observationTtlMs: number;
    confirmationTtlMs: number;
    actionTimeoutMs: number;
    settleMs: number;
    maxSettleMs: number;
    maxNodes: number;
    maxDepth: number;
    maxTextBytes: number;
    maxScreenshotBytes: number;
    artifactRoot: string;
    helper: {
        path?: string;
        allowSourceBuild: boolean;
    };
    interaction: {
        focusPolicy: 'preserve' | 'activate';
        keyboardPolicy: 'preserve' | 'activate';
        pointerInputPolicy: 'deny' | 'targeted';
        cursorVisualization: 'hidden' | 'visible';
        cursorSpeedPxPerSecond: number;
        cursorAccelerationPxPerSecondSquared: number;
        cursorClickDelayMs: number;
        cursorAutoHideMs: number;
    };
    allowAllApps: boolean;
    grants: Array<{
        bundleId: string;
        read: boolean;
        control: boolean;
    }>;
}
/** Validate and normalize one raw config object. */
export declare function resolveConfig(config?: ComputerUseConfig): ResolvedComputerUseConfig;
//# sourceMappingURL=config.d.ts.map