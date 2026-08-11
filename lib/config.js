/** Validated provider, observation, settlement, artifact, and app-policy configuration. */
import z from 'schemastery';
import { settingsNamespace } from '@deepseek-ai/dsh-settings';
import { ComputerUseError } from "./errors.js";
/** Settings document namespace owned by this package. */
export const COMPUTER_USE_SETTINGS_NAMESPACE = settingsNamespace('computer-use');
/** Configuration schema used by Cordis and the Settings provider. */
export const Config = z.object({
    observationTtlMs: z.number().default(15000),
    confirmationTtlMs: z.number().default(300000),
    actionTimeoutMs: z.number().default(15000),
    settleMs: z.number().default(250),
    maxSettleMs: z.number().default(5000),
    maxNodes: z.number().default(500),
    maxDepth: z.number().default(14),
    maxTextBytes: z.number().default(64000),
    maxScreenshotBytes: z.number().default(33554432),
    artifactRoot: z.string().default('.dsh-computer-use/artifacts'),
    helper: z.object({
        path: z.string(),
        allowSourceBuild: z.boolean().default(false),
    }),
    grants: z.array(z.object({
        bundleId: z.string(),
        read: z.boolean().default(false),
        control: z.boolean().default(false),
    })).default([]),
});
function integer(name, value, min, max) {
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', `${name} must be an integer between ${min} and ${max}`);
    }
    return value;
}
/** Validate and normalize one raw config object. */
export function resolveConfig(config = {}) {
    const observationTtlMs = integer('observationTtlMs', config.observationTtlMs ?? 15000, 1000, 120000);
    const confirmationTtlMs = integer('confirmationTtlMs', config.confirmationTtlMs ?? 300000, 1000, 900000);
    const actionTimeoutMs = integer('actionTimeoutMs', config.actionTimeoutMs ?? 15000, 1000, 120000);
    const settleMs = integer('settleMs', config.settleMs ?? 250, 0, 10000);
    const maxSettleMs = integer('maxSettleMs', config.maxSettleMs ?? 5000, 100, 60000);
    if (settleMs > maxSettleMs) {
        throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'settleMs must be no greater than maxSettleMs');
    }
    const maxNodes = integer('maxNodes', config.maxNodes ?? 500, 10, 5000);
    const maxDepth = integer('maxDepth', config.maxDepth ?? 14, 1, 64);
    const maxTextBytes = integer('maxTextBytes', config.maxTextBytes ?? 64000, 1024, 1048576);
    const maxScreenshotBytes = integer('maxScreenshotBytes', config.maxScreenshotBytes ?? 33554432, 1024, 268435456);
    const artifactRoot = (config.artifactRoot ?? '.dsh-computer-use/artifacts').trim();
    if (artifactRoot.length === 0 || artifactRoot.startsWith('/') || artifactRoot.split(/[\\/]+/u).includes('..')) {
        throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'artifactRoot must be a non-empty workspace-relative path without ..');
    }
    const helperPath = config.helper?.path?.trim();
    if (helperPath !== undefined && helperPath.length === 0) {
        throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'helper.path must not be empty');
    }
    const seen = new Set();
    const grants = (config.grants ?? []).map((grant) => {
        const bundleId = grant.bundleId.trim();
        if (bundleId.length === 0 || bundleId === '*' || bundleId.includes('*')) {
            throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'grants[].bundleId must be one exact non-wildcard bundle id');
        }
        if (seen.has(bundleId)) {
            throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', `duplicate app grant for ${bundleId}`);
        }
        seen.add(bundleId);
        const control = grant.control ?? false;
        return { bundleId, read: (grant.read ?? false) || control, control };
    });
    return {
        observationTtlMs,
        confirmationTtlMs,
        actionTimeoutMs,
        settleMs,
        maxSettleMs,
        maxNodes,
        maxDepth,
        maxTextBytes,
        maxScreenshotBytes,
        artifactRoot,
        helper: {
            ...(helperPath === undefined ? {} : { path: helperPath }),
            allowSourceBuild: config.helper?.allowSourceBuild ?? false,
        },
        grants,
    };
}
//# sourceMappingURL=config.js.map