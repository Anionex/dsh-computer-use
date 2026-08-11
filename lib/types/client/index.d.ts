/** DSH Computer Use browser plugin: provider health, permissions, limits, and app policy. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
declare const en: {
    readonly nav: "Computer Use";
    readonly title: "macOS Computer Use";
    readonly intro: "Inspect the native helper, macOS privacy permissions, observation limits, and exact per-app read/control grants.";
    readonly helper: "Native helper";
    readonly ready: "Ready";
    readonly unavailable: "Unavailable";
    readonly generation: "Generation";
    readonly accessibility: "Accessibility";
    readonly screenRecording: "Screen Recording";
    readonly granted: "Granted";
    readonly denied: "Needs permission";
    readonly openSettings: "Open macOS Settings";
    readonly refresh: "Refresh health";
    readonly limits: "Observation and action limits";
    readonly ttl: "Observation TTL (ms)";
    readonly confirmationTtl: "Confirmation TTL (ms)";
    readonly actionTimeout: "Action timeout (ms)";
    readonly settle: "Settlement interval (ms)";
    readonly maxSettle: "Maximum settlement (ms)";
    readonly maxNodes: "Maximum AX nodes";
    readonly maxDepth: "Maximum AX depth";
    readonly maxText: "Maximum AX text bytes";
    readonly maxScreenshot: "Maximum screenshot bytes";
    readonly artifactRoot: "Artifact root";
    readonly helperPath: "External helper path";
    readonly sourceBuild: "Allow explicit source-build fallback";
    readonly grants: "Application grants";
    readonly grantsHint: "One exact bundle id per line, followed by read or read,control. Wildcards are rejected.";
    readonly save: "Save and apply";
    readonly saving: "Applying...";
    readonly saved: "Settings applied.";
    readonly readOnly: "The current Settings provider is read-only.";
    readonly loading: "Loading Computer Use settings...";
    readonly retry: "Retry";
};
type LocaleKey = keyof typeof en;
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** DSH Computer Use Settings copy. */
        'computer-use': LocaleKey;
    }
}
/** Required browser services. */
export declare const inject: string[];
/** Register the Computer Use Settings section. */
export declare function apply(ctx: ClientContext): void;
export {};
//# sourceMappingURL=index.d.ts.map