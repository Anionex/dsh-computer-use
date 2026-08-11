/** Public Computer Use types shared by the Service, provider, and Tool consumer. */
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Branded } from '@deepseek-ai/dsh-brand';
import type { CallId } from '@deepseek-ai/dsh-llm';
/** Opaque identifier for one immutable observed UI state. */
export type ComputerObservationId = Branded<'ComputerObservationId'>;
/** Brand a generated observation identifier. */
export declare const ComputerObservationId: (value: string) => ComputerObservationId;
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
/** One model-addressable element. Its index belongs only to the enclosing observation. */
export interface ComputerElement {
    index: number;
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
/** Shared fields carried by every action against an existing observation. */
export interface ComputerActionBase {
    observationId: ComputerObservationId;
    /** True only when the Skill has classified the action as requiring just-in-time confirmation. */
    sensitive?: boolean;
    /** One-use token returned by {@link ComputerUseService.confirm}. */
    confirmationToken?: ComputerConfirmationToken;
}
/** Click an observed element or an observed-window coordinate. */
export interface ComputerClickAction extends ComputerActionBase {
    kind: 'click';
    elementIndex?: number;
    x?: number;
    y?: number;
    button?: ComputerMouseButton;
    clickCount?: number;
    allowCoordinateFallback?: boolean;
}
/** Set the Accessibility value of an observed editable element. */
export interface ComputerSetValueAction extends ComputerActionBase {
    kind: 'set-value';
    elementIndex: number;
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
export interface ComputerScrollAction extends ComputerActionBase {
    kind: 'scroll';
    elementIndex?: number;
    x?: number;
    y?: number;
    direction: 'up' | 'down' | 'left' | 'right';
    pages?: number;
}
/** Drag inside the observed window coordinate space. */
export interface ComputerDragAction extends ComputerActionBase {
    kind: 'drag';
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
}
/** Perform one Accessibility action advertised by an observed element. */
export interface ComputerPerformAction extends ComputerActionBase {
    kind: 'perform-action';
    elementIndex: number;
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
    observation: ComputerObservation;
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
    provider: 'macos-ax';
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