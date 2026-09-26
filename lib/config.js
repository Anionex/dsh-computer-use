/** Validated provider, observation, settlement, artifact, and app-policy configuration. */
import z from '@deepseek-ai/schemastery';
import * as SettingsModule from '@deepseek-ai/dsh-settings';
import { ComputerUseError } from "./errors.js";
/**
 * Settings document namespace owned by this package.
 *
 * DSH 0.1.5 removed the `settingsNamespace()` runtime brander: the namespace is
 * a compile-time-only brand and the official convention is a plain string
 * literal (0.1.5's own `ui-chat` client does `const CHAT_SETTINGS_NAMESPACE =
 * "ui-chat"`). The literal below satisfies the 0.1.5 grammar
 * `/^[a-z][a-z0-9-]*$/` and, because `SettingsNamespace` is a type-only export
 * in every supported release, the cast is erased at build time — the value that
 * reaches the host is exactly `'computer-use'`.
 */
export const COMPUTER_USE_SETTINGS_NAMESPACE = 'computer-use';
/** DSH 0.1.7 derives editable Settings fields from volatile Config fields.
 * Legacy Settings can coexist with a newer Schemastery installation. Only
 * enable references when the host Settings service uses Config-derived forms.
 */
function live(field) {
    const candidate = field;
    return 'SettingsForms' in SettingsModule && typeof candidate.volatile === 'function'
        ? candidate.volatile()
        : field;
}
/** Read the newer Loader's stable references without changing the legacy shape. */
export function readComputerUseConfig(config) {
    return Object.fromEntries(Object.entries(config).map(([key, value]) => [
        key,
        value !== null && typeof value === 'object' && 'get' in value && typeof value.get === 'function'
            ? value.get()
            : value,
    ]));
}
/** Configuration schema used by Cordis and the Settings provider. */
export const Config = z.object({
    observationTtlMs: live(z.number().default(0)),
    confirmationTtlMs: live(z.number().default(300000)),
    actionTimeoutMs: live(z.number().default(15000)),
    settleMs: live(z.number().default(250)),
    maxSettleMs: live(z.number().default(5000)),
    maxNodes: live(z.number().default(500)),
    maxDepth: live(z.number().default(14)),
    maxTextBytes: live(z.number().default(64000)),
    maxScreenshotBytes: live(z.number().default(33554432)),
    artifactRoot: live(z.string().default('.dsh-computer-use/artifacts')),
    helper: live(z.object({
        path: z.string(),
        allowSourceBuild: z.boolean().default(false),
    })),
    interaction: live(z.object({
        focusPolicy: z.union(['preserve', 'activate']).default('preserve'),
        keyboardPolicy: z.union(['preserve', 'activate']).default('preserve'),
        pointerInputPolicy: z.union(['deny', 'targeted']).default('targeted'),
        cursorVisualization: z.union(['hidden', 'visible']).default('visible'),
        cursorMotionMs: z.number(),
        cursorSpeedPxPerSecond: z.number().default(1600),
        cursorAccelerationPxPerSecondSquared: z.number().default(6000),
        cursorClickDelayMs: z.number().default(90),
        cursorAutoHideMs: z.number().default(0),
    })),
    allowAllApps: live(z.boolean().default(false)),
    grants: live(z.array(z.object({
        bundleId: z.string(),
        read: z.boolean().default(false),
        control: z.boolean().default(false),
    })).default([])),
});
function integer(name, value, min, max) {
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', `${name} must be an integer between ${min} and ${max}`);
    }
    return value;
}
function option(name, value, allowed) {
    if (!allowed.includes(value)) {
        throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', `${name} must be one of ${allowed.join(', ')}`);
    }
    return value;
}
/** Validate and normalize one raw config object. */
export function resolveConfig(config = {}) {
    const observationTtl = config.observationTtlMs ?? 0;
    const observationTtlMs = observationTtl === 0 ? 0 : integer('observationTtlMs', observationTtl, 1000, 86400000);
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
    const focusPolicy = option('interaction.focusPolicy', config.interaction?.focusPolicy ?? 'preserve', ['preserve', 'activate']);
    const keyboardPolicy = option('interaction.keyboardPolicy', config.interaction?.keyboardPolicy ?? 'preserve', ['preserve', 'activate']);
    const pointerInputPolicy = option('interaction.pointerInputPolicy', config.interaction?.pointerInputPolicy ?? 'targeted', ['deny', 'targeted']);
    const cursorVisualization = option('interaction.cursorVisualization', config.interaction?.cursorVisualization ?? 'visible', ['hidden', 'visible']);
    if (config.interaction?.cursorMotionMs !== undefined) {
        integer('interaction.cursorMotionMs', config.interaction.cursorMotionMs, 0, 2000);
    }
    const cursorSpeedPxPerSecond = integer('interaction.cursorSpeedPxPerSecond', config.interaction?.cursorSpeedPxPerSecond ?? 1600, 100, 50000);
    const cursorAccelerationPxPerSecondSquared = integer('interaction.cursorAccelerationPxPerSecondSquared', config.interaction?.cursorAccelerationPxPerSecondSquared ?? 6000, 100, 500000);
    const cursorClickDelayMs = integer('interaction.cursorClickDelayMs', config.interaction?.cursorClickDelayMs ?? 90, 0, 1000);
    const cursorAutoHideMs = integer('interaction.cursorAutoHideMs', config.interaction?.cursorAutoHideMs ?? 0, 0, 30000);
    const allowAllApps = config.allowAllApps ?? false;
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
        interaction: {
            focusPolicy,
            keyboardPolicy,
            pointerInputPolicy,
            cursorVisualization,
            cursorSpeedPxPerSecond,
            cursorAccelerationPxPerSecondSquared,
            cursorClickDelayMs,
            cursorAutoHideMs,
        },
        allowAllApps,
        grants,
    };
}
//# sourceMappingURL=config.js.map