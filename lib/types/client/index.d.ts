/** DSH Computer Use browser plugin: provider health, permissions, limits, and app policy. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
declare const en: {
    readonly nav: "Computer Use";
    readonly title: "macOS Computer Use";
    readonly intro: "Inspect the native helper, macOS privacy permissions, foreground/targeted-input policy, observation limits, and exact per-app read/control grants.";
    readonly pluginKind: "DSH native plugin";
    readonly privacy: "macOS privacy";
    readonly access: "Application access";
    readonly accessHint: "Choose whether Computer Use may work with every app. Exact per-app rules remain available under Advanced settings.";
    readonly advanced: "Advanced options";
    readonly advancedHint: "Limits, helper path, cursor timing, and application grants.";
    readonly cursorTiming: "Agent cursor motion";
    readonly helper: "Native helper";
    readonly helperUnknown: "Unknown";
    readonly ready: "Ready";
    readonly unavailable: "Unavailable";
    readonly generation: "Applied in this run";
    readonly generationValue: "{generation} times";
    readonly accessibility: "Accessibility";
    readonly screenRecording: "Screen Recording";
    readonly granted: "Granted";
    readonly denied: "Needs permission";
    readonly openSettings: "Open macOS Settings";
    readonly refresh: "Refresh health";
    readonly limits: "Observation and action limits";
    readonly ttl: "Observation TTL (ms; 0 = no expiry)";
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
    readonly interaction: "Foreground and targeted input";
    readonly interactionHint: "The default route sends pointer and keyboard events only to the selected process. It does not move the system cursor or activate the app.";
    readonly focusPolicy: "Foreground policy";
    readonly focusPreserve: "Preserve current foreground app";
    readonly focusActivate: "Allow activating the target app";
    readonly keyboardPolicy: "Keyboard policy";
    readonly keyboardPreserve: "Preserve foreground; typing compatibility varies";
    readonly keyboardActivate: "Activate the target app before typing";
    readonly pointerInputPolicy: "Target-process pointer input";
    readonly pointerDeny: "Deny mouse, drag, and wheel events";
    readonly pointerAllow: "Route events only to the target process";
    readonly cursorVisualization: "Agent cursor";
    readonly cursorVisible: "Show a separate click-through Agent cursor";
    readonly cursorHidden: "Hide the Agent cursor";
    readonly cursorSpeed: "Requested maximum cursor speed (px/s)";
    readonly cursorAcceleration: "Cursor acceleration/deceleration (px/s²)";
    readonly cursorClickDelay: "Delay after arrival before click (ms)";
    readonly cursorAutoHide: "Cursor auto-hide (ms; 0 = stay visible)";
    readonly grants: "Application grants";
    readonly grantsHint: "One exact bundle id per line, followed by read or read,control. Wildcards are rejected.";
    readonly allowAllApps: "Allow read and control for every app";
    readonly allowAllAppsHint: "When enabled, exact grants are ignored and every running app is readable and controllable.";
    readonly save: "Save and apply";
    readonly saving: "Applying...";
    readonly saved: "Settings applied.";
    readonly readOnly: "The current Settings provider is read-only.";
    readonly loading: "Loading Computer Use settings...";
    readonly retry: "Retry";
    readonly numberRange: "{field} must be an integer from {min} to {max}.";
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