/** Public Computer Use types shared by the Service, provider, and Tool consumer. */
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Branded } from '@deepseek-ai/dsh-brand';
import type { CallId } from '@deepseek-ai/dsh-llm';
/** Opaque identifier for one immutable observed UI state. */
export type ComputerObservationId = Branded<'ComputerObservationId'>;
/** Brand a generated observation identifier. */
export declare const ComputerObservationId: (value: string) => ComputerObservationId;
/** Opaque reference to one element descriptor captured inside an observation. */
export type ComputerTargetHandle = Branded<'ComputerTargetHandle'>;
/** Brand a generated target handle. */
export declare const ComputerTargetHandle: (value: string) => ComputerTargetHandle;
/** Opaque one-use grant for one confirmed sensitive action. */
export type ComputerConfirmationToken = Branded<'ComputerConfirmationToken'>;
/** Brand a generated confirmation token. */
export declare const ComputerConfirmationToken: (value: string) => ComputerConfirmationToken;
/** Rectangle in screen-global point coordinates unless a containing type states otherwise. */
export interface ComputerRect {
    x: number;
    y: number;
    width: number;
    height: number;
}
/** macOS permission state reported without attempting to grant it. */
export type ComputerPermissionState = 'granted' | 'denied' | 'not-determined' | 'unavailable';
/** Stable identity of one running user-facing application. */
export interface ComputerAppIdentity {
    bundleId: string;
    pid: number;
    name: string;
}
/** Application selector accepted from a model or caller. */
export interface ComputerAppSelector {
    bundleId?: string;
    pid?: number;
    name?: string;
}
/** Bounded application row returned by discovery. */
export interface ComputerAppSummary extends ComputerAppIdentity {
    frontmost: boolean;
    accessibility: ComputerPermissionState;
    screenRecording: ComputerPermissionState;
}
/** One model-addressable element. Its index and opaque handle belong only to the enclosing observation. */
export interface ComputerElement {
    index: number;
    targetHandle: ComputerTargetHandle;
    role: string;
    subrole?: string;
    title?: string;
    label?: string;
    value?: string;
    enabled?: boolean;
    focused?: boolean;
    selected?: boolean;
    frame?: ComputerRect;
    actions: string[];
}
/** Deterministic route used to resolve a target immediately before input. */
export type ComputerTargetResolutionMode = 'exact-locator' | 'native-identifier' | 'semantic-rebind';
/** Model-visible evidence describing how an element target was resolved. */
export interface ComputerTargetResolutionResult {
    mode: ComputerTargetResolutionMode;
    confidence: number;
    candidateCount: number;
    targetChanged: boolean;
}
/** File artifact emitted by a Computer Use observation. */
export interface ComputerArtifact {
    path: string;
    filename: string;
    mimeType: 'image/png';
    kind: 'image';
    description: string;
    sourceTool: 'computer_observe' | 'computer_action';
    previewIntent: 'image';
    bytes: number;
    width: number;
    height: number;
}
/** Complete model-visible observation. */
export interface ComputerObservation {
    observationId: ComputerObservationId;
    app: ComputerAppIdentity;
    createdAt: string;
    expiresAt: string;
    frontmost: boolean;
    window?: {
        title?: string;
        frame: ComputerRect;
        id?: number;
    };
    tree: {
        mode: 'full' | 'diff';
        text: string;
        truncated: boolean;
    };
    elements: ComputerElement[];
    screenshot?: ComputerArtifact;
    permissions: {
        accessibility: ComputerPermissionState;
        screenRecording: ComputerPermissionState;
    };
}
/** Whether screenshot capture is omitted, best-effort, or required. */
export type ComputerScreenshotMode = 'none' | 'optional' | 'required';
/** Request for a fresh observation. */
export interface ComputerObserveRequest {
    app: ComputerAppSelector;
    screenshot?: ComputerScreenshotMode;
    full?: boolean;
}
/** Closed set of supported key modifiers. */
export type ComputerKeyModifier = 'command' | 'control' | 'option' | 'shift';
/** Closed set of supported mouse buttons. */
export type ComputerMouseButton = 'left' | 'right' | 'middle';
/** Coordinate space accepted by coordinate-based pointer actions. */
export type ComputerCoordinateSpace = 'window' | 'screen';
/** Shared fields carried by every action against an existing observation. */
export interface ComputerActionBase {
    observationId: ComputerObservationId;
    /** True only when the Skill has classified the action as requiring just-in-time confirmation. */
    sensitive?: boolean;
    /** One-use token returned by {@link ComputerUseService.confirm}. */
    confirmationToken?: ComputerConfirmationToken;
}
/** Stable target selection fields shared by element-addressed actions. */
export interface ComputerElementTarget {
    /** Observation-local compatibility index. It does not authorize rebinding by itself. */
    elementIndex?: number;
    /** Opaque handle returned on the selected observation element. */
    targetHandle?: ComputerTargetHandle;
    /** Permit deterministic native-identifier or unique semantic rebinding. */
    allowRebind?: boolean;
}
/** Click an observed element or an observed-window coordinate. */
export interface ComputerClickAction extends ComputerActionBase, ComputerElementTarget {
    kind: 'click';
    x?: number;
    y?: number;
    /** `window` (default) resolves `x`/`y` inside the observed window frame; `screen` treats them as Quartz screen-global points. */
    coordinateSpace?: ComputerCoordinateSpace;
    button?: ComputerMouseButton;
    clickCount?: number;
    allowCoordinateFallback?: boolean;
}
/** Set the Accessibility value of an observed editable element. */
export interface ComputerSetValueAction extends ComputerActionBase, ComputerElementTarget {
    kind: 'set-value';
    value: string;
}
/** Insert Unicode into the currently focused control through Accessibility or keyboard fallback, without using the clipboard. */
export interface ComputerTypeTextAction extends ComputerActionBase {
    kind: 'type-text';
    text: string;
}
/** Press one validated key chord. */
export interface ComputerPressKeyAction extends ComputerActionBase {
    kind: 'press-key';
    key: string;
    modifiers?: ComputerKeyModifier[];
}
/** Scroll at an observed element or coordinate. */
export interface ComputerScrollAction extends ComputerActionBase, ComputerElementTarget {
    kind: 'scroll';
    x?: number;
    y?: number;
    coordinateSpace?: ComputerCoordinateSpace;
    direction: 'up' | 'down' | 'left' | 'right';
    pages?: number;
}
/** Drag between two points in the observed window or screen coordinate space. */
export interface ComputerDragAction extends ComputerActionBase {
    kind: 'drag';
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    coordinateSpace?: ComputerCoordinateSpace;
}
/** Perform one Accessibility action advertised by an observed element. */
export interface ComputerPerformAction extends ComputerActionBase, ComputerElementTarget {
    kind: 'perform-action';
    action: string;
}
/** Wait for a bounded UI condition without mutating state. */
export interface ComputerWaitAction extends ComputerActionBase {
    kind: 'wait';
    condition: {
        text?: string;
        elementRole?: string;
        elementTitle?: string;
    };
    timeoutMs?: number;
}
/** Every model-accessible Computer Use action. */
export type ComputerActionRequest = ComputerClickAction | ComputerSetValueAction | ComputerTypeTextAction | ComputerPressKeyAction | ComputerScrollAction | ComputerDragAction | ComputerPerformAction | ComputerWaitAction;
/** Result of a successful action followed by a fresh observation. */
export interface ComputerActionResult {
    action: ComputerActionRequest['kind'];
    channel: 'accessibility' | 'coordinates' | 'keyboard' | 'wait';
    /** Verifiable target-app foreground state transition requested by the helper for this action. */
    activation: 'not-requested' | 'already-frontmost' | 'activated';
    /** Whether the helper emitted mouse, drag, or scroll-wheel input to the target process. */
    pointerInput: boolean;
    /** Pointer-event route selected by the helper; global HID routing is not supported. */
    pointerRouting: 'none' | 'target-process';
    /** Present when the action addressed an observed element. */
    resolution?: ComputerTargetResolutionResult;
    /** Present only when the agent cursor should be on screen and is not. */
    agentCursor?: {
        visible: false;
        reason?: string;
    };
    /** Whether the target actually changed, which no other field reports. */
    effect: ComputerActionEffect;
    observation: ComputerObservation;
}
/**
 * What the target did, as opposed to what was attempted.
 *
 * `pointerRouting` and `pointerInput` describe the request; they stay the same
 * whether the target reacted or ignored it. A drag onto a window title bar
 * reports a perfectly routed pointer stream and moves nothing, because window
 * movement belongs to the window server rather than the process the events
 * were delivered to.
 *
 * The comparison covers the window's title, id and frame alongside the element
 * tree, so it is wider than the accessibility tree alone: a window that moved
 * or resized changes this hash. Verified by moving a window 100px and watching
 * the hash change.
 */
