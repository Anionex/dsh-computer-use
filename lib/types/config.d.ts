/** Validated provider, observation, settlement, artifact, and app-policy configuration. */
import type Schema from 'schemastery';
/** Settings document namespace owned by this package. */
export declare const COMPUTER_USE_SETTINGS_NAMESPACE: import("@deepseek-ai/dsh-settings").SettingsNamespace;
/** One persisted application grant. Wildcards are intentionally unsupported. */
export interface ComputerUseAppGrant {
    bundleId: string;
    read?: boolean;
    control?: boolean;
}
/** User-facing configuration; schema defaults are repeated by {@link resolveConfig}. */
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
    grants: Array<{
        bundleId: string;
        read: boolean;
        control: boolean;
    }>;
}
/** Validate and normalize one raw config object. */
export declare function resolveConfig(config?: ComputerUseConfig): ResolvedComputerUseConfig;
//# sourceMappingURL=config.d.ts.map