export interface ComputerActionEffect {
    /** True when the accessibility state hash differed after the action settled. */
    targetChanged: boolean;
    /** How long the settle loop watched, in milliseconds. */
    observedForMs: number;
    /** Guidance for the caller when nothing observable changed. */
    note?: string;
}
/** Confirmation request binding an exact proposed action to human-readable impact. */
export interface ComputerConfirmRequest {
    action: Omit<ComputerActionRequest, 'confirmationToken'>;
    reason: string;
    target: string;
    dataSummary?: string;
}
/** One-use confirmation result. */
export interface ComputerConfirmation {
    token: ComputerConfirmationToken;
    observationId: ComputerObservationId;
    app: ComputerAppIdentity;
    expiresAt: string;
}
/** Caller context required for scoping, cancellation, approval audit, and artifact placement. */
export interface ComputerUseContext {
    agent: Agent;
    workspace: string;
    callId?: CallId;
    signal: AbortSignal;
}
/** Provider and permission diagnostics exposed to Settings. */
export interface ComputerUseStatus {
    platform: NodeJS.Platform;
    provider: 'macos-ax' | 'unsupported';
    generation: number;
    ready: boolean;
    helperPath: string;
    helperVersion?: string;
    helperSha256?: string;
    accessibility: ComputerPermissionState;
    screenRecording: ComputerPermissionState;
    lastError?: string;
}
//# sourceMappingURL=types.d.ts.